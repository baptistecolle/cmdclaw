import { createORPCClient } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";
import type { RouterClient } from "@orpc/server";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import readline from "node:readline";
import type { AppRouter } from "../../src/server/orpc";

export type ChatConfig = {
  serverUrl: string;
  token: string;
};

const BAP_DIR = join(homedir(), ".bap");
const CONFIG_PATH = join(BAP_DIR, "chat-config.json");

export const DEFAULT_SERVER_URL = "http://localhost:3000";

export function ensureBapDir(): void {
  if (!existsSync(BAP_DIR)) {
    mkdirSync(BAP_DIR, { recursive: true });
  }
}

export function loadConfig(): ChatConfig | null {
  try {
    if (!existsSync(CONFIG_PATH)) {
      return null;
    }
    const raw = readFileSync(CONFIG_PATH, "utf-8");
    return JSON.parse(raw) as ChatConfig;
  } catch {
    return null;
  }
}

export function saveConfig(config: ChatConfig): void {
  ensureBapDir();
  writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), "utf-8");
}

export function clearConfig(): void {
  if (existsSync(CONFIG_PATH)) {
    writeFileSync(CONFIG_PATH, "{}", "utf-8");
  }
}

export function createRpcClient(serverUrl: string, token: string): RouterClient<AppRouter> {
  const link = new RPCLink({
    url: `${serverUrl}/api/rpc`,
    headers: () => ({ Authorization: `Bearer ${token}` }),
  });

  return createORPCClient(link) as RouterClient<AppRouter>;
}

export function createPrompt(): readline.Interface {
  return readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
}

export function ask(rl: readline.Interface, query: string): Promise<string> {
  return new Promise((resolve) => {
    rl.question(query, (answer) => resolve(answer));
  });
}
