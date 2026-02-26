import { createOpencodeClient, type OpencodeClient } from "@opencode-ai/sdk/v2/client";
import { eq, and, asc, isNotNull } from "drizzle-orm";
import { Sandbox } from "e2b";
import { env } from "@/env";
import { db } from "@/server/db/client";
import { skill, message, providerAuth, conversation, generation } from "@/server/db/schema";
import { resolvePreferredCommunitySkillsForUser } from "@/server/services/integration-skill-service";
import {
  COMPACTION_SUMMARY_PREFIX,
  SESSION_BOUNDARY_PREFIX,
} from "@/server/services/session-constants";
import { downloadFromS3 } from "@/server/storage/s3-client";
import { decrypt } from "@/server/utils/encryption";
import { logServerEvent, type ObservabilityContext } from "@/server/utils/observability";
import type { SandboxBackend, ExecuteResult } from "./types";

// Use custom template with OpenCode pre-installed
const TEMPLATE_NAME = env.E2B_DAYTONA_SANDBOX_NAME || "cmdclaw-agent-dev";
const SANDBOX_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes
const OPENCODE_PORT = 4096;

function resolveSandboxAppUrl(): string {
  const configuredUrl = env.E2B_CALLBACK_BASE_URL ?? env.APP_URL ?? env.NEXT_PUBLIC_APP_URL;
  if (!configuredUrl) {
    return "";
  }
  const parsed = new URL(configuredUrl);
  if (
    (parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1") &&
    process.env.NODE_ENV !== "production"
  ) {
    return "https://localcan.baptistecolle.com";
  }
  return configuredUrl;
}

interface SandboxState {
  sandbox: Sandbox;
  client: OpencodeClient;
  serverUrl: string;
  reused: boolean;
}

async function connectSandboxById(sandboxId: string): Promise<Sandbox | null> {
  const sandboxApi = Sandbox as unknown as {
    connect?: (id: string) => Promise<Sandbox>;
  };
  if (!sandboxApi.connect) {
    return null;
  }
  try {
    return await sandboxApi.connect(sandboxId);
  } catch {
    return null;
  }
}

function logLifecycle(
  event: string,
  details: Record<string, unknown>,
  context: ObservabilityContext = {},
): void {
  const enrichedContext: ObservabilityContext = { source: "e2b", ...context };
  logServerEvent("info", event, details, enrichedContext);
}

export interface SandboxConfig {
  conversationId: string;
  generationId?: string;
  userId?: string;
  anthropicApiKey: string;
  integrationEnvs?: Record<string, string>;
}

type SessionInitStage =
  | "sandbox_checking_cache"
  | "sandbox_reused"
  | "sandbox_creating"
  | "sandbox_created"
  | "opencode_starting"
  | "opencode_waiting_ready"
  | "opencode_ready"
  | "session_reused"
  | "session_creating"
  | "session_created"
  | "session_replay_started"
  | "session_replay_completed"
  | "session_init_completed";

type SessionInitLifecycleCallback = (
  stage: SessionInitStage,
  details?: Record<string, unknown>,
) => void;

function formatErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return `${error.name}: ${error.message}`;
  }
  return String(error);
}

/**
 * Wait for OpenCode server to be ready
 */
async function waitForServer(url: string, maxWait = 30000): Promise<void> {
  const start = Date.now();
  let attempts = 0;
  let lastError: string | null = null;
  while (true) {
    if (Date.now() - start >= maxWait) {
      throw new Error(
        `OpenCode server in sandbox failed to start (url=${url}, attempts=${attempts}, waitedMs=${Date.now() - start}, lastError=${lastError || "unknown"})`,
      );
    }

    attempts += 1;
    try {
      // eslint-disable-next-line no-await-in-loop -- readiness polling is intentional
      const res = await fetch(`${url}/doc`, { method: "GET" });
      if (res.ok) {
        return;
      }
      lastError = `status_${res.status}`;
    } catch {
      // Server not ready yet
      lastError = "network_error";
    }
    // eslint-disable-next-line no-await-in-loop -- readiness polling is intentional
    await new Promise((r) => setTimeout(r, 500));
  }
}

/**
 * Get or create a sandbox with OpenCode server running inside
 */
