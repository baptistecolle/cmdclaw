import { createOpencodeClient, type OpencodeClient } from "@opencode-ai/sdk/v2/client";
import { and, asc, eq, isNotNull } from "drizzle-orm";
import type { ObservabilityContext } from "@/server/utils/observability";
import { env } from "@/env";
import { db } from "@/server/db/client";
import { conversation, generation, message, type ContentPart } from "@/server/db/schema";
import {
  getOrCreateSession as getOrCreateE2BSession,
  injectProviderAuth,
  getSkillsSystemPrompt,
  getIntegrationSkillsSystemPrompt,
  writeResolvedIntegrationSkillsToSandbox as writeResolvedIntegrationSkillsToE2B,
  writeSkillsToSandbox as writeSkillsToE2B,
} from "@/server/sandbox/e2b";
import { getPreferredCloudSandboxProvider } from "@/server/sandbox/factory";
import {
  COMPACTION_SUMMARY_PREFIX,
  SESSION_BOUNDARY_PREFIX,
} from "@/server/services/session-constants";

const DEFAULT_DAYTONA_SNAPSHOT = "cmdclaw-agent-dev";
const OPENCODE_PORT = 4096;

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

export type OpenCodeCommandResult = {
  exitCode: number;
  stdout: string;
  stderr: string;
};

export type OpenCodeSandbox = {
  provider: "e2b" | "daytona";
  sandboxId: string;
  commands: {
    run: (
      command: string,
      opts?: {
        timeoutMs?: number;
        envs?: Record<string, string>;
        background?: boolean;
        onStderr?: (chunk: string) => void;
      },
    ) => Promise<OpenCodeCommandResult>;
  };
  files: {
    write: (path: string, content: string | ArrayBuffer) => Promise<void>;
    read: (path: string) => Promise<string>;
  };
};

export interface OpenCodeSessionConfig {
  conversationId: string;
  generationId?: string;
  userId?: string;
  anthropicApiKey: string;
  integrationEnvs?: Record<string, string>;
}

type DaytonaSandboxLike = {
  id: string;
  state?: string;
  start?: () => Promise<void>;
  waitUntilStarted?: (timeoutSeconds?: number) => Promise<void>;
  getPreviewLink: (port: number) => Promise<{ url: string; token?: string }>;
  process: {
    executeCommand: (
      command: string,
      cwd?: string,
      env?: Record<string, string>,
      timeout?: number,
    ) => Promise<{
      exitCode?: number;
      result?: string;
      stdout?: string;
      stderr?: string;
    }>;
  };
  fs: {
    uploadFile: (source: Buffer, destination: string, timeout?: number) => Promise<void>;
    downloadFile: (path: string, timeout?: number) => Promise<Buffer | string>;
  };
};

