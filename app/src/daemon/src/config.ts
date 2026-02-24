/**
 * Configuration management for the CmdClaw daemon.
 * Stores settings in ~/.cmdclaw/config.json
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { homedir } from "os";
import { join } from "path";

export interface DaemonConfig {
  serverUrl: string;
  token: string;
  deviceId: string;
}

const CMDCLAW_DIR = join(homedir(), ".cmdclaw");
const CONFIG_PATH = join(CMDCLAW_DIR, "config.json");

function ensureCmdClawDir(): void {
  if (!existsSync(CMDCLAW_DIR)) {
    mkdirSync(CMDCLAW_DIR, { recursive: true });
  }
}

export function loadConfig(): DaemonConfig | null {
  try {
    if (!existsSync(CONFIG_PATH)) {
      return null;
    }
    const raw = readFileSync(CONFIG_PATH, "utf-8");
    return JSON.parse(raw) as DaemonConfig;
  } catch {
    return null;
  }
}

export function saveConfig(config: DaemonConfig): void {
  ensureCmdClawDir();
  writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), "utf-8");
}

export function clearConfig(): void {
  try {
    if (existsSync(CONFIG_PATH)) {
      writeFileSync(CONFIG_PATH, "{}", "utf-8");
    }
  } catch {
    // ignore
  }
}

export function getSandboxDir(conversationId: string): string {
  const dir = join(CMDCLAW_DIR, "sandboxes", conversationId);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  return dir;
}

export const CMDCLAW_HOME = CMDCLAW_DIR;
