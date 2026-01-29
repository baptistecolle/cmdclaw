import readline from "node:readline";
import { homedir, hostname, platform, arch } from "node:os";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createORPCClient } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";
import type { RouterClient } from "@orpc/server";
import type { AppRouter } from "../src/server/orpc";

type ChatConfig = {
  serverUrl: string;
  token: string;
};

type Args = {
  serverUrl?: string;
  conversationId?: string;
  autoApprove: boolean;
  showThinking: boolean;
  authOnly: boolean;
  resetAuth: boolean;
};

const DEFAULT_SERVER_URL = "http://localhost:3000";
const DEFAULT_CLIENT_ID = "bap-cli";
const BAP_DIR = join(homedir(), ".bap");
const CONFIG_PATH = join(BAP_DIR, "chat-config.json");

function parseArgs(argv: string[]): Args {
  const args: Args = {
    autoApprove: false,
    showThinking: false,
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
      case "--auto-approve":
        args.autoApprove = true;
        break;
      case "--show-thinking":
        args.showThinking = true;
        break;
      case "--auth":
        args.authOnly = true;
        break;
      case "--reset-auth":
        args.resetAuth = true;
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
  console.log("  --auth                    Run auth flow and exit");
  console.log("  --reset-auth              Clear saved token and re-auth");
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

  while (true) {
    const input = (await ask(rl, conversationId ? "followup> " : "chat> ")).trim();
    if (!input) {
      console.log("Bye.");
      return;
    }

    const result = await runGeneration(client, rl, input, conversationId, options);
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
  options: Args
): Promise<{ generationId: string; conversationId: string } | null> {
  let outputStarted = false;

  try {
    const { generationId, conversationId: convId } = await client.generation.startGeneration({
      conversationId,
      content,
      autoApprove: options.autoApprove,
    });

    const iterator = await client.generation.subscribeGeneration({ generationId });

    for await (const event of iterator) {
      switch (event.type) {
        case "text":
          process.stdout.write(event.content);
          outputStarted = true;
          break;
        case "thinking":
          if (options.showThinking) {
            process.stdout.write(`\n[thinking] ${event.content}\n`);
          }
          break;
        case "tool_use":
          process.stdout.write(`\n[tool_use] ${event.toolName}\n`);
          break;
        case "tool_result":
          process.stdout.write(`\n[tool_result] ${event.toolName}\n`);
          break;
        case "pending_approval":
          process.stdout.write(`\n[approval_needed] ${event.toolName}\n`);
          if (options.autoApprove) {
            await client.generation.submitApproval({
              generationId: event.generationId,
              toolUseId: event.toolUseId,
              decision: "approve",
            });
          } else {
            const decision = (await ask(rl, "Approve? (y/n) ")).trim().toLowerCase();
            await client.generation.submitApproval({
              generationId: event.generationId,
              toolUseId: event.toolUseId,
              decision: decision === "y" || decision === "yes" ? "approve" : "deny",
            });
          }
          break;
        case "approval_result":
          process.stdout.write(`\n[approval_${event.decision}] ${event.toolUseId}\n`);
          break;
        case "auth_needed":
          process.stdout.write(`\n[auth_needed] ${event.integrations.join(", ")}\n`);
          break;
        case "auth_progress":
          process.stdout.write(`\n[auth_progress] connected=${event.connected} remaining=${event.remaining.join(", ")}\n`);
          break;
        case "auth_result":
          process.stdout.write(`\n[auth_result] success=${event.success}\n`);
          break;
        case "done":
          if (outputStarted) process.stdout.write("\n");
          return { generationId: event.generationId, conversationId: event.conversationId };
        case "error":
          process.stdout.write(`\n[error] ${event.message}\n`);
          return { generationId, conversationId: convId };
        case "cancelled":
          process.stdout.write("\n[cancelled]\n");
          return { generationId, conversationId: convId };
        case "status_change":
          process.stdout.write(`\n[status] ${event.status}\n`);
          break;
        default:
          break;
      }
    }
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
  if (!config || !config.token || config.serverUrl !== serverUrl || args.authOnly || args.resetAuth) {
    config = await authenticate(serverUrl);
    if (!config) {
      process.exit(1);
    }
    if (args.authOnly) {
      process.exit(0);
    }
  }

  const client = createClient(serverUrl, config.token);
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

void main();
