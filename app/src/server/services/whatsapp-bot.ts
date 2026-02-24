import createWASocket, {
  type AuthenticationState,
  Browsers,
  BufferJSON,
  DisconnectReason,
  type SignalDataSet,
  type SignalDataTypeMap,
  initAuthCreds,
  proto,
} from "@whiskeysockets/baileys";
import { eq, and, isNull, gt } from "drizzle-orm";
import IORedis from "ioredis";
import { db } from "@/server/db/client";
import {
  conversation,
  whatsappAuthState,
  whatsappConversation,
  whatsappLinkCode,
  whatsappUserLink,
  user,
} from "@/server/db/schema";
import { buildRedisOptions } from "@/server/redis/connection-options";
import { generationManager } from "@/server/services/generation-manager";

type WhatsAppStatus = "disconnected" | "connecting" | "connected";

type WhatsAppState = {
  status: WhatsAppStatus;
  lastQr: string | null;
  lastQrAt: Date | null;
  lastError: string | null;
};

const state: WhatsAppState = {
  status: "disconnected",
  lastQr: null,
  lastQrAt: null,
  lastError: null,
};

let socket: ReturnType<typeof createWASocket> | null = null;
let isConnecting = false;
let lockRenewTimer: ReturnType<typeof setInterval> | null = null;

const WHATSAPP_LOCK_KEY = "locks:whatsapp-bot:owner";
const WHATSAPP_LOCK_TTL_MS = 60_000;
const whatsappInstanceId = crypto.randomUUID();
let redisClient: IORedis | null = null;

function getRedisClient(): IORedis {
  if (!redisClient) {
    redisClient = new IORedis(
      buildRedisOptions(process.env.REDIS_URL ?? "redis://localhost:6379", {
        maxRetriesPerRequest: null,
        enableReadyCheck: false,
      }),
    );
  }
  return redisClient;
}

async function acquireOwnershipLock(): Promise<boolean> {
  const result = await getRedisClient().set(
    WHATSAPP_LOCK_KEY,
    whatsappInstanceId,
    "PX",
    WHATSAPP_LOCK_TTL_MS,
    "NX",
  );
  return result === "OK";
}

function startLockRenewal(): void {
  if (lockRenewTimer) {
    return;
  }
  lockRenewTimer = setInterval(
    async () => {
      try {
        const redis = getRedisClient();
        const owner = await redis.get(WHATSAPP_LOCK_KEY);
        if (owner !== whatsappInstanceId) {
          return;
        }
        await redis.pexpire(WHATSAPP_LOCK_KEY, WHATSAPP_LOCK_TTL_MS);
      } catch (err) {
        console.error("[whatsapp-bot] Failed to renew ownership lock:", err);
      }
    },
    Math.floor(WHATSAPP_LOCK_TTL_MS / 2),
  );
}

async function releaseOwnershipLock(): Promise<void> {
  if (lockRenewTimer) {
    clearInterval(lockRenewTimer);
    lockRenewTimer = null;
  }
  try {
    const redis = getRedisClient();
    const owner = await redis.get(WHATSAPP_LOCK_KEY);
    if (owner === whatsappInstanceId) {
      await redis.del(WHATSAPP_LOCK_KEY);
    }
  } catch (err) {
    console.error("[whatsapp-bot] Failed to release ownership lock:", err);
  }
}

function normalizePhoneNumber(input: string): string {
  return input.replace(/\D/g, "");
}

function normalizeLinkCode(input: string): string {
  return input.replace(/[^0-9]/g, "");
}

function getJidPhoneNumber(jid: string): string {
  const number = jid.split("@")[0] ?? "";
  return normalizePhoneNumber(number);
}

function extractMessageText(msg: proto.IMessage | null | undefined): string | null {
  if (!msg) {
    return null;
  }
  if (msg.conversation) {
    return msg.conversation;
  }
  if (msg.extendedTextMessage?.text) {
    return msg.extendedTextMessage.text;
  }
  if (msg.imageMessage?.caption) {
    return msg.imageMessage.caption;
  }
  if (msg.videoMessage?.caption) {
    return msg.videoMessage.caption;
  }
  if (msg.documentMessage?.caption) {
    return msg.documentMessage.caption;
  }
  return null;
}

async function readAuthData(key: string): Promise<unknown | null> {
  const record = await db.query.whatsappAuthState.findFirst({
    where: eq(whatsappAuthState.id, key),
  });
  if (!record) {
    return null;
  }
  return JSON.parse(record.data, BufferJSON.reviver);
}

