import { eq } from "drizzle-orm";
import { randomBytes, randomUUID } from "node:crypto";
import {
  DEFAULT_SERVER_URL,
  getConfigPathForServerUrl,
  loadConfig,
  saveConfig,
} from "./lib/cli-shared";

const DEFAULT_CHAT_AUTH_EMAIL = "baptiste@heybap.com";
const DEFAULT_CHAT_AUTH_NAME = "Baptiste";

function isLocalServerUrl(serverUrl: string): boolean {
  try {
    const url = new URL(serverUrl);
    return ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  } catch {
    return false;
  }
}

function parsePositiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? "", 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return parsed;
}

function formatError(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

async function main(): Promise<void> {
  const serverUrl = process.env.CMDCLAW_SERVER_URL || DEFAULT_SERVER_URL;
  const loaded = loadConfig(serverUrl);

  if (!isLocalServerUrl(serverUrl)) {
    console.log(`[chat-auth] skipping bootstrap for non-local server: ${serverUrl}`);
    return;
  }

  let closePool: (() => Promise<void>) | undefined;

  try {
    const [{ auth }, dbModule, schemaModule] = await Promise.all([
      import("../src/lib/auth"),
      import("../src/server/db/client"),
      import("../src/server/db/schema"),
    ]);

    const { db } = dbModule;
    closePool = dbModule.closePool;
    const { user, session } = schemaModule;

    const minRemainingMinutes = parsePositiveInt(process.env.CHAT_AUTH_MIN_REMAINING_MINUTES, 10);
    const email =
      process.env.CHAT_AUTH_EMAIL || process.env.E2E_TEST_EMAIL || DEFAULT_CHAT_AUTH_EMAIL;
    const name = process.env.CHAT_AUTH_NAME || DEFAULT_CHAT_AUTH_NAME;

    if (loaded?.token && loaded.serverUrl === serverUrl) {
      const existing = await auth.api.getSession({
        headers: new Headers({ Authorization: `Bearer ${loaded.token}` }),
      });

      if (existing?.session && existing.user?.email === email) {
        const expiresAt = new Date(existing.session.expiresAt);
        if (Number.isFinite(expiresAt.getTime())) {
          const minRemainingMs = minRemainingMinutes * 60 * 1000;
          if (expiresAt.getTime() > Date.now() + minRemainingMs) {
            console.log(`[chat-auth] existing token is valid until ${expiresAt.toISOString()}`);
            return;
          }
        }
      } else if (existing?.user?.email && existing.user.email !== email) {
        console.log(
          `[chat-auth] existing token is for ${existing.user.email}; creating session for ${email}`,
        );
      }
    }
    const now = new Date();

    const existingUser = await db.query.user.findFirst({
      where: eq(user.email, email),
    });

    let userId: string;
    if (existingUser) {
      userId = existingUser.id;
      await db
        .update(user)
        .set({
          name,
          emailVerified: true,
          onboardedAt: existingUser.onboardedAt ?? now,
          updatedAt: now,
        })
        .where(eq(user.id, existingUser.id));
    } else {
      userId = randomUUID();
      await db.insert(user).values({
        id: userId,
        email,
        name,
        emailVerified: true,
        onboardedAt: now,
        role: "user",
        createdAt: now,
        updatedAt: now,
      });
    }

    const ttlHours = parsePositiveInt(process.env.CHAT_SESSION_TTL_HOURS, 24);
    const expiresAt = new Date(now.getTime() + ttlHours * 60 * 60 * 1000);
    const token = randomBytes(48).toString("hex");

    await db.insert(session).values({
      id: randomUUID(),
      userId,
      token,
      expiresAt,
      createdAt: now,
      updatedAt: now,
      ipAddress: "127.0.0.1",
      userAgent: "chat-cli-auth-bootstrap",
    });

    saveConfig({ serverUrl, token });
    console.log(`[chat-auth] user=${email}`);
    console.log(`[chat-auth] server=${serverUrl}`);
    console.log(`[chat-auth] config=${getConfigPathForServerUrl(serverUrl)}`);
    console.log(`[chat-auth] expiresAt=${expiresAt.toISOString()}`);
  } catch (err) {
    console.warn(`[chat-auth] local auth bootstrap skipped: ${formatError(err)}`);
  } finally {
    if (closePool) {
      await closePool();
    }
  }
}

main().catch((err) => {
  console.warn(`[chat-auth] unexpected failure: ${formatError(err)}`);
  process.exitCode = 0;
});