export async function getOrCreateSandbox(
  config: SandboxConfig,
  onLifecycle?: SessionInitLifecycleCallback,
  telemetry?: ObservabilityContext,
): Promise<SandboxState> {
  const telemetryContext: ObservabilityContext = {
    ...telemetry,
    source: "e2b",
    conversationId: config.conversationId,
    userId: config.userId,
  };
  onLifecycle?.("sandbox_checking_cache", {
    conversationId: config.conversationId,
  });

  const conv = await db.query.conversation.findFirst({
    where: eq(conversation.id, config.conversationId),
    columns: { currentGenerationId: true, opencodeSandboxId: true },
  });

  if (conv?.opencodeSandboxId) {
    const connected = await connectSandboxById(conv.opencodeSandboxId);
    if (connected) {
      const serverUrl = `https://${connected.getHost(OPENCODE_PORT)}`;
      const health = await fetch(`${serverUrl}/doc`, { method: "GET" }).catch(() => null);
      if (health?.ok) {
        onLifecycle?.("sandbox_reused", {
          conversationId: config.conversationId,
          sandboxId: connected.sandboxId,
        });
        const client = createOpencodeClient({ baseUrl: serverUrl });
        return {
          sandbox: connected,
          client,
          serverUrl,
          reused: true,
        };
      }
    }

    await db
      .update(conversation)
      .set({ opencodeSandboxId: null, opencodeSessionId: null })
      .where(eq(conversation.id, config.conversationId));
  }

  const persistedGeneration = conv?.currentGenerationId
    ? await db.query.generation.findFirst({
        where: and(
          eq(generation.id, conv.currentGenerationId),
          isNotNull(generation.sandboxId),
          eq(generation.status, "running"),
        ),
        columns: { sandboxId: true },
      })
    : await db.query.generation.findFirst({
        where: and(
          eq(generation.conversationId, config.conversationId),
          isNotNull(generation.sandboxId),
          eq(generation.status, "running"),
        ),
        orderBy: (fields, operators) => [operators.desc(fields.startedAt)],
        columns: { sandboxId: true },
      });

  if (persistedGeneration?.sandboxId) {
    const connected = await connectSandboxById(persistedGeneration.sandboxId);
    if (connected) {
      const serverUrl = `https://${connected.getHost(OPENCODE_PORT)}`;
      const health = await fetch(`${serverUrl}/doc`, { method: "GET" }).catch(() => null);
      if (health?.ok) {
        onLifecycle?.("sandbox_reused", {
          conversationId: config.conversationId,
          sandboxId: connected.sandboxId,
        });
        const client = createOpencodeClient({ baseUrl: serverUrl });
        return {
          sandbox: connected,
          client,
          serverUrl,
          reused: true,
        };
      }
    }
  }

  // Create new sandbox
  const hasApiKey = !!config.anthropicApiKey;
  const vmCreateStart = Date.now();
  onLifecycle?.("sandbox_creating", {
    conversationId: config.conversationId,
    template: TEMPLATE_NAME,
  });
  logLifecycle(
    "VM_START_REQUESTED",
    {
      conversationId: config.conversationId,
      template: TEMPLATE_NAME,
      hasAnthropicApiKey: hasApiKey,
      timeoutMs: SANDBOX_TIMEOUT_MS,
    },
    telemetryContext,
  );

  let sandbox: Sandbox;
  try {
    sandbox = await Sandbox.create(TEMPLATE_NAME, {
      envs: {
        ANTHROPIC_API_KEY: config.anthropicApiKey,
        ANVIL_API_KEY: env.ANVIL_API_KEY || "",
        APP_URL: resolveSandboxAppUrl(),
        CMDCLAW_SERVER_SECRET: env.CMDCLAW_SERVER_SECRET || "",
        CONVERSATION_ID: config.conversationId,
        GENERATION_ID: config.generationId ?? "",
        ...config.integrationEnvs,
      },
      timeoutMs: SANDBOX_TIMEOUT_MS,
    });
  } catch (error) {
    logServerEvent(
      "error",
      "VM_START_FAILED",
      {
        conversationId: config.conversationId,
        template: TEMPLATE_NAME,
        durationMs: Date.now() - vmCreateStart,
        error: formatErrorMessage(error),
        hasAnthropicApiKey: hasApiKey,
        hasE2BApiKey: Boolean(env.E2B_API_KEY),
        integrationEnvCount: Object.keys(config.integrationEnvs || {}).length,
      },
      telemetryContext,
    );
    throw error;
  }
  logLifecycle(
    "VM_STARTED",
    {
      conversationId: config.conversationId,
      sandboxId: sandbox.sandboxId,
      template: TEMPLATE_NAME,
      durationMs: Date.now() - vmCreateStart,
    },
    { ...telemetryContext, sandboxId: sandbox.sandboxId },
  );
  onLifecycle?.("sandbox_created", {
    conversationId: config.conversationId,
    sandboxId: sandbox.sandboxId,
    durationMs: Date.now() - vmCreateStart,
  });

  // Set SANDBOX_ID env var (needed by plugin)
  try {
    await sandbox.commands.run(`echo "export SANDBOX_ID=${sandbox.sandboxId}" >> ~/.bashrc`);
  } catch (error) {
    logServerEvent(
      "warn",
      "VM_SET_SANDBOX_ID_FAILED",
      {
        conversationId: config.conversationId,
        sandboxId: sandbox.sandboxId,
        error: formatErrorMessage(error),
      },
      { ...telemetryContext, sandboxId: sandbox.sandboxId },
    );
  }

  // Start OpenCode server in background
  logLifecycle(
    "OPENCODE_SERVER_START_REQUESTED",
    {
      conversationId: config.conversationId,
      sandboxId: sandbox.sandboxId,
      port: OPENCODE_PORT,
    },
    { ...telemetryContext, sandboxId: sandbox.sandboxId },
  );
  onLifecycle?.("opencode_starting", {
    conversationId: config.conversationId,
    sandboxId: sandbox.sandboxId,
    port: OPENCODE_PORT,
  });
  const stderrBuffer: string[] = [];
  try {
    await sandbox.commands.run(
      `export SANDBOX_ID=${sandbox.sandboxId} && cd /app && opencode serve --port ${OPENCODE_PORT} --hostname 0.0.0.0`,
      {
        background: true,
        onStderr: (data) => {
          const line = data.trim();
          if (!line) {
            return;
          }
          if (stderrBuffer.length >= 20) {
            stderrBuffer.shift();
          }
          stderrBuffer.push(line);
          logServerEvent(
            "warn",
            "OPENCODE_SERVER_STDERR",
            {
              conversationId: config.conversationId,
              sandboxId: sandbox.sandboxId,
              stderr: line,
            },
            { ...telemetryContext, sandboxId: sandbox.sandboxId },
          );
        },
      },
    );
  } catch (error) {
    logServerEvent(
      "error",
      "OPENCODE_SERVER_START_FAILED",
      {
        conversationId: config.conversationId,
        sandboxId: sandbox.sandboxId,
        error: formatErrorMessage(error),
      },
      { ...telemetryContext, sandboxId: sandbox.sandboxId },
    );
    throw error;
  }

  // Get the public URL for the sandbox port
  const serverUrl = `https://${sandbox.getHost(OPENCODE_PORT)}`;
  const serverReadyStart = Date.now();
  onLifecycle?.("opencode_waiting_ready", {
    conversationId: config.conversationId,
    sandboxId: sandbox.sandboxId,
    serverUrl,
  });
  try {
    await waitForServer(serverUrl);
  } catch (error) {
    logServerEvent(
      "error",
      "OPENCODE_SERVER_READY_TIMEOUT",
      {
        conversationId: config.conversationId,
        sandboxId: sandbox.sandboxId,
        serverUrl,
        durationMs: Date.now() - serverReadyStart,
        error: formatErrorMessage(error),
        recentStderr: stderrBuffer.join(" | ").slice(0, 4000),
      },
      { ...telemetryContext, sandboxId: sandbox.sandboxId },
    );
    throw error;
  }

  // Create SDK client pointing to sandbox's OpenCode server
  const client = createOpencodeClient({
    baseUrl: serverUrl,
  });

  logLifecycle(
    "OPENCODE_SERVER_READY",
    {
      conversationId: config.conversationId,
      sandboxId: sandbox.sandboxId,
      serverUrl,
      durationMs: Date.now() - serverReadyStart,
    },
    { ...telemetryContext, sandboxId: sandbox.sandboxId },
  );
  onLifecycle?.("opencode_ready", {
    conversationId: config.conversationId,
    sandboxId: sandbox.sandboxId,
    serverUrl,
    durationMs: Date.now() - serverReadyStart,
  });
  return { sandbox, client, serverUrl, reused: false };
}

