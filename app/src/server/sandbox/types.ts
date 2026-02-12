/**
 * Shared types for sandbox backends (E2B, BYOC) and daemon WebSocket protocol.
 */

// ========== SandboxBackend Interface ==========

export interface ExecuteResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export interface SandboxBackend {
  /** Initialize the sandbox environment for a conversation */
  setup(conversationId: string, workDir?: string): Promise<void>;

  /** Execute a shell command in the sandbox */
  execute(
    command: string,
    opts?: { timeout?: number; env?: Record<string, string> },
  ): Promise<ExecuteResult>;

  /** Write a file to the sandbox filesystem */
  writeFile(path: string, content: string | Uint8Array): Promise<void>;

  /** Read a file from the sandbox filesystem */
  readFile(path: string): Promise<string>;

  /** Tear down the sandbox, freeing resources */
  teardown(): Promise<void>;

  /** Check if the backend is currently available */
  isAvailable(): boolean;
}

// ========== WebSocket Protocol Types ==========

export type DaemonMessage =
  | {
      type: "sandbox.setup";
      id: string;
      conversationId: string;
      workDir?: string;
    }
  | {
      type: "sandbox.execute";
      id: string;
      command: string;
      timeout?: number;
      env?: Record<string, string>;
    }
  | { type: "sandbox.writeFile"; id: string; path: string; content: string }
  | { type: "sandbox.readFile"; id: string; path: string }
  | { type: "sandbox.teardown"; id: string }
  | {
      type: "llm.chat";
      id: string;
      messages: unknown[];
      tools?: unknown[];
      system?: string;
      model?: string;
    }
  | { type: "ping" };

export type DaemonResponse =
  | {
      type: "sandbox.setup.result";
      id: string;
      success: boolean;
      error?: string;
    }
  | {
      type: "sandbox.execute.result";
      id: string;
      exitCode: number;
      stdout: string;
      stderr: string;
      error?: string;
    }
  | {
      type: "sandbox.writeFile.result";
      id: string;
      success: boolean;
      error?: string;
    }
  | {
      type: "sandbox.readFile.result";
      id: string;
      content: string;
      error?: string;
    }
  | {
      type: "sandbox.teardown.result";
      id: string;
      success: boolean;
      error?: string;
    }
  | { type: "llm.chunk"; id: string; chunk: unknown }
  | {
      type: "llm.done";
      id: string;
      usage?: { inputTokens: number; outputTokens: number };
    }
  | { type: "llm.error"; id: string; error: string }
  | { type: "pong" }
  | { type: "error"; id?: string; error: string };

// ========== Device Capabilities ==========

export interface DeviceCapabilities {
  /** Whether the daemon can execute commands (sandbox) */
  sandbox: boolean;
  /** Whether the daemon can proxy LLM requests (Ollama/LM Studio) */
  llmProxy: boolean;
  /** Available local LLM models (from Ollama/LM Studio) */
  localModels?: string[];
  /** OS platform */
  platform: string;
  /** OS architecture */
  arch: string;
}
