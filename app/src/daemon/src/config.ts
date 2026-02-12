/**
 * Configuration management for the Bap daemon.
 * Stores settings in ~/.bap/config.json
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { homedir } from "os";
import { join } from "path";

export interface DaemonConfig {
  serverUrl: string;
  token: string;
  deviceId: string;
}

const BAP_DIR = join(homedir(), ".bap");
const CONFIG_PATH = join(BAP_DIR, "config.json");

function ensureBapDir(): void {
  if (!existsSync(BAP_DIR)) {
    mkdirSync(BAP_DIR, { recursive: true });
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
  ensureBapDir();
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
  const dir = join(BAP_DIR, "sandboxes", conversationId);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  return dir;
}

export const BAP_HOME = BAP_DIR;