function escapeShell(value: string): string {
  return `'${value.replace(/'/g, `"'"'`)}'`;
}

function appendDaytonaAuth(url: string, token?: string): string {
  if (!token) {
    return url;
  }
  const parsed = new URL(url);
  if (!parsed.searchParams.has("DAYTONA_SANDBOX_AUTH_KEY")) {
    parsed.searchParams.set("DAYTONA_SANDBOX_AUTH_KEY", token);
  }
  return parsed.toString();
}

function withPath(url: string, path: string): string {
  const parsed = new URL(url);
  const normalizedBasePath = parsed.pathname.endsWith("/")
    ? parsed.pathname.slice(0, -1)
    : parsed.pathname;
  const normalizedNextPath = path.startsWith("/") ? path : `/${path}`;
  parsed.pathname = `${normalizedBasePath}${normalizedNextPath}`;
  return parsed.toString();
}

function createDaytonaOpencodeClient(baseUrl: string, token?: string): OpencodeClient {
  if (!token) {
    return createOpencodeClient({ baseUrl });
  }

  const authedFetch = (
    input: Parameters<typeof fetch>[0],
    init?: Parameters<typeof fetch>[1],
  ): ReturnType<typeof fetch> => {
    if (input instanceof Request) {
      const authedUrl = appendDaytonaAuth(input.url, token);
      return fetch(new Request(authedUrl, input), init);
    }

    const authedUrl = appendDaytonaAuth(String(input), token);
    return fetch(authedUrl, init);
  };

  return createOpencodeClient({
    baseUrl,
    fetch: authedFetch as typeof fetch,
  });
}

async function waitForServer(url: string, token?: string, maxWait = 30_000): Promise<void> {
  const readinessUrl = appendDaytonaAuth(withPath(url, "/doc"), token);
  const startedAt = Date.now();
  while (Date.now() - startedAt < maxWait) {
    try {
      // eslint-disable-next-line no-await-in-loop -- readiness polling is intentional
      const response = await fetch(readinessUrl, { method: "GET" });
      if (response.ok) {
        return;
      }
    } catch {
      // The server is still starting.
    }
    // eslint-disable-next-line no-await-in-loop -- readiness polling is intentional
    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  throw new Error(
    `OpenCode server failed readiness check (url=${readinessUrl}, waitedMs=${maxWait})`,
  );
}

function wrapDaytonaSandbox(sandbox: DaytonaSandboxLike): OpenCodeSandbox {
  return {
    provider: "daytona",
    sandboxId: sandbox.id,
    commands: {
      run: async (command, opts) => {
        const timeoutSeconds = opts?.timeoutMs ? Math.max(1, Math.ceil(opts.timeoutMs / 1000)) : 0;
        const effectiveCommand = opts?.background
          ? `sh -lc ${escapeShell(`(${command}) >/tmp/opencode-bg.log 2>&1 &`)}`
          : command;
        const result = await sandbox.process.executeCommand(
          effectiveCommand,
          "/app",
          opts?.envs,
          timeoutSeconds,
        );
        const stderr = result.stderr ?? "";
        if (stderr && opts?.onStderr) {
          for (const line of stderr.split("\n")) {
            if (line.trim()) {
              opts.onStderr(line);
            }
          }
        }
        return {
          exitCode: result.exitCode ?? 0,
          stdout: result.stdout ?? result.result ?? "",
          stderr,
        };
      },
    },
    files: {
      write: async (path, content) => {
        const normalized =
          typeof content === "string" ? Buffer.from(content, "utf8") : Buffer.from(content);
        await sandbox.fs.uploadFile(normalized, path);
      },
      read: async (path) => {
        const raw = await sandbox.fs.downloadFile(path);
        return typeof raw === "string" ? raw : Buffer.from(raw).toString("utf8");
      },
    },
  };
}

async function createDaytonaClient() {
  const { Daytona } = await import("@daytonaio/sdk");
  return new Daytona({
    ...(process.env.DAYTONA_API_KEY ? { apiKey: process.env.DAYTONA_API_KEY } : {}),
    ...(process.env.DAYTONA_SERVER_URL ? { serverUrl: process.env.DAYTONA_SERVER_URL } : {}),
    ...(process.env.DAYTONA_TARGET ? { target: process.env.DAYTONA_TARGET } : {}),
  });
}

async function connectDaytonaSandboxById(sandboxId: string): Promise<DaytonaSandboxLike | null> {
  try {
    const daytona = await createDaytonaClient();
    const sandbox = (await daytona.get(sandboxId)) as DaytonaSandboxLike;
    if (sandbox.state && sandbox.state !== "started") {
      await sandbox.start?.();
      await sandbox.waitUntilStarted?.(60);
    }
    return sandbox;
  } catch {
    return null;
  }
}

async function getOrCreateDaytonaSandbox(
  config: OpenCodeSessionConfig,
  onLifecycle?: SessionInitLifecycleCallback,
): Promise<{ sandbox: OpenCodeSandbox; client: OpencodeClient; reused: boolean }> {
  onLifecycle?.("sandbox_checking_cache", { conversationId: config.conversationId });

  const conv = await db.query.conversation.findFirst({
    where: eq(conversation.id, config.conversationId),
    columns: { currentGenerationId: true, opencodeSandboxId: true },
  });

  const fromConversation = conv?.opencodeSandboxId
    ? await connectDaytonaSandboxById(conv.opencodeSandboxId)
    : null;

  if (fromConversation) {
    const preview = await fromConversation.getPreviewLink(OPENCODE_PORT);
    const baseUrl = preview.url;
    const health = await fetch(appendDaytonaAuth(withPath(baseUrl, "/doc"), preview.token), {
      method: "GET",
    }).catch(() => null);
    if (health?.ok) {
      onLifecycle?.("sandbox_reused", {
        conversationId: config.conversationId,
        sandboxId: fromConversation.id,
      });
      return {
        sandbox: wrapDaytonaSandbox(fromConversation),
        client: createDaytonaOpencodeClient(baseUrl, preview.token),
        reused: true,
      };
    }
  }

  if (conv?.opencodeSandboxId) {
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

  const fromGeneration = persistedGeneration?.sandboxId
    ? await connectDaytonaSandboxById(persistedGeneration.sandboxId)
    : null;

  if (fromGeneration) {
    const preview = await fromGeneration.getPreviewLink(OPENCODE_PORT);
    const baseUrl = preview.url;
    const health = await fetch(appendDaytonaAuth(withPath(baseUrl, "/doc"), preview.token), {
      method: "GET",
    }).catch(() => null);
    if (health?.ok) {
      onLifecycle?.("sandbox_reused", {
        conversationId: config.conversationId,
        sandboxId: fromGeneration.id,
      });
      return {
        sandbox: wrapDaytonaSandbox(fromGeneration),
        client: createDaytonaOpencodeClient(baseUrl, preview.token),
        reused: true,
      };
    }
  }

  onLifecycle?.("sandbox_creating", {
    conversationId: config.conversationId,
    template: env.E2B_DAYTONA_SANDBOX_NAME || DEFAULT_DAYTONA_SNAPSHOT,
  });

  const daytona = await createDaytonaClient();
  const created = (await daytona.create({
    snapshot: env.E2B_DAYTONA_SANDBOX_NAME || DEFAULT_DAYTONA_SNAPSHOT,
    envVars: {
      ANTHROPIC_API_KEY: config.anthropicApiKey,
      ANVIL_API_KEY: env.ANVIL_API_KEY || "",
      APP_URL: env.APP_URL || env.NEXT_PUBLIC_APP_URL || "",
      CMDCLAW_SERVER_SECRET: env.CMDCLAW_SERVER_SECRET || "",
      CONVERSATION_ID: config.conversationId,
      GENERATION_ID: config.generationId ?? "",
      ...config.integrationEnvs,
    },
  })) as DaytonaSandboxLike;

  onLifecycle?.("sandbox_created", {
    conversationId: config.conversationId,
    sandboxId: created.id,
  });

  onLifecycle?.("opencode_starting", {
    conversationId: config.conversationId,
    sandboxId: created.id,
    port: OPENCODE_PORT,
  });

  await created.process.executeCommand(
    `sh -lc ${escapeShell(`export SANDBOX_ID=${created.id} && cd /app && nohup opencode serve --port ${OPENCODE_PORT} --hostname 0.0.0.0 >/tmp/opencode.log 2>&1 &`)}`,
    "/app",
    undefined,
    10,
  );

  const preview = await created.getPreviewLink(OPENCODE_PORT);
  const baseUrl = preview.url;

  onLifecycle?.("opencode_waiting_ready", {
    conversationId: config.conversationId,
    sandboxId: created.id,
    serverUrl: preview.url,
  });

  await waitForServer(baseUrl, preview.token);

  onLifecycle?.("opencode_ready", {
    conversationId: config.conversationId,
    sandboxId: created.id,
    serverUrl: preview.url,
  });

  return {
    sandbox: wrapDaytonaSandbox(created),
    client: createDaytonaOpencodeClient(baseUrl, preview.token),
    reused: false,
  };
}

async function getOrCreateDaytonaSession(
  config: OpenCodeSessionConfig,
  options?: {
    title?: string;
    replayHistory?: boolean;
    onLifecycle?: SessionInitLifecycleCallback;
    telemetry?: ObservabilityContext;
  },
): Promise<{ client: OpencodeClient; sessionId: string; sandbox: OpenCodeSandbox }> {
  const state = await getOrCreateDaytonaSandbox(config, options?.onLifecycle);
  const conv = await db.query.conversation.findFirst({
    where: eq(conversation.id, config.conversationId),
    columns: { opencodeSessionId: true },
  });
  const existingSessionId = conv?.opencodeSessionId ?? null;

  if (existingSessionId && state.reused) {
    const existingSession = await state.client.session.get({ sessionID: existingSessionId });
    if (!existingSession.error && existingSession.data) {
      options?.onLifecycle?.("session_reused", {
        conversationId: config.conversationId,
        sessionId: existingSessionId,
        sandboxId: state.sandbox.sandboxId,
      });
      return {
        client: state.client,
        sessionId: existingSessionId,
        sandbox: state.sandbox,
      };
    }

    await db
      .update(conversation)
      .set({ opencodeSessionId: null })
      .where(eq(conversation.id, config.conversationId));
  } else if (existingSessionId && !state.reused) {
    await db
      .update(conversation)
      .set({ opencodeSessionId: null })
      .where(eq(conversation.id, config.conversationId));
  }

  options?.onLifecycle?.("session_creating", {
    conversationId: config.conversationId,
    sandboxId: state.sandbox.sandboxId,
  });

  const sessionResult = await state.client.session.create({
    title: options?.title || "Conversation",
  });

  if (sessionResult.error || !sessionResult.data) {
    const details = sessionResult.error ? JSON.stringify(sessionResult.error) : "missing_data";
    throw new Error(`Failed to create OpenCode session: ${details}`);
  }

  const sessionId = sessionResult.data.id;
  options?.onLifecycle?.("session_created", {
    conversationId: config.conversationId,
    sessionId,
    sandboxId: state.sandbox.sandboxId,
  });

  if (config.userId) {
    await injectProviderAuth(state.client, config.userId);
  }

  if (options?.replayHistory) {
    options.onLifecycle?.("session_replay_started", {
      conversationId: config.conversationId,
      sessionId,
    });
    await replayConversationHistory(state.client, sessionId, config.conversationId);
    options.onLifecycle?.("session_replay_completed", {
      conversationId: config.conversationId,
      sessionId,
    });
  }

  options?.onLifecycle?.("session_init_completed", {
    conversationId: config.conversationId,
    sessionId,
  });

  return {
    client: state.client,
    sessionId,
    sandbox: state.sandbox,
  };
}

async function replayConversationHistory(
  client: OpencodeClient,
  sessionId: string,
  conversationId: string,
): Promise<void> {
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

  const historyContext = messagesAfterSummary
    .map((m) => {
      if (m.role === "user") {
        return `User: ${m.content}`;
      }
      if (m.role === "assistant") {
        if (m.contentParts) {
          const parts = m.contentParts
            .map((p) => {
              const part = p as ContentPart;
              if (part.type === "text") {
                return part.text;
              }
              if (part.type === "tool_use") {
                return `[Used ${part.name}]`;
              }
              if (part.type === "tool_result") {
                return "[Result received]";
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

export async function getOrCreateSession(
  config: OpenCodeSessionConfig,
  options?: {
    title?: string;
    replayHistory?: boolean;
    onLifecycle?: SessionInitLifecycleCallback;
    telemetry?: ObservabilityContext;
  },
): Promise<{ client: OpencodeClient; sessionId: string; sandbox: OpenCodeSandbox }> {
  const provider = getPreferredCloudSandboxProvider();
  if (provider === "daytona") {
    return getOrCreateDaytonaSession(config, options);
  }

  const e2bSession = await getOrCreateE2BSession(config, options);
  return {
    client: e2bSession.client,
    sessionId: e2bSession.sessionId,
    sandbox: {
      provider: "e2b",
      sandboxId: e2bSession.sandbox.sandboxId,
      commands: {
        run: async (command, opts) => {
          const result = await e2bSession.sandbox.commands.run(command, {
            timeoutMs: opts?.timeoutMs,
            envs: opts?.envs,
            background: opts?.background,
            onStderr: opts?.onStderr,
          });
          return {
            exitCode: result.exitCode ?? 0,
            stdout: result.stdout ?? "",
            stderr: result.stderr ?? "",
          };
        },
      },
      files: {
        write: async (path, content) => {
          await e2bSession.sandbox.files.write(path, content);
        },
        read: async (path) => e2bSession.sandbox.files.read(path),
      },
    },
  };
}

export async function writeSkillsToSandbox(
  sandbox: OpenCodeSandbox,
  userId: string,
): Promise<string[]> {
  return writeSkillsToE2B(sandbox as never, userId);
}

export async function writeResolvedIntegrationSkillsToSandbox(
  sandbox: OpenCodeSandbox,
  userId: string,
  allowedSlugs?: string[],
): Promise<string[]> {
  return writeResolvedIntegrationSkillsToE2B(sandbox as never, userId, allowedSlugs);
}

export { getIntegrationSkillsSystemPrompt, getSkillsSystemPrompt };
