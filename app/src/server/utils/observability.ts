import { randomUUID } from "crypto";
import { env } from "@/env";

export type ObservabilityContext = {
  source?: string;
  route?: string;
  rpcProcedure?: string;
  traceId?: string;
  generationId?: string;
  conversationId?: string;
  sandboxId?: string;
  sessionId?: string;
  userId?: string;
};

type LogLevel = "info" | "warn" | "error";

export function createTraceId(): string {
  return randomUUID();
}

export function logServerEvent(
  level: LogLevel,
  event: string,
  details: Record<string, unknown> = {},
  context: ObservabilityContext = {},
): void {
  const payload = {
    ts: new Date().toISOString(),
    level,
    event,
    service: "api",
    env: env.NODE_ENV,
    ...context,
    ...details,
  };

  const line = JSON.stringify(payload);
  if (level === "error") {
    console.error(line);
  } else if (level === "warn") {
    console.warn(line);
  } else {
    console.info(line);
  }
}
