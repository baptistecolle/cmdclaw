import { Sandbox } from "e2b";
import { createOpencodeClient, type OpencodeClient } from "@opencode-ai/sdk";
import { env } from "@/env";
import { db } from "@/server/db/client";
import { skill, message, conversation } from "@/server/db/schema";
import { eq, and, asc } from "drizzle-orm";
import { downloadFromS3 } from "@/server/storage/s3-client";

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

export interface SandboxConfig {
  conversationId: string;
  anthropicApiKey: string;
  integrationEnvs?: Record<string, string>;
}

/**
 * Wait for OpenCode server to be ready
 */
async function waitForServer(url: string, maxWait = 30000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < maxWait) {
    try {
      const res = await fetch(`${url}/doc`, { method: "GET" });
      if (res.ok) return;
    } catch {
      // Server not ready yet
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error("OpenCode server in sandbox failed to start");
}

/**
 * Get or create a sandbox with OpenCode server running inside
 */
export async function getOrCreateSandbox(config: SandboxConfig): Promise<Sandbox> {
  // Check if we have an active sandbox for this conversation
  let state = activeSandboxes.get(config.conversationId);

  if (state) {
    // Verify sandbox and OpenCode server are alive
    try {
      const res = await fetch(`${state.serverUrl}/doc`, { method: "GET" });
      if (res.ok) return state.sandbox;
    } catch {
      // Sandbox or server is dead, remove from cache and create new one
      await state.sandbox.kill().catch(() => {});
      activeSandboxes.delete(config.conversationId);
    }
  }

  // Create new sandbox
  const hasApiKey = !!config.anthropicApiKey;
  console.log("[E2B] Creating sandbox from template:", TEMPLATE_NAME);
  console.log("[E2B] API key:", hasApiKey ? "present" : "MISSING");

  const sandbox = await Sandbox.create(TEMPLATE_NAME, {
    envs: {
      ANTHROPIC_API_KEY: config.anthropicApiKey,
      APP_URL: env.APP_URL || "",
      BAP_SERVER_SECRET: env.BAP_SERVER_SECRET || "",
      CONVERSATION_ID: config.conversationId,
      ...config.integrationEnvs,
    },
    timeoutMs: SANDBOX_TIMEOUT_MS,
  });

  // Set SANDBOX_ID env var (needed by plugin)
  await sandbox.commands.run(
    `echo "export SANDBOX_ID=${sandbox.sandboxId}" >> ~/.bashrc`
  );

  // Start OpenCode server in background
  console.log("[E2B] Starting OpenCode server...");
  sandbox.commands.run(
    `cd /app && opencode serve --port ${OPENCODE_PORT} --hostname 0.0.0.0`,
    {
      background: true,
      onStderr: (data) => console.error("[OpenCode stderr]", data),
    }
  );

  // Get the public URL for the sandbox port
  const serverUrl = `https://${sandbox.getHost(OPENCODE_PORT)}`;
  await waitForServer(serverUrl);

  // Create SDK client pointing to sandbox's OpenCode server
  const client = createOpencodeClient({
    baseUrl: serverUrl,
  });

  state = { sandbox, client, sessionId: null, serverUrl };
  activeSandboxes.set(config.conversationId, state);

  console.log("[E2B] OpenCode server ready at:", serverUrl);
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

/**
 * Get or create an OpenCode session within a sandbox
 * Handles conversation replay for session recovery
 */
export async function getOrCreateSession(
  config: SandboxConfig,
  options?: { title?: string; replayHistory?: boolean }
): Promise<{ client: OpencodeClient; sessionId: string; sandbox: Sandbox }> {
  // Ensure sandbox exists
  const sandbox = await getOrCreateSandbox(config);
  const state = activeSandboxes.get(config.conversationId);

  if (!state) {
    throw new Error("Sandbox state not found after creation");
  }

  // Create a new session
  const sessionResult = await state.client.session.create({
    body: { title: options?.title || "Conversation" },
  });

  if (sessionResult.error || !sessionResult.data) {
    throw new Error("Failed to create OpenCode session");
  }

  const sessionId = sessionResult.data.id;
  state.sessionId = sessionId;

  // Replay conversation history if needed
  if (options?.replayHistory) {
    await replayConversationHistory(
      state.client,
      sessionId,
      config.conversationId
    );
  }

  return { client: state.client, sessionId, sandbox: state.sandbox };
}

/**
 * Replay conversation history to a new OpenCode session
 * Uses noReply: true to inject context without generating a response
 */
async function replayConversationHistory(
  client: OpencodeClient,
  sessionId: string,
  conversationId: string
): Promise<void> {
  // Fetch all messages for this conversation
  const messages = await db.query.message.findMany({
    where: eq(message.conversationId, conversationId),
    orderBy: asc(message.createdAt),
  });

  if (messages.length === 0) return;

  // Build conversation context
  const historyContext = messages
    .map((m) => {
      if (m.role === "user") {
        return `User: ${m.content}`;
      } else if (m.role === "assistant") {
        // Include tool uses and results for context
        if (m.contentParts) {
          const parts = m.contentParts
            .map((p) => {
              if (p.type === "text") return p.text;
              if (p.type === "tool_use") return `[Used ${p.name}]`;
              if (p.type === "tool_result") return `[Result received]`;
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

  // Inject history as context using noReply: true
  await client.session.prompt({
    path: { id: sessionId },
    body: {
      parts: [
        {
          type: "text",
          text: `<conversation_history>\n${historyContext}\n</conversation_history>\n\nContinue this conversation. The user's next message follows.`,
        },
      ],
      noReply: true,
    },
  });
}

/**
 * Kill a sandbox for a conversation
 */
export async function killSandbox(conversationId: string): Promise<void> {
  const state = activeSandboxes.get(conversationId);
  if (state) {
    try {
      await state.sandbox.kill();
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
    state.sandbox.kill().catch(console.error)
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
export async function writeSkillsToSandbox(
  sandbox: Sandbox,
  userId: string
): Promise<string[]> {
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
        console.log(
          `[E2B] Written document: ${doc.filename} (${doc.sizeBytes} bytes)`
        );
      } catch (error) {
        console.error(`[E2B] Failed to write document ${doc.filename}:`, error);
      }
    }

    writtenSkills.push(s.name);
    console.log(
      `[E2B] Written skill: ${s.name} (${s.files.length} files, ${s.documents.length} documents)`
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

