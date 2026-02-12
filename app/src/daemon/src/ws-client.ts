/**
 * WebSocket client for the Bap daemon.
 * Connects to the server, handles reconnection with exponential backoff,
 * and routes incoming messages to handlers.
 */

import { proxyChatRequest } from "./llm-proxy";
import { logger } from "./logger";
import { setupSandbox, executeCommand, writeFile, readFile, teardownSandbox } from "./sandbox";

const MIN_RECONNECT_MS = 1000;
const MAX_RECONNECT_MS = 30_000;

type WSBaseMessage = { type: string; id?: string };
type WSAuthenticatedMessage = WSBaseMessage & {
  type: "authenticated";
  deviceId?: string;
};
type WSSandboxSetupMessage = WSBaseMessage & {
  type: "sandbox.setup";
  conversationId: string;
  workDir?: string;
};
type WSSandboxExecuteMessage = WSBaseMessage & {
  type: "sandbox.execute";
  conversationId: string;
  command: string;
  timeout?: number;
  env?: Record<string, string>;
};
type WSSandboxWriteFileMessage = WSBaseMessage & {
  type: "sandbox.writeFile";
  path: string;
  content: string;
};
type WSSandboxReadFileMessage = WSBaseMessage & {
  type: "sandbox.readFile";
  path: string;
};
type WSSandboxTeardownMessage = WSBaseMessage & {
  type: "sandbox.teardown";
  conversationId?: string;
};
type WSLLMChatMessage = WSBaseMessage & {
  type: "llm.chat";
  messages: unknown[];
  tools?: Array<{
    name: string;
    description?: string;
    input_schema?: Record<string, unknown>;
  }>;
  system?: string;
  model?: string;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : null;
}

function toBaseMessage(value: unknown): WSBaseMessage | null {
  const record = asRecord(value);
  if (!record || typeof record.type !== "string") {
    return null;
  }
  return {
    type: record.type,
    id: typeof record.id === "string" ? record.id : undefined,
  };
}

export class WSClient {
  private ws: WebSocket | null = null;
  private serverUrl: string;
  private token: string;
  private deviceId: string;
  private reconnectDelay = MIN_RECONNECT_MS;
  private shouldReconnect = true;
  private connected = false;

  constructor(serverUrl: string, token: string, deviceId: string) {
    this.serverUrl = serverUrl;
    this.token = token;
    this.deviceId = deviceId;
  }

  connect(): void {
    const wsUrl = this.serverUrl
      .replace(/^https:\/\//, "wss://")
      .replace(/^http:\/\//, "ws://")
      .replace(/\/$/, "");

    const url = `${wsUrl}/ws?token=${encodeURIComponent(this.token)}&deviceId=${encodeURIComponent(this.deviceId)}`;
    logger.info("ws", `Connecting to ${wsUrl}/ws`);

    try {
      this.ws = new WebSocket(url);
    } catch (err) {
      logger.error("ws", "Failed to create WebSocket", err);
      this.scheduleReconnect();
      return;
    }

    this.ws.addEventListener("open", () => {
      logger.info("ws", "Connected");
      this.connected = true;
      this.reconnectDelay = MIN_RECONNECT_MS;
    });

    this.ws.addEventListener("message", (event) => {
      this.handleMessage(typeof event.data === "string" ? event.data : "");
    });

    this.ws.addEventListener("close", (event) => {
      this.connected = false;
      logger.info("ws", `Disconnected: ${event.code} ${event.reason}`);

      if (event.code === 4001) {
        logger.error("ws", "Authentication failed, not reconnecting");
        this.shouldReconnect = false;
        return;
      }

      if (this.shouldReconnect) {
        this.scheduleReconnect();
      }
    });

    this.ws.addEventListener("error", () => {
      logger.error("ws", "WebSocket error");
    });
  }

  disconnect(): void {
    this.shouldReconnect = false;
    this.ws?.close(1000, "Daemon stopping");
    this.ws = null;
    this.connected = false;
  }

  isConnected(): boolean {
    return this.connected;
  }

  private send(data: unknown): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return;
    }
    this.ws.send(JSON.stringify(data));
  }

  private scheduleReconnect(): void {
    logger.info("ws", `Reconnecting in ${this.reconnectDelay}ms`);
    setTimeout(() => {
      if (this.shouldReconnect) {
        this.connect();
      }
    }, this.reconnectDelay);

    // Exponential backoff
    this.reconnectDelay = Math.min(this.reconnectDelay * 2, MAX_RECONNECT_MS);
  }

  private handleMessage(raw: string): void {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      logger.error("ws", "Invalid JSON received");
      return;
    }

    const msg = toBaseMessage(parsed);
    const record = asRecord(parsed);
    if (!msg || !record) {
      logger.error("ws", "Invalid message shape");
      return;
    }