/**
 * Get the OpenCode client for a conversation's sandbox
 */
export async function getSandboxStateDurable(
  conversationId: string,
): Promise<SandboxState | undefined> {
  const conv = await db.query.conversation.findFirst({
    where: eq(conversation.id, conversationId),
    columns: { currentGenerationId: true, opencodeSandboxId: true },
  });
  if (conv?.opencodeSandboxId) {
    const connectedByConversation = await connectSandboxById(conv.opencodeSandboxId);
    if (connectedByConversation) {
      const serverUrl = `https://${connectedByConversation.getHost(OPENCODE_PORT)}`;
      const health = await fetch(`${serverUrl}/doc`, { method: "GET" }).catch(() => null);
      if (health?.ok) {
        return {
          sandbox: connectedByConversation,
          client: createOpencodeClient({ baseUrl: serverUrl }),
          serverUrl,
          reused: true,
        };
      }
    }

    await db
      .update(conversation)
      .set({ opencodeSandboxId: null, opencodeSessionId: null })
      .where(eq(conversation.id, conversationId));
  }

  const gen = conv?.currentGenerationId
    ? await db.query.generation.findFirst({
        where: and(
          eq(generation.id, conv.currentGenerationId),
          isNotNull(generation.sandboxId),
          eq(generation.status, "running"),
        ),
        columns: { sandboxId: true },
      })
    : await db.query.generation.findFirst({
        where: and(
          eq(generation.conversationId, conversationId),
          isNotNull(generation.sandboxId),
          eq(generation.status, "running"),
        ),
        orderBy: (fields, operators) => [operators.desc(fields.startedAt)],
        columns: { sandboxId: true },
      });
  if (!gen?.sandboxId) {
    return undefined;
  }

  const connected = await connectSandboxById(gen.sandboxId);
  if (!connected) {
    return undefined;
  }
  const serverUrl = `https://${connected.getHost(OPENCODE_PORT)}`;
  const health = await fetch(`${serverUrl}/doc`, { method: "GET" }).catch(() => null);
  if (!health?.ok) {
    return undefined;
  }

  const hydrated: SandboxState = {
    sandbox: connected,
    client: createOpencodeClient({ baseUrl: serverUrl }),
    serverUrl,
    reused: true,
  };
  return hydrated;
}

