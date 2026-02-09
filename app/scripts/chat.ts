import readline from "node:readline";
import { homedir, hostname, platform, arch } from "node:os";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, basename, resolve, extname } from "node:path";
import { createORPCClient } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";
import type { RouterClient } from "@orpc/server";
import type { AppRouter } from "../src/server/orpc";
import { createGenerationRuntime } from "../src/lib/generation-runtime";
import { runGenerationStream } from "../src/lib/generation-stream";

type ChatConfig = {
  serverUrl: string;
  token: string;
};

type Args = {
  serverUrl?: string;
  conversationId?: string;
  message?: string;
  token?: string;
  files: string[];
  autoApprove: boolean;
  showThinking: boolean;
  validatePersistence: boolean;
  authOnly: boolean;
  resetAuth: boolean;
};

const DEFAULT_SERVER_URL = "http://localhost:3000";
const DEFAULT_CLIENT_ID = "bap-cli";
const BAP_DIR = join(homedir(), ".bap");
const CONFIG_PATH = join(BAP_DIR, "chat-config.json");

function parseArgs(argv: string[]): Args {
  const args: Args = {
    files: [],
    autoApprove: false,
    showThinking: false,
    validatePersistence: true,
    authOnly: false,
    resetAuth: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    switch (arg) {
      case "--server":
      case "-s":
        args.serverUrl = argv[i + 1];
        i += 1;
        break;
      case "--conversation":
      case "-c":
        args.conversationId = argv[i + 1];
        i += 1;
        break;
      case "--message":
      case "-m":
        args.message = argv[i + 1];
        i += 1;
        break;
      case "--auto-approve":
        args.autoApprove = true;
        break;
      case "--show-thinking":
        args.showThinking = true;
        break;
      case "--no-validate":
        args.validatePersistence = false;
        break;
      case "--auth":
        args.authOnly = true;
        break;
      case "--reset-auth":
        args.resetAuth = true;
        break;
      case "--token":
        args.token = argv[i + 1];
        i += 1;
        break;
      case "--file":
      case "-f":
        args.files.push(argv[i + 1]!);
        i += 1;
        break;
      case "--help":
      case "-h":
        printHelp();
        process.exit(0);
      default:
        if (arg?.startsWith("-")) {
          console.error(`Unknown flag: ${arg}`);
          printHelp();
          process.exit(1);
        }
        break;
    }
  }

  return args;
}

function printHelp(): void {
  console.log("\nUsage: bun run chat [options]\n");
  console.log("Options:");
  console.log("  -s, --server <url>        Server URL (default http://localhost:3000)");
  console.log("  -c, --conversation <id>   Continue an existing conversation");
  console.log("  --auto-approve            Auto-approve tool calls");
  console.log("  --show-thinking           Print thinking events");
  console.log("  --no-validate             Skip persisted message validation");
  console.log("  --auth                    Run auth flow and exit");
  console.log("  --token <token>            Use provided auth token directly");
  console.log("  --reset-auth              Clear saved token and re-auth");
  console.log("  -f, --file <path>         Attach file (can be used multiple times)");
  console.log("  -h, --help                Show help\n");
}

function ensureBapDir(): void {
  if (!existsSync(BAP_DIR)) {
    mkdirSync(BAP_DIR, { recursive: true });
  }
}

function loadConfig(): ChatConfig | null {
  try {
    if (!existsSync(CONFIG_PATH)) return null;
    const raw = readFileSync(CONFIG_PATH, "utf-8");
    return JSON.parse(raw) as ChatConfig;
  } catch {
    return null;
  }
}

function saveConfig(config: ChatConfig): void {
  ensureBapDir();
  writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), "utf-8");
}

function clearConfig(): void {
  if (existsSync(CONFIG_PATH)) {
    writeFileSync(CONFIG_PATH, "{}", "utf-8");
  }
}

async function authenticate(serverUrl: string): Promise<ChatConfig | null> {
  console.log(`\nAuthenticating with ${serverUrl}\n`);

  let deviceCode: string;
  let userCode: string;
  let verificationUri: string;
  let interval = 5;
  let expiresIn = 1800;

  try {
    const res = await fetch(`${serverUrl}/api/auth/device/code`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        client_id: process.env.BAP_CLI_CLIENT_ID || DEFAULT_CLIENT_ID,
      }),
    });

    if (!res.ok) {
      console.error(`Failed to request device code: ${res.status}`);
      return null;
    }

    const data = await res.json();
    deviceCode = data.device_code;
    userCode = data.user_code;
    verificationUri = data.verification_uri_complete || data.verification_uri;
    interval = data.interval || 5;
    expiresIn = data.expires_in || 1800;
  } catch (err) {
    console.error("Could not connect to server:", err);
    return null;
  }

  console.log("Visit the following URL and enter the code:\n");
  console.log(`  ${verificationUri}\n`);
  console.log(`  Code: ${userCode}\n`);
  console.log("Waiting for approval...\n");

  let pollingInterval = interval * 1000;
  const deadline = Date.now() + expiresIn * 1000;

  while (Date.now() < deadline) {
    await sleep(pollingInterval);

    try {
      const res = await fetch(`${serverUrl}/api/auth/device/token`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          grant_type: "urn:ietf:params:oauth:grant-type:device_code",
          device_code: deviceCode,
          client_id: process.env.BAP_CLI_CLIENT_ID || DEFAULT_CLIENT_ID,
        }),
      });

      const data = await res.json();

      if (data.access_token) {
        const config: ChatConfig = {
          serverUrl,
          token: data.access_token,
        };
        saveConfig(config);
        console.log("Authenticated successfully.\n");
        return config;
      }

      if (data.error) {
        switch (data.error) {
          case "authorization_pending":
            break;
          case "slow_down":
            pollingInterval += 5000;
            break;
          case "expired_token":
            console.error("Code expired. Please try again.");
            return null;
          case "access_denied":
            console.error("Authentication denied.");
            return null;
          default:
            console.error(`Unexpected error: ${data.error}`);
            break;
        }
      }
    } catch {
      // retry
    }
  }

  console.error("Code expired. Please try again.");
  return null;
}

