import { Sandbox } from "e2b";
import { createOpencodeClient, type OpencodeClient } from "@opencode-ai/sdk/v2/client";
import { env } from "@/env";
import { db } from "@/server/db/client";
import { skill, message, providerAuth } from "@/server/db/schema";
import {
  COMPACTION_SUMMARY_PREFIX,
  SESSION_BOUNDARY_PREFIX,
} from "@/server/services/session-constants";
import { eq, and, asc } from "drizzle-orm";
import { downloadFromS3 } from "@/server/storage/s3-client";
import { decrypt } from "@/server/utils/encryption";
import { resolvePreferredCommunitySkillsForUser } from "@/server/services/integration-skill-service";
import { logServerEvent, type ObservabilityContext } from "@/server/utils/observability";
import type { SandboxBackend, ExecuteResult } from "./types";

// Use custom template with OpenCode pre-installed
const TEMPLATE_NAME = env.E2B_TEMPLATE || "bap-agent-dev";
const SANDBOX_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes
const OPENCODE_PORT = 4096;

// Cache of active sandboxes by conversation ID
interface SandboxState {
  sandbox: Sandbox;
  client: OpencodeClient;
  sessionId: string | null;
  serverUrl: string;
}

const activeSandboxes = new Map<string, SandboxState>();

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
  if (error instanceof Error) {return `${error.name}: ${error.message}`;}
  return String(error);
}

/**
 * Wait for OpenCode server to be ready
 */
