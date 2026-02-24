/**
 * Structured logging for the CmdClaw daemon.
 * Logs to ~/.cmdclaw/daemon.log and optionally to stdout.
 */

import { appendFileSync, existsSync, mkdirSync } from "fs";
import { homedir } from "os";
import { join } from "path";

const LOG_DIR = join(homedir(), ".cmdclaw");
const LOG_PATH = join(LOG_DIR, "daemon.log");

function ensureLogDir(): void {
  if (!existsSync(LOG_DIR)) {
    mkdirSync(LOG_DIR, { recursive: true });
  }
}

type LogLevel = "debug" | "info" | "warn" | "error";

let verbose = false;

export function setVerbose(v: boolean): void {
  verbose = v;
}

function log(level: LogLevel, component: string, message: string, data?: unknown): void {
  const entry = {
    time: new Date().toISOString(),
    level,
    component,
    message,
    ...(data !== undefined ? { data } : {}),
  };

  const line = JSON.stringify(entry);

  // Always write to log file
  try {
    ensureLogDir();
    appendFileSync(LOG_PATH, line + "\n");
  } catch {
    // can't write log file, ignore
  }

  // Write to stdout if verbose or if level >= warn
  if (verbose || level === "warn" || level === "error") {
    const prefix = level === "error" ? "\x1b[31m" : level === "warn" ? "\x1b[33m" : "\x1b[2m";
    const reset = "\x1b[0m";
    console.error(`${prefix}[${component}] ${message}${reset}`, data !== undefined ? data : "");
  }
}

export const logger = {
  debug: (component: string, message: string, data?: unknown) =>
    log("debug", component, message, data),
  info: (component: string, message: string, data?: unknown) =>
    log("info", component, message, data),
  warn: (component: string, message: string, data?: unknown) =>
    log("warn", component, message, data),
  error: (component: string, message: string, data?: unknown) =>
    log("error", component, message, data),
};