function createClient(serverUrl: string, token: string): RouterClient<AppRouter> {
  const link = new RPCLink({
    url: `${serverUrl}/api/rpc`,
    headers: () => ({ Authorization: `Bearer ${token}` }),
  });

  return createORPCClient(link) as RouterClient<AppRouter>;
}

function createPrompt(): readline.Interface {
  return readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
}

function ask(rl: readline.Interface, query: string): Promise<string> {
  return new Promise((resolve) => {
    rl.question(query, (answer) => resolve(answer));
  });
}

async function runChatLoop(
  client: RouterClient<AppRouter>,
  rl: readline.Interface,
  options: Args
): Promise<void> {
  let conversationId = options.conversationId;

  let pendingFiles: { name: string; mimeType: string; dataUrl: string }[] = [];

  // Attach files passed via --file on the first message
  for (const f of options.files) {
    try {
      pendingFiles.push(fileToAttachment(f));
      console.log(`Attached: ${basename(f)}`);
    } catch (e) {
      console.error(e instanceof Error ? e.message : String(e));
    }
  }

  while (true) {
    const input = (await ask(rl, conversationId ? "followup> " : "chat> ")).trim();
    if (!input) {
      console.log("Bye.");
      return;
    }

    // /file <path> command to attach a file before sending
    if (input.startsWith("/file ")) {
      const filePath = input.slice(6).trim();
      try {
        pendingFiles.push(fileToAttachment(filePath));
        console.log(`Attached: ${basename(filePath)} (${pendingFiles.length} file(s) pending)`);
      } catch (e) {
        console.error(e instanceof Error ? e.message : String(e));
      }
      continue;
    }

    const attachments = pendingFiles.length ? pendingFiles : undefined;
    pendingFiles = [];

    const result = await runGeneration(client, rl, input, conversationId, options, attachments);
    if (!result) {
      return;
    }

    conversationId = result.conversationId;
  }
}