/**
 * Get or create an OpenCode session within a sandbox
 * Handles conversation replay for session recovery
 */
export async function getOrCreateSession(
  config: SandboxConfig,
  options?: {
    title?: string;
    replayHistory?: boolean;
    onLifecycle?: SessionInitLifecycleCallback;
    telemetry?: ObservabilityContext;
  },
): Promise<{ client: OpencodeClient; sessionId: string; sandbox: Sandbox }> {
  const telemetryContext: ObservabilityContext = {
    ...options?.telemetry,
    source: "e2b",
    conversationId: config.conversationId,
    userId: config.userId,
  };
  const sessionInitStartedAt = Date.now();
  logLifecycle(
    "SESSION_INIT_STARTED",
    {
      conversationId: config.conversationId,
      replayHistory: Boolean(options?.replayHistory),
    },
    telemetryContext,
  );

  const state = await getOrCreateSandbox(config, options?.onLifecycle, telemetryContext);
  const conv = await db.query.conversation.findFirst({
    where: eq(conversation.id, config.conversationId),
    columns: { opencodeSessionId: true },
  });
  const existingSessionId = conv?.opencodeSessionId ?? null;

  // Reuse existing session only if we also reused the sandbox that owns it,
  // and the session ID is still valid on that sandbox's OpenCode server.
  if (existingSessionId && state.reused) {
    const existingSession = await state.client.session.get({ sessionID: existingSessionId });
    if (!existingSession.error && existingSession.data) {
      options?.onLifecycle?.("session_reused", {
        conversationId: config.conversationId,
        sessionId: existingSessionId,
        sandboxId: state.sandbox.sandboxId,
      });
      logLifecycle(
        "SESSION_REUSED",
        {
          conversationId: config.conversationId,
          sessionId: existingSessionId,
          sandboxId: state.sandbox.sandboxId,
          durationMs: Date.now() - sessionInitStartedAt,
        },
        {
          ...telemetryContext,
          sandboxId: state.sandbox.sandboxId,
          sessionId: existingSessionId,
        },
      );
      return {
        client: state.client,
        sessionId: existingSessionId,
        sandbox: state.sandbox,
      };
    }

    logLifecycle(
      "SESSION_REUSE_INVALID",
      {
        conversationId: config.conversationId,
        sessionId: existingSessionId,
        sandboxId: state.sandbox.sandboxId,
      },
      {
        ...telemetryContext,
        sandboxId: state.sandbox.sandboxId,
        sessionId: existingSessionId,
      },
    );
    await db
      .update(conversation)
      .set({ opencodeSessionId: null })
      .where(eq(conversation.id, config.conversationId));
  } else if (existingSessionId && !state.reused) {
    logLifecycle(
      "SESSION_REUSE_SKIPPED_SANDBOX_REPLACED",
      {
        conversationId: config.conversationId,
        sessionId: existingSessionId,
        sandboxId: state.sandbox.sandboxId,
      },
      {
        ...telemetryContext,
        sandboxId: state.sandbox.sandboxId,
        sessionId: existingSessionId,
      },
    );
    await db
      .update(conversation)
      .set({ opencodeSessionId: null })
      .where(eq(conversation.id, config.conversationId));
  }

  // Create a new session
  options?.onLifecycle?.("session_creating", {
    conversationId: config.conversationId,
    sandboxId: state.sandbox.sandboxId,
  });
  const sessionCreateStartedAt = Date.now();
  logLifecycle(
    "SESSION_CREATE_REQUESTED",
    {
      conversationId: config.conversationId,
      sandboxId: state.sandbox.sandboxId,
    },
    { ...telemetryContext, sandboxId: state.sandbox.sandboxId },
  );
  const sessionResult = await state.client.session.create({
    title: options?.title || "Conversation",
  });

  if (sessionResult.error || !sessionResult.data) {
    throw new Error("Failed to create OpenCode session");
  }

  const sessionId = sessionResult.data.id;
  logLifecycle(
    "SESSION_CREATED",
    {
      conversationId: config.conversationId,
      sessionId,
      sandboxId: state.sandbox.sandboxId,
      durationMs: Date.now() - sessionCreateStartedAt,
    },
    { ...telemetryContext, sandboxId: state.sandbox.sandboxId, sessionId },
  );
  options?.onLifecycle?.("session_created", {
    conversationId: config.conversationId,
    sessionId,
    sandboxId: state.sandbox.sandboxId,
    durationMs: Date.now() - sessionCreateStartedAt,
  });

  // Inject subscription provider tokens if userId is available
  if (config.userId) {
    await injectProviderAuth(state.client, config.userId);
  }

  // Replay conversation history if needed
  if (options?.replayHistory) {
    options?.onLifecycle?.("session_replay_started", {
      conversationId: config.conversationId,
      sessionId,
    });
    const replayStartedAt = Date.now();
    logLifecycle(
      "SESSION_REPLAY_STARTED",
      {
        conversationId: config.conversationId,
        sessionId,
      },
      { ...telemetryContext, sessionId },
    );
    await replayConversationHistory(state.client, sessionId, config.conversationId);
    logLifecycle(
      "SESSION_REPLAY_COMPLETED",
      {
        conversationId: config.conversationId,
        sessionId,
        durationMs: Date.now() - replayStartedAt,
      },
      { ...telemetryContext, sessionId },
    );
    options?.onLifecycle?.("session_replay_completed", {
      conversationId: config.conversationId,
      sessionId,
      durationMs: Date.now() - replayStartedAt,
    });
  }

  logLifecycle(
    "SESSION_INIT_COMPLETED",
    {
      conversationId: config.conversationId,
      sessionId,
      durationMs: Date.now() - sessionInitStartedAt,
    },
    { ...telemetryContext, sessionId, sandboxId: state.sandbox.sandboxId },
  );
  options?.onLifecycle?.("session_init_completed", {
    conversationId: config.conversationId,
    sessionId,
    durationMs: Date.now() - sessionInitStartedAt,
  });
  return { client: state.client, sessionId, sandbox: state.sandbox };
}