async function writeAuthData(key: string, data: unknown): Promise<void> {
  const payload = JSON.stringify(data, BufferJSON.replacer);
  await db
    .insert(whatsappAuthState)
    .values({
      id: key,
      data: payload,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: whatsappAuthState.id,
      set: {
        data: payload,
        updatedAt: new Date(),
      },
    });
}

async function removeAuthData(key: string): Promise<void> {
  await db.delete(whatsappAuthState).where(eq(whatsappAuthState.id, key));
}

async function createDbAuthState(): Promise<{
  state: AuthenticationState;
  saveCreds: () => Promise<void>;
}> {
  const storedCreds = (await readAuthData("creds.json")) as ReturnType<typeof initAuthCreds> | null;
  const creds = storedCreds ?? initAuthCreds();
  return {
    state: {
      creds,
      keys: {
        get: async <T extends keyof SignalDataTypeMap>(type: T, ids: string[]) => {
          const data: { [id: string]: SignalDataTypeMap[T] } = {};
          await Promise.all(
            ids.map(async (id) => {
              let value = await readAuthData(`${type}-${id}.json`);
              if (type === "app-state-sync-key" && value) {
                value = proto.Message.AppStateSyncKeyData.fromObject(value as object);
              }
              data[id] = (value ?? null) as SignalDataTypeMap[T];
            }),
          );
          return data;
        },
        set: async (data: SignalDataSet) => {
          const tasks: Promise<void>[] = [];
          for (const category of Object.keys(data)) {
            const entries = data[category as keyof SignalDataSet] ?? {};
            for (const id of Object.keys(entries)) {
              const value = entries[id];
              const key = `${category}-${id}.json`;
              tasks.push(value ? writeAuthData(key, value) : removeAuthData(key));
            }
          }
          await Promise.all(tasks);
        },
      },
    },
    saveCreds: async () => {
      await writeAuthData("creds.json", creds);
    },
  };
}

async function getOrCreateConversation(waJid: string, userId: string): Promise<string> {
  const existing = await db.query.whatsappConversation.findFirst({
    where: eq(whatsappConversation.waJid, waJid),
  });

  if (existing) {
    return existing.conversationId;
  }

  const [newConv] = await db
    .insert(conversation)
    .values({
      userId,
      type: "chat",
      title: "WhatsApp conversation",
      model: "anthropic/claude-sonnet-4-6",
    })
    .returning();

  await db.insert(whatsappConversation).values({
    waJid,
    conversationId: newConv!.id,
    userId,
  });

  return newConv!.id;
}

async function collectGenerationResponse(generationId: string, userId: string): Promise<string> {
  const parts: string[] = [];
  for await (const event of generationManager.subscribeToGeneration(generationId, userId)) {
    if (event.type === "text") {
      parts.push(event.content);
    } else if (event.type === "done" || event.type === "error" || event.type === "cancelled") {
      break;
    }
  }
  return parts.join("");
}

async function handleLinkCode(waJid: string, messageText: string) {
  const code = normalizeLinkCode(messageText);
  if (!code) {
    return false;
  }

  const linkCode = await db.query.whatsappLinkCode.findFirst({
    where: and(
      eq(whatsappLinkCode.code, code),
      isNull(whatsappLinkCode.usedAt),
      gt(whatsappLinkCode.expiresAt, new Date()),
    ),
  });

  if (!linkCode) {
    return false;
  }

  const linkedUser = await db.query.user.findFirst({
    where: eq(user.id, linkCode.userId),
  });

  const senderNumber = getJidPhoneNumber(waJid);
  const userNumber = linkedUser?.phoneNumber ? normalizePhoneNumber(linkedUser.phoneNumber) : "";

  if (!userNumber || userNumber !== senderNumber) {
    await socket?.sendMessage(waJid, {
      text: "This WhatsApp number doesn't match the phone number on your CmdClaw profile. Update your phone number in Settings and try again.",
    });
    return true;
  }

  try {
    await db
      .insert(whatsappUserLink)
      .values({ waJid, userId: linkCode.userId })
      .onConflictDoUpdate({
        target: whatsappUserLink.userId,
        set: {
          waJid,
          updatedAt: new Date(),
        },
      });
  } catch (err) {
    console.error("[whatsapp-link] Failed to link WhatsApp user:", err);
    await socket?.sendMessage(waJid, {
      text: "This WhatsApp number is already linked to another account.",
    });
    return true;
  }

  await db
    .update(whatsappLinkCode)
    .set({ usedAt: new Date() })
    .where(eq(whatsappLinkCode.id, linkCode.id));

  await socket?.sendMessage(waJid, {
    text: "✅ WhatsApp linked! You can now chat with CmdClaw here.",
  });

  return true;
}