async function waitForServer(url: string, maxWait = 30000): Promise<void> {
  const start = Date.now();
  let attempts = 0;
  let lastError: string | null = null;
  while (Date.now() - start < maxWait) {
    attempts += 1;
    try {
      const res = await fetch(`${url}/doc`, { method: "GET" });
      if (res.ok) {return;}
      lastError = `status_${res.status}`;
    } catch {
      // Server not ready yet
      lastError = "network_error";
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(
    `OpenCode server in sandbox failed to start (url=${url}, attempts=${attempts}, waitedMs=${Date.now() - start}, lastError=${lastError || "unknown"})`,
  );
}

/**
 * Get or create a sandbox with OpenCode server running inside
 */
export async function getOrCreateSandbox(
  config: SandboxConfig,
  onLifecycle?: SessionInitLifecycleCallback,
  telemetry?: ObservabilityContext,
): Promise<Sandbox> {
  const telemetryContext: ObservabilityContext = {
    ...telemetry,
    source: "e2b",
    conversationId: config.conversationId,
    userId: config.userId,
  };
  onLifecycle?.("sandbox_checking_cache", {
    conversationId: config.conversationId,
  });
  // Check if we have an active sandbox for this conversation
  let state = activeSandboxes.get(config.conversationId);

  if (state) {
    // Verify sandbox and OpenCode server are alive
    try {
      const res = await fetch(`${state.serverUrl}/doc`, { method: "GET" });
      if (res.ok) {
        onLifecycle?.("sandbox_reused", {
          conversationId: config.conversationId,
          sandboxId: state.sandbox.sandboxId,
        });
        logLifecycle(
          "VM_REUSED",
          {
            conversationId: config.conversationId,
            sandboxId: state.sandbox.sandboxId,
            serverUrl: state.serverUrl,
          },
          { ...telemetryContext, sandboxId: state.sandbox.sandboxId },
        );
        return state.sandbox;
      }
      logLifecycle(
        "VM_CACHE_HEALTHCHECK_NOT_OK",
        {
          conversationId: config.conversationId,
          sandboxId: state.sandbox.sandboxId,
          serverUrl: state.serverUrl,
          status: res.status,
        },
        { ...telemetryContext, sandboxId: state.sandbox.sandboxId },
      );
    } catch {
      // Sandbox or server is dead, remove from cache and create new one
      logLifecycle(
        "VM_CACHE_HEALTHCHECK_FAILED",
        {
          conversationId: config.conversationId,
          sandboxId: state.sandbox.sandboxId,
          serverUrl: state.serverUrl,
        },
        { ...telemetryContext, sandboxId: state.sandbox.sandboxId },
      );
      await state.sandbox.kill().catch(() => {});
      activeSandboxes.delete(config.conversationId);
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
        APP_URL:
          (env.APP_URL && new URL(env.APP_URL).hostname === "localhost"
            ? "https://localcan.baptistecolle.com"
            : env.APP_URL) || "",
        BAP_SERVER_SECRET: env.BAP_SERVER_SECRET || "",
        CONVERSATION_ID: config.conversationId,
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
      `cd /app && opencode serve --port ${OPENCODE_PORT} --hostname 0.0.0.0`,
      {
        background: true,
        onStderr: (data) => {
          const line = data.trim();
          if (!line) {return;}
          if (stderrBuffer.length >= 20) {stderrBuffer.shift();}
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

  state = { sandbox, client, sessionId: null, serverUrl };
  activeSandboxes.set(config.conversationId, state);

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
  return sandbox;
}

/**
 * Get the OpenCode client for a conversation's sandbox
 */
export function getOpencodeClient(conversationId: string): OpencodeClient | undefined {
  const state = activeSandboxes.get(conversationId);
  return state?.client;
}

/**
 * Get the sandbox state for a conversation
 */
export function getSandboxState(conversationId: string): SandboxState | undefined {
  return activeSandboxes.get(conversationId);
}

export function resetOpencodeSession(conversationId: string): void {
  const state = activeSandboxes.get(conversationId);
  if (state) {
    state.sessionId = null;
  }
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

  // Ensure sandbox exists
  await getOrCreateSandbox(config, options?.onLifecycle, telemetryContext);
  const state = activeSandboxes.get(config.conversationId);

  if (!state) {
    throw new Error("Sandbox state not found after creation");
  }

  // Reuse existing session if one already exists for this conversation
  if (state.sessionId) {
    options?.onLifecycle?.("session_reused", {
      conversationId: config.conversationId,
      sessionId: state.sessionId,
      sandboxId: state.sandbox.sandboxId,
    });
    logLifecycle(
      "SESSION_REUSED",
      {
        conversationId: config.conversationId,
        sessionId: state.sessionId,
        sandboxId: state.sandbox.sandboxId,
        durationMs: Date.now() - sessionInitStartedAt,
      },
      {
        ...telemetryContext,
        sandboxId: state.sandbox.sandboxId,
        sessionId: state.sessionId,
      },
    );
    return {
      client: state.client,
      sessionId: state.sessionId,
      sandbox: state.sandbox,
    };
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
  state.sessionId = sessionId;
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

  if (messages.length === 0) {return;}

  const boundaryIndex = messages
    .map((m, idx) =>
      m.role === "system" && m.content.startsWith(SESSION_BOUNDARY_PREFIX) ? idx : -1,
    )
    .filter((idx) => idx >= 0)
    .pop();

  const sessionMessages =
    boundaryIndex !== undefined ? messages.slice(boundaryIndex + 1) : messages;

  const summaryIndex = sessionMessages
    .map((m, idx) =>
      m.role === "system" && m.content.startsWith(COMPACTION_SUMMARY_PREFIX) ? idx : -1,
    )
    .filter((idx) => idx >= 0)
    .pop();

  const summaryMessage = summaryIndex !== undefined ? sessionMessages[summaryIndex] : undefined;
  const summaryText = summaryMessage
    ? summaryMessage.content.replace(COMPACTION_SUMMARY_PREFIX, "").trim()
    : null;

  const messagesAfterSummary =
    summaryIndex !== undefined ? sessionMessages.slice(summaryIndex + 1) : sessionMessages;

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
              if (p.type === "text") {return p.text;}
              if (p.type === "tool_use") {return `[Used ${p.name}]`;}
              if (p.type === "tool_result") {return `[Result received]`;}
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

    for (const auth of auths) {
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
          continue;
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
    }
  } catch (err) {
    console.error("[E2B] Failed to load provider auths:", err);
  }
}

/**
 * Kill a sandbox for a conversation
 */
export async function killSandbox(conversationId: string): Promise<void> {
  const state = activeSandboxes.get(conversationId);
  if (state) {
    try {
      await state.sandbox.kill();
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
    activeSandboxes.delete(conversationId);
  }
}

/**
 * Cleanup all sandboxes (call on server shutdown)
 */
export async function cleanupAllSandboxes(): Promise<void> {
  const promises = Array.from(activeSandboxes.values()).map((state) =>
    state.sandbox.kill().catch(console.error),
  );
  await Promise.all(promises);
  activeSandboxes.clear();
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

  for (const s of skills) {
    const skillDir = `/app/.opencode/skills/${s.name}`;
    await sandbox.commands.run(`mkdir -p "${skillDir}"`);

    // Add skill to AGENTS.md
    agentsContent += `## ${s.displayName}\n\n`;
    agentsContent += `${s.description}\n\n`;
    agentsContent += `Files available in: /app/.opencode/skills/${s.name}/\n\n`;

    // Write skill files (text-based, stored in DB)
    for (const file of s.files) {
      const filePath = `${skillDir}/${file.path}`;

      // Create parent directories if needed
      const lastSlash = filePath.lastIndexOf("/");
      const parentDir = filePath.substring(0, lastSlash);
      if (parentDir !== skillDir) {
        await sandbox.commands.run(`mkdir -p "${parentDir}"`);
      }

      await sandbox.files.write(filePath, file.content);
    }

    // Write skill documents (binary files from S3)
    for (const doc of s.documents) {
      try {
        const buffer = await downloadFromS3(doc.storageKey);
        const docPath = `${skillDir}/${doc.filename}`;
        const arrayBuffer = new Uint8Array(buffer).buffer;
        await sandbox.files.write(docPath, arrayBuffer);
        console.log(`[E2B] Written document: ${doc.filename} (${doc.sizeBytes} bytes)`);
      } catch (error) {
        console.error(`[E2B] Failed to write document ${doc.filename}:`, error);
      }
    }

    writtenSkills.push(s.name);
    console.log(
      `[E2B] Written skill: ${s.name} (${s.files.length} files, ${s.documents.length} documents)`,
    );
  }

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

  for (const skill of resolved) {
    const skillDir = `/app/.opencode/integration-skills/${skill.slug}`;
    await sandbox.commands.run(`mkdir -p "${skillDir}"`);

    for (const file of skill.files) {
      const filePath = `${skillDir}/${file.path}`;
      const lastSlash = filePath.lastIndexOf("/");
      const parentDir = filePath.substring(0, lastSlash);
      if (parentDir !== skillDir) {
        await sandbox.commands.run(`mkdir -p "${parentDir}"`);
      }
      await sandbox.files.write(filePath, file.content);
    }

    written.push(skill.slug);
  }

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
    const state = activeSandboxes.get(this.conversationId);
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
    const state = activeSandboxes.get(this.conversationId);
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
    const state = activeSandboxes.get(this.conversationId);
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