/**
 * Replay conversation history to a new OpenCode session
 * Uses noReply: true to inject context without generating a response
 */
async function replayConversationHistory(
  client: OpencodeClient,
  sessionId: string,
  conversationId: string,
): Promise<void> {
  // Fetch all messages for this conversation
  const messages = await db.query.message.findMany({
    where: eq(message.conversationId, conversationId),
    orderBy: asc(message.createdAt),
  });

  if (messages.length === 0) {
    return;
  }

  const boundaryIndex = messages.findLastIndex(
    (m) => m.role === "system" && m.content.startsWith(SESSION_BOUNDARY_PREFIX),
  );

  const sessionMessages = boundaryIndex >= 0 ? messages.slice(boundaryIndex + 1) : messages;

  const summaryIndex = sessionMessages.findLastIndex(
    (m) => m.role === "system" && m.content.startsWith(COMPACTION_SUMMARY_PREFIX),
  );

  const summaryMessage = summaryIndex >= 0 ? sessionMessages[summaryIndex] : undefined;
  const summaryText = summaryMessage
    ? summaryMessage.content.replace(COMPACTION_SUMMARY_PREFIX, "").trim()
    : null;

  const messagesAfterSummary =
    summaryIndex >= 0 ? sessionMessages.slice(summaryIndex + 1) : sessionMessages;

  // Build conversation context
  const historyContext = messagesAfterSummary
    .map((m) => {
      if (m.role === "user") {
        return `User: ${m.content}`;
      } else if (m.role === "assistant") {
        // Include tool uses and results for context
        if (m.contentParts) {
          const parts = m.contentParts
            .map((p) => {
              if (p.type === "text") {
                return p.text;
              }
              if (p.type === "tool_use") {
                return `[Used ${p.name}]`;
              }
              if (p.type === "tool_result") {
                return `[Result received]`;
              }
              return "";
            })
            .filter(Boolean)
            .join("\n");
          return `Assistant: ${parts}`;
        }
        return `Assistant: ${m.content}`;
      }
      return "";
    })
    .filter(Boolean)
    .join("\n\n");

  const summaryBlock = summaryText ? `Summary of previous conversation:\n${summaryText}\n\n` : "";

  // Inject history as context using noReply: true
  await client.session.prompt({
    sessionID: sessionId,
    parts: [
      {
        type: "text",
        text: `<conversation_history>\n${summaryBlock}${historyContext}\n</conversation_history>\n\nContinue this conversation. The user's next message follows.`,
      },
    ],
    noReply: true,
  });
}

