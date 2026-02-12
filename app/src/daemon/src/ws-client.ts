/**
 * WebSocket client for the Bap daemon.
 * Connects to the server, handles reconnection with exponential backoff,
 * and routes incoming messages to handlers.
 */

import { logger } from "./logger";
import {
  setupSandbox,
  executeCommand,
  writeFile,
  readFile,
  teardownSandbox,
} from "./sandbox";
import { proxyChatRequest } from "./llm-proxy";

const MIN_RECONNECT_MS = 1000;
const MAX_RECONNECT_MS = 30_000;

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

    this.ws.onopen = () => {
      logger.info("ws", "Connected");
      this.connected = true;
      this.reconnectDelay = MIN_RECONNECT_MS;
    };

    this.ws.onmessage = (event) => {
      this.handleMessage(typeof event.data === "string" ? event.data : "");
    };

    this.ws.onclose = (event) => {
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
    };

    this.ws.onerror = (event) => {
      logger.error("ws", "WebSocket error");
    };
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
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
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
    let msg: unknown;
    try {
      msg = JSON.parse(raw);
    } catch {
      logger.error("ws", "Invalid JSON received");
      return;
    }

    switch (msg.type) {
      case "authenticated":
        console.log(`  Connected as device ${msg.deviceId}`);
        break;

      case "ping":
        this.send({ type: "pong" });
        break;

      case "sandbox.setup":
        this.handleSandboxSetup(msg);
        break;

      case "sandbox.execute":
        this.handleSandboxExecute(msg);
        break;

      case "sandbox.writeFile":
        this.handleSandboxWriteFile(msg);
        break;

      case "sandbox.readFile":
        this.handleSandboxReadFile(msg);
        break;

      case "sandbox.teardown":
        this.handleSandboxTeardown(msg);
        break;

      case "llm.chat":
        this.handleLLMChat(msg);
        break;

      case "error":
        logger.error("ws", `Server error: ${msg.error}`);
        break;

      default:
        logger.debug("ws", `Unknown message type: ${msg.type}`);
    }
  }

  private handleSandboxSetup(msg: unknown): void {
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

  private async handleSandboxExecute(msg: unknown): Promise<void> {
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

  private handleSandboxWriteFile(msg: unknown): void {
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

  private handleSandboxReadFile(msg: unknown): void {
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

  private handleSandboxTeardown(msg: unknown): void {
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

  private handleLLMChat(msg: unknown): void {
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
