import type { RouterClient } from "@orpc/server";
import { createORPCClient } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import readline from "node:readline";
import type { AppRouter } from "../../src/server/orpc";

export type ChatConfig = {
  serverUrl: string;
  token: string;
};

const CMDCLAW_DIR = join(homedir(), ".cmdclaw");
const PROFILES_DIR = join(CMDCLAW_DIR, "profiles");

export const DEFAULT_SERVER_URL = "http://localhost:3000";

export function ensureCmdClawDir(): void {
  if (!existsSync(CMDCLAW_DIR)) {
    mkdirSync(CMDCLAW_DIR, { recursive: true });
  }
}

function ensureProfilesDir(): void {
  ensureCmdClawDir();
  if (!existsSync(PROFILES_DIR)) {
    mkdirSync(PROFILES_DIR, { recursive: true });
  }
}

function profileSlugForServerUrl(serverUrl: string): string {
  try {
    const url = new URL(serverUrl);
    const protocol = url.protocol.replace(":", "");
    const host = url.hostname.toLowerCase();
    const port = url.port ? `-${url.port}` : "";
    return `${protocol}--${host}${port}`.replace(/[^a-z0-9.-]/g, "-");
  } catch {
    return serverUrl.toLowerCase().replace(/[^a-z0-9.-]/g, "-");
  }
}

export function getConfigPathForServerUrl(serverUrl: string): string {
  return join(PROFILES_DIR, `chat-config.${profileSlugForServerUrl(serverUrl)}.json`);
}

export function loadConfig(
  serverUrl = process.env.CMDCLAW_SERVER_URL || DEFAULT_SERVER_URL,
): ChatConfig | null {
  try {
    const configPath = getConfigPathForServerUrl(serverUrl);
    if (!existsSync(configPath)) {
      return null;
    }
    const raw = readFileSync(configPath, "utf-8");
    return JSON.parse(raw) as ChatConfig;
  } catch {
    return null;
  }
}

export function saveConfig(config: ChatConfig): void {
  ensureProfilesDir();
  const configPath = getConfigPathForServerUrl(config.serverUrl);
  writeFileSync(configPath, JSON.stringify(config, null, 2), "utf-8");
}

export function clearConfig(
  serverUrl = process.env.CMDCLAW_SERVER_URL || DEFAULT_SERVER_URL,
): void {
  const configPath = getConfigPathForServerUrl(serverUrl);
  if (existsSync(configPath)) {
    unlinkSync(configPath);
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