/**
 * Inject stored subscription provider OAuth tokens into an OpenCode server.
 * Called after sandbox creation to give OpenCode access to the user's
 * ChatGPT/Gemini/Kimi subscriptions.
 */
export async function injectProviderAuth(client: OpencodeClient, userId: string): Promise<void> {
  try {
    const auths = await db.query.providerAuth.findMany({
      where: eq(providerAuth.userId, userId),
    });
    await Promise.all(
      auths.map(async (auth) => {
        try {
          const access = decrypt(auth.accessToken);

          if (auth.provider === "kimi") {
            await client.auth.set({
              providerID: "kimi-for-coding",
              auth: {
                type: "api",
                key: access,
              },
            });
            console.log(`[E2B] Injected kimi-for-coding auth for user ${userId}`);
            return;
          }

          await client.auth.set({
            providerID: auth.provider,
            auth: {
              type: "oauth",
              access,
              refresh: decrypt(auth.refreshToken),
              expires: auth.expiresAt.getTime(),
            },
          });
          console.log(`[E2B] Injected ${auth.provider} auth for user ${userId}`);
        } catch (err) {
          console.error(`[E2B] Failed to inject ${auth.provider} auth:`, err);
        }
      }),
    );
  } catch (err) {
    console.error("[E2B] Failed to load provider auths:", err);
  }
}

/**
 * Kill a sandbox for a conversation
 */
