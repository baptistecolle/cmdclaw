/**
 * BYOCSandboxBackend: Routes sandbox operations to a connected
 * daemon device via WebSocket.
 */

import type { SandboxBackend, ExecuteResult, DaemonResponse } from "./types";
import { sendToDevice, waitForResponse, isDeviceOnline } from "@/server/ws/server";

export class BYOCSandboxBackend implements SandboxBackend {
  private deviceId: string;
  private conversationId: string | null = null;

  constructor(deviceId: string) {
    this.deviceId = deviceId;
  }

  async setup(conversationId: string, workDir?: string): Promise<void> {
    this.conversationId = conversationId;

    const response = await waitForResponse(this.deviceId, {
      type: "sandbox.setup",
      id: crypto.randomUUID(),
      conversationId,
      workDir,
    });

    if (response.type === "sandbox.setup.result" && !response.success) {
      throw new Error(response.error || "Failed to set up sandbox on device");
    }
  }

  async execute(
    command: string,
    opts?: { timeout?: number; env?: Record<string, string> }
  ): Promise<ExecuteResult> {
    const response = await waitForResponse(
      this.deviceId,
      {
        type: "sandbox.execute",
        id: crypto.randomUUID(),
        command,
        timeout: opts?.timeout,
        env: opts?.env,
      },
      opts?.timeout || 120_000
    );

    if (response.type === "sandbox.execute.result") {
      if (response.error) {
        return { exitCode: 1, stdout: "", stderr: response.error };
      }
      return {
        exitCode: response.exitCode,
        stdout: response.stdout,
        stderr: response.stderr,
      };
    }

    throw new Error("Unexpected response type");
  }

  async writeFile(path: string, content: string | Uint8Array): Promise<void> {
    const strContent =
      typeof content === "string"
        ? content
        : Buffer.from(content).toString("base64");

    const response = await waitForResponse(this.deviceId, {
      type: "sandbox.writeFile",
      id: crypto.randomUUID(),
      path,
      content: strContent,
    });

    if (response.type === "sandbox.writeFile.result" && !response.success) {
      throw new Error(response.error || "Failed to write file on device");
    }
  }

  async readFile(path: string): Promise<string> {
    const response = await waitForResponse(this.deviceId, {
      type: "sandbox.readFile",
      id: crypto.randomUUID(),
      path,
    });

    if (response.type === "sandbox.readFile.result") {
      if (response.error) {
        throw new Error(response.error);
      }
      return response.content;
    }

    throw new Error("Unexpected response type");
  }

  async teardown(): Promise<void> {
    if (!this.conversationId) return;

    try {
      await waitForResponse(this.deviceId, {
        type: "sandbox.teardown",
        id: crypto.randomUUID(),
      });
    } catch {
      // Best effort cleanup
    }

    this.conversationId = null;
  }

  isAvailable(): boolean {
    return isDeviceOnline(this.deviceId);
  }
}