async function handleIncomingMessage(waJid: string, text: string, displayName: string) {
  const link = await db.query.whatsappUserLink.findFirst({
    where: eq(whatsappUserLink.waJid, waJid),
  });

  if (!link) {
    const linked = await handleLinkCode(waJid, text);
    if (linked) {
      return;
    }
    await socket?.sendMessage(waJid, {
      text: "To link this WhatsApp number, open CmdClaw Settings and generate a WhatsApp link code, then send it here.",
    });
    return;
  }

  const convId = await getOrCreateConversation(waJid, link.userId);

  try {
    const { generationId } = await generationManager.startGeneration({
      conversationId: convId,
      content: `[WhatsApp message from ${displayName}]: ${text}`,
      userId: link.userId,
      autoApprove: true,
    });

    const responseText = await collectGenerationResponse(generationId, link.userId);

    if (responseText) {
      await socket?.sendMessage(waJid, { text: responseText });
    }
  } catch (err) {
    console.error("[whatsapp-bot] Generation failed:", err);
    await socket?.sendMessage(waJid, {
      text: "Sorry, I'm busy right now. Try again in a moment.",
    });
  }
}

export async function ensureWhatsAppSocket(): Promise<void> {
  if (process.env.VERCEL === "1") {
    state.status = "disconnected";
    state.lastError =
      "WhatsApp connector must run in a dedicated stateful worker and is disabled in Vercel runtime.";
    return;
  }
  if (state.status === "connected" || isConnecting) {
    return;
  }

  const ownsLock = await acquireOwnershipLock();
  if (!ownsLock) {
    state.status = "disconnected";
    state.lastError = "WhatsApp connector is owned by another instance";
    return;
  }

  isConnecting = true;
  state.status = "connecting";
  state.lastError = null;
  startLockRenewal();

  try {
    const { state: authState, saveCreds } = await createDbAuthState();

    socket = createWASocket({
      auth: authState,
      printQRInTerminal: false,
      browser: Browsers.macOS("CmdClaw"),
    });

    socket.ev.on("creds.update", saveCreds);

    socket.ev.on("connection.update", (update) => {
      if (update.qr) {
        state.lastQr = update.qr;
        state.lastQrAt = new Date();
      }

      if (update.connection === "open") {
        state.status = "connected";
        state.lastQr = null;
        state.lastQrAt = null;
        state.lastError = null;
      }

      if (update.connection === "close") {
        state.status = "disconnected";
        const reason = update.lastDisconnect?.error;
        const statusCode = (reason as { output?: { statusCode?: number } })?.output?.statusCode;
        if (statusCode === DisconnectReason.loggedOut) {
          state.lastError = "WhatsApp logged out. Reconnect required.";
        }
        void releaseOwnershipLock();
      }
    });

    socket.ev.on("messages.upsert", async (m) => {
      try {
        const message = m.messages?.[0];
        if (!message || !message.message) {
          return;
        }
        if (message.key?.fromMe) {
          return;
        }

        const waJid = message.key?.remoteJid;
        if (!waJid || waJid === "status@broadcast" || waJid.endsWith("@g.us")) {
          return;
        }

        const text = extractMessageText(message.message);
        if (!text) {
          return;
        }

        const displayName = message.pushName ?? "WhatsApp user";
        await handleIncomingMessage(waJid, text, displayName);
      } catch (err) {
        console.error("[whatsapp-bot] Failed to handle message:", err);
      }
    });
  } catch (err) {
    state.lastError = err instanceof Error ? err.message : "Failed to connect WhatsApp";
    state.status = "disconnected";
    await releaseOwnershipLock();
  } finally {
    isConnecting = false;
  }
}

export function getWhatsAppStatus(): WhatsAppState {
  return { ...state };
}

export async function disconnectWhatsApp(): Promise<void> {
  if (socket) {
    socket.end(undefined);
  }
  socket = null;
  state.status = "disconnected";
  await releaseOwnershipLock();
}