export async function killSandbox(conversationId: string): Promise<void> {
  const latestWithSandbox = await db.query.generation.findFirst({
    where: and(eq(generation.conversationId, conversationId), isNotNull(generation.sandboxId)),
    orderBy: (fields, operators) => [operators.desc(fields.startedAt)],
    columns: { sandboxId: true },
  });
  if (!latestWithSandbox?.sandboxId) {
    return;
  }
  const sandbox = await connectSandboxById(latestWithSandbox.sandboxId);
  if (!sandbox) {
    return;
  }
  const state: SandboxState = {
    sandbox,
    client: createOpencodeClient({ baseUrl: `https://${sandbox.getHost(OPENCODE_PORT)}` }),
    serverUrl: `https://${sandbox.getHost(OPENCODE_PORT)}`,
    reused: true,
  };
  try {
    await state.sandbox.kill();
    await db
      .update(conversation)
      .set({ opencodeSandboxId: null, opencodeSessionId: null })
      .where(eq(conversation.id, conversationId));
    logLifecycle(
      "VM_TERMINATED",
      {
        conversationId,
        sandboxId: state.sandbox.sandboxId,
        reason: "manual_kill",
      },
      { source: "e2b", conversationId, sandboxId: state.sandbox.sandboxId },
    );
  } catch (error) {
    console.error("[E2B] Failed to kill sandbox:", error);
  }
}

/**
 * Cleanup all sandboxes (call on server shutdown)
 */
export async function cleanupAllSandboxes(): Promise<void> {
  const knownSandboxes = await db.query.generation.findMany({
    where: isNotNull(generation.sandboxId),
    columns: { sandboxId: true },
  });
  const uniqueSandboxIds = Array.from(
    new Set(
      knownSandboxes
        .map((row) => row.sandboxId)
        .filter((sandboxId): sandboxId is string => !!sandboxId),
    ),
  );
  const promises = uniqueSandboxIds.map(async (sandboxId) => {
    const sandbox = await connectSandboxById(sandboxId);
    if (!sandbox) {
      return;
    }
    await sandbox.kill().catch(console.error);
  });
  await Promise.all(promises);
}

/**
 * Check if E2B is configured
 */
export function isE2BConfigured(): boolean {
  return !!env.E2B_API_KEY;
}

/**
 * Write user's skills to the sandbox as AGENTS.md format
 */
export async function writeSkillsToSandbox(sandbox: Sandbox, userId: string): Promise<string[]> {
  // Fetch all enabled skills for user with their files and documents
  const skills = await db.query.skill.findMany({
    where: and(eq(skill.userId, userId), eq(skill.enabled, true)),
    with: {
      files: true,
      documents: true,
    },
  });

  if (skills.length === 0) {
    return [];
  }

  console.log(`[E2B] Writing ${skills.length} skills to sandbox`);

  // Create skills directory
  await sandbox.commands.run("mkdir -p /app/.opencode/skills");

  const writtenSkills: string[] = [];
  let agentsContent = "# Custom Skills\n\n";

  await skills.reduce<Promise<void>>(async (prev, s) => {
    await prev;
    const skillDir = `/app/.opencode/skills/${s.name}`;
    await sandbox.commands.run(`mkdir -p "${skillDir}"`);

    // Add skill to AGENTS.md
    agentsContent += `## ${s.displayName}\n\n`;
    agentsContent += `${s.description}\n\n`;
    agentsContent += `Files available in: /app/.opencode/skills/${s.name}/\n\n`;

    await Promise.all(
      s.files.map(async (file) => {
        const filePath = `${skillDir}/${file.path}`;
        const lastSlash = filePath.lastIndexOf("/");
        const parentDir = filePath.substring(0, lastSlash);
        if (parentDir !== skillDir) {
          await sandbox.commands.run(`mkdir -p "${parentDir}"`);
        }
        await sandbox.files.write(filePath, file.content);
      }),
    );

    await Promise.all(
      s.documents.map(async (doc) => {
        try {
          const buffer = await downloadFromS3(doc.storageKey);
          const docPath = `${skillDir}/${doc.filename}`;
          const arrayBuffer = new Uint8Array(buffer).buffer;
          await sandbox.files.write(docPath, arrayBuffer);
          console.log(`[E2B] Written document: ${doc.filename} (${doc.sizeBytes} bytes)`);
        } catch (error) {
          console.error(`[E2B] Failed to write document ${doc.filename}:`, error);
        }
      }),
    );

    writtenSkills.push(s.name);
    console.log(
      `[E2B] Written skill: ${s.name} (${s.files.length} files, ${s.documents.length} documents)`,
    );
  }, Promise.resolve());

  // Write AGENTS.md
  await sandbox.files.write("/app/.opencode/AGENTS.md", agentsContent);

  return writtenSkills;
}

/**
 * Get the system prompt addition for skills
 */