async function runGeneration(
  client: RouterClient<AppRouter>,
  rl: readline.Interface,
  content: string,
  conversationId: string | undefined,
  options: Args,
  attachments?: { name: string; mimeType: string; dataUrl: string }[],
): Promise<{ generationId: string; conversationId: string } | null> {
  let outputStarted = false;
  const runtime = createGenerationRuntime();

  try {
    const result = await runGenerationStream({
      client,
      input: {
        conversationId,
        content,
        autoApprove: options.autoApprove,
        attachments: attachments?.length ? attachments : undefined,
      },
      callbacks: {
        onText: (text) => {
          process.stdout.write(text);
          runtime.handleText(text);
          outputStarted = true;
        },
        onThinking: (thinking) => {
          runtime.handleThinking(thinking);
          if (options.showThinking) {
            process.stdout.write(`\n[thinking] ${thinking.content}\n`);
          }
        },
        onToolUse: (toolUse) => {
          runtime.handleToolUse(toolUse);
          process.stdout.write(`\n[tool_use] ${toolUse.toolName}\n`);
        },
        onToolResult: (toolName, result) => {
          runtime.handleToolResult(toolName, result);
          process.stdout.write(`\n[tool_result] ${toolName}\n`);
        },
        onPendingApproval: async (approval) => {
          runtime.handlePendingApproval(approval);
          process.stdout.write(`\n[approval_needed] ${approval.toolName}\n`);
          if (options.autoApprove || !rl) {
            const decision = options.autoApprove ? "approve" : "deny";
            process.stdout.write(` -> auto-${decision}\n`);
            await client.generation.submitApproval({
              generationId: approval.generationId,
              toolUseId: approval.toolUseId,
              decision,
            });
            return;
          }

          const decision = (await ask(rl, "Approve? (y/n) ")).trim().toLowerCase();
          await client.generation.submitApproval({
            generationId: approval.generationId,
            toolUseId: approval.toolUseId,
            decision: decision === "y" || decision === "yes" ? "approve" : "deny",
          });
        },
        onApprovalResult: (toolUseId, decision) => {
          runtime.handleApprovalResult(toolUseId, decision);
          process.stdout.write(`\n[approval_${decision}] ${toolUseId}\n`);
        },
        onAuthNeeded: (auth) => {
          runtime.handleAuthNeeded(auth);
          process.stdout.write(`\n[auth_needed] ${auth.integrations.join(", ")}\n`);
        },
        onAuthProgress: (connected, remaining) => {
          runtime.handleAuthProgress(connected, remaining);
          process.stdout.write(`\n[auth_progress] connected=${connected} remaining=${remaining.join(", ")}\n`);
        },
        onAuthResult: (success) => {
          runtime.handleAuthResult(success);
          process.stdout.write(`\n[auth_result] success=${success}\n`);
        },
        onSandboxFile: (file) => {
          process.stdout.write(`\n[file] ${file.filename} (${file.path})\n`);
        },
        onStatusChange: (status) => {
          process.stdout.write(`\n[status] ${status}\n`);
        },
        onDone: async (doneGenerationId, doneConversationId, messageId) => {
          runtime.handleDone({
            generationId: doneGenerationId,
            conversationId: doneConversationId,
            messageId,
          });
          if (outputStarted) process.stdout.write("\n");
          if (options.validatePersistence) {
            await validatePersistedAssistantMessage(
              client,
              doneConversationId,
              messageId,
              runtime.buildAssistantMessage()
            );
          }
        },
        onError: (message) => {
          runtime.handleError();
          process.stdout.write(`\n[error] ${message}\n`);
        },
        onCancelled: () => {
          runtime.handleCancelled();
          process.stdout.write("\n[cancelled]\n");
        },
      },
    });

    if (!result) {
      throw new Error("Generation stream closed before a terminal event (done/error/cancelled)");
    }

    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`\nRequest failed: ${message}\n`);
    return null;
  }

  return null;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  if (args.resetAuth) {
    clearConfig();
  }

  const loaded = loadConfig();
  const serverUrl = args.serverUrl || loaded?.serverUrl || process.env.BAP_SERVER_URL || DEFAULT_SERVER_URL;

  let config = loaded;
  if (args.token) {
    config = { serverUrl, token: args.token };
    saveConfig(config);
  } else if (!config || !config.token || config.serverUrl !== serverUrl || args.authOnly || args.resetAuth) {
    config = await authenticate(serverUrl);
    if (!config) {
      process.exit(1);
    }
    if (args.authOnly) {
      process.exit(0);
    }
  }

  const client = createClient(serverUrl, config.token);

  if (args.message) {
    // Non-interactive: send a single message and exit
    const attachments = args.files.map(f => fileToAttachment(f));
    const result = await runGeneration(client, null as any, args.message, args.conversationId, args, attachments.length ? attachments : undefined);
    if (result) {
      console.log(`\n[conversation] ${result.conversationId}`);
    }
    process.exit(result ? 0 : 1);
  }

  const rl = createPrompt();

  rl.on("SIGINT", () => {
    console.log("\nBye.");
    rl.close();
    process.exit(0);
  });

  await runChatLoop(client, rl, args);
  rl.close();
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const MIME_MAP: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".pdf": "application/pdf",
  ".txt": "text/plain",
  ".json": "application/json",
  ".csv": "text/csv",
};

function fileToAttachment(filePath: string): { name: string; mimeType: string; dataUrl: string } {
  const resolved = resolve(filePath);
  if (!existsSync(resolved)) {
    throw new Error(`File not found: ${resolved}`);
  }
  const ext = extname(resolved).toLowerCase();
  const mimeType = MIME_MAP[ext] || "application/octet-stream";
  const data = readFileSync(resolved);
  const base64 = data.toString("base64");
  return {
    name: basename(resolved),
    mimeType,
    dataUrl: `data:${mimeType};base64,${base64}`,
  };
}

function normalizeText(input: string): string {
  return input.replace(/\s+/g, " ").trim();
}

async function validatePersistedAssistantMessage(
  client: RouterClient<AppRouter>,
  conversationId: string,
  messageId: string,
  expected: { content: string; parts: Array<{ type: string }> }
): Promise<void> {
  const conv = await client.conversation.get({ id: conversationId });
  const savedMessage = conv.messages.find((m) => m.id === messageId);

  if (!savedMessage) {
    throw new Error(`Validation failed: assistant message ${messageId} was not saved in conversation ${conversationId}`);
  }
  if (savedMessage.role !== "assistant") {
    throw new Error(`Validation failed: message ${messageId} saved with role ${savedMessage.role}, expected assistant`);
  }

  const persistedParts = Array.isArray(savedMessage.contentParts) ? savedMessage.contentParts : [];
  if (expected.parts.length > 0 && persistedParts.length === 0) {
    throw new Error("Validation failed: stream produced activity/text but saved message has no contentParts");
  }

  const normalizedStream = normalizeText(expected.content);
  if (normalizedStream.length === 0) {
    return;
  }

  const normalizedPersisted = normalizeText(savedMessage.content ?? "");
  if (!normalizedPersisted.includes(normalizedStream)) {
    throw new Error("Validation failed: streamed assistant text does not match saved message content");
  }
}

void main();