    switch (msg.type) {
      case "authenticated":
        console.log(
          `  Connected as device ${String((record as WSAuthenticatedMessage).deviceId ?? "unknown")}`,
        );
        break;

      case "ping":
        this.send({ type: "pong" });
        break;

      case "sandbox.setup":
        if (
          typeof record.conversationId === "string" &&
          (record.workDir === undefined || typeof record.workDir === "string")
        ) {
          this.handleSandboxSetup(record as WSSandboxSetupMessage);
        }
        break;

      case "sandbox.execute":
        if (typeof record.conversationId === "string" && typeof record.command === "string") {
          this.handleSandboxExecute(record as WSSandboxExecuteMessage);
        }
        break;

      case "sandbox.writeFile":
        if (typeof record.path === "string" && typeof record.content === "string") {
          this.handleSandboxWriteFile(record as WSSandboxWriteFileMessage);
        }
        break;

      case "sandbox.readFile":
        if (typeof record.path === "string") {
          this.handleSandboxReadFile(record as WSSandboxReadFileMessage);
        }
        break;

      case "sandbox.teardown":
        if (record.conversationId === undefined || typeof record.conversationId === "string") {
          this.handleSandboxTeardown(record as WSSandboxTeardownMessage);
        }
        break;

      case "llm.chat":
        if (Array.isArray(record.messages)) {
          this.handleLLMChat(record as WSLLMChatMessage);
        }
        break;

      case "error":
        logger.error(
          "ws",
          `Server error: ${typeof record.error === "string" ? record.error : "unknown"}`,
        );
        break;

      default:
        logger.debug("ws", `Unknown message type: ${msg.type}`);
    }
  }

  private handleSandboxSetup(msg: WSSandboxSetupMessage): void {
    try {
      setupSandbox(msg.conversationId, msg.workDir);
      this.send({
        type: "sandbox.setup.result",
        id: msg.id,
        success: true,
      });
    } catch (err) {
      this.send({
        type: "sandbox.setup.result",
        id: msg.id,
        success: false,
        error: err instanceof Error ? err.message : "Setup failed",
      });
    }
  }

  private async handleSandboxExecute(msg: WSSandboxExecuteMessage): Promise<void> {
    try {
      const result = await executeCommand(msg.command, {
        conversationId: msg.conversationId,
        timeout: msg.timeout,
        env: msg.env,
      });

      this.send({
        type: "sandbox.execute.result",
        id: msg.id,
        exitCode: result.exitCode,
        stdout: result.stdout,
        stderr: result.stderr,
      });
    } catch (err) {
      this.send({
        type: "sandbox.execute.result",
        id: msg.id,
        exitCode: 1,
        stdout: "",
        stderr: err instanceof Error ? err.message : "Execution failed",
        error: err instanceof Error ? err.message : "Execution failed",
      });
    }
  }

  private handleSandboxWriteFile(msg: WSSandboxWriteFileMessage): void {
    try {
      writeFile(msg.path, msg.content);
      this.send({
        type: "sandbox.writeFile.result",
        id: msg.id,
        success: true,
      });
    } catch (err) {
      this.send({
        type: "sandbox.writeFile.result",
        id: msg.id,
        success: false,
        error: err instanceof Error ? err.message : "Write failed",
      });
    }
  }

  private handleSandboxReadFile(msg: WSSandboxReadFileMessage): void {
    try {
      const content = readFile(msg.path);
      this.send({
        type: "sandbox.readFile.result",
        id: msg.id,
        content,
      });
    } catch (err) {
      this.send({
        type: "sandbox.readFile.result",
        id: msg.id,
        content: "",
        error: err instanceof Error ? err.message : "Read failed",
      });
    }
  }

  private handleSandboxTeardown(msg: WSSandboxTeardownMessage): void {
    try {
      if (msg.conversationId) {
        teardownSandbox(msg.conversationId);
      }
      this.send({
        type: "sandbox.teardown.result",
        id: msg.id,
        success: true,
      });
    } catch (err) {
      this.send({
        type: "sandbox.teardown.result",
        id: msg.id,
        success: false,
        error: err instanceof Error ? err.message : "Teardown failed",
      });
    }
  }

  private handleLLMChat(msg: WSLLMChatMessage): void {
    proxyChatRequest(
      {
        messages: msg.messages,
        tools: msg.tools,
        system: msg.system,
        model: msg.model,
      },
      (chunk) => {
        this.send({ type: "llm.chunk", id: msg.id, chunk });
      },
      (usage) => {
        this.send({ type: "llm.done", id: msg.id, usage });
      },
      (error) => {
        this.send({ type: "llm.error", id: msg.id, error });
      },
    );
  }
}