export function getSkillsSystemPrompt(skillNames: string[]): string {
  if (skillNames.length === 0) {
    return "";
  }

  return `
# Custom Skills

You have access to custom skills in /app/.opencode/skills/. Each skill directory contains:
- A SKILL.md file with instructions
- Any associated documents (PDFs, images, etc.) at the same level

Available skills:
${skillNames.map((name) => `- ${name}`).join("\n")}

Read the SKILL.md file in each skill directory when relevant to the user's request.
`;
}

/**
 * Write resolved community integration skills selected by the user to sandbox.
 */
export async function writeResolvedIntegrationSkillsToSandbox(
  sandbox: Sandbox,
  userId: string,
  allowedSlugs?: string[],
): Promise<string[]> {
  const resolved = await resolvePreferredCommunitySkillsForUser(userId, allowedSlugs);
  if (resolved.length === 0) {
    return [];
  }

  await sandbox.commands.run("mkdir -p /app/.opencode/integration-skills");
  const written: string[] = [];

  await Promise.all(
    resolved.map(async (skill) => {
      const skillDir = `/app/.opencode/integration-skills/${skill.slug}`;
      await sandbox.commands.run(`mkdir -p "${skillDir}"`);

      await Promise.all(
        skill.files.map(async (file) => {
          const filePath = `${skillDir}/${file.path}`;
          const lastSlash = filePath.lastIndexOf("/");
          const parentDir = filePath.substring(0, lastSlash);
          if (parentDir !== skillDir) {
            await sandbox.commands.run(`mkdir -p "${parentDir}"`);
          }
          await sandbox.files.write(filePath, file.content);
        }),
      );

      written.push(skill.slug);
    }),
  );

  return written;
}

export function getIntegrationSkillsSystemPrompt(skillSlugs: string[]): string {
  if (skillSlugs.length === 0) {
    return "";
  }

  return `
# Community Integration Skills

Use community integration skills for these slugs (preferred over official skill variants):
${skillSlugs.map((slug) => `- ${slug}`).join("\n")}

Community files are available in:
/app/.opencode/integration-skills/<slug>/

When a slug is listed above, prioritize that community skill's SKILL.md and resources for that integration.
`;
}

// ========== E2BSandboxBackend ==========

/**
 * SandboxBackend implementation backed by E2B cloud sandboxes.
 * Wraps existing E2B functions into the SandboxBackend interface
 * for use alongside BYOCSandboxBackend.
 */
export class E2BSandboxBackend implements SandboxBackend {
  private sandbox: Sandbox | null = null;
  private conversationId: string | null = null;

  async setup(conversationId: string): Promise<void> {
    this.conversationId = conversationId;
    // Sandbox is lazily created via getOrCreateSandbox
  }

  async execute(
    command: string,
    opts?: { timeout?: number; env?: Record<string, string> },
  ): Promise<ExecuteResult> {
    if (!this.conversationId) {
      throw new Error("E2BSandboxBackend not set up");
    }
    const state = await getSandboxStateDurable(this.conversationId);
    if (!state) {
      throw new Error("No active sandbox for conversation");
    }

    const result = await state.sandbox.commands.run(command, {
      timeoutMs: opts?.timeout,
      envs: opts?.env,
    });

    return {
      exitCode: result.exitCode,
      stdout: result.stdout,
      stderr: result.stderr,
    };
  }

  async writeFile(path: string, content: string | Uint8Array): Promise<void> {
    if (!this.conversationId) {
      throw new Error("E2BSandboxBackend not set up");
    }
    const state = await getSandboxStateDurable(this.conversationId);
    if (!state) {
      throw new Error("No active sandbox for conversation");
    }

    if (typeof content === "string") {
      await state.sandbox.files.write(path, content);
    } else {
      await state.sandbox.files.write(path, content.buffer as ArrayBuffer);
    }
  }

  async readFile(path: string): Promise<string> {
    if (!this.conversationId) {
      throw new Error("E2BSandboxBackend not set up");
    }
    const state = await getSandboxStateDurable(this.conversationId);
    if (!state) {
      throw new Error("No active sandbox for conversation");
    }

    return await state.sandbox.files.read(path);
  }

  async teardown(): Promise<void> {
    if (this.conversationId) {
      await killSandbox(this.conversationId);
      this.conversationId = null;
      this.sandbox = null;
    }
  }

  isAvailable(): boolean {
    return isE2BConfigured();
  }
}
