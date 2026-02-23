import type { ExecuteResult, SandboxBackend } from "./types";

const DEFAULT_DAYTONA_SNAPSHOT = "bap-agent-dev";
const DEFAULT_WORKDIR = "/app";

type DaytonaProcessResult = {
  exitCode?: number;
  result?: string;
  stdout?: string;
  stderr?: string;
};

type DaytonaSandboxHandle = {
  process: {
    executeCommand: (
      command: string,
      cwd?: string,
      env?: Record<string, string>,
      timeout?: number,
    ) => Promise<DaytonaProcessResult>;
  };
  fs: {
    uploadFile: (file: Buffer, remotePath: string, timeout?: number) => Promise<void>;
    downloadFile: (remotePath: string, timeout?: number) => Promise<Buffer>;
  };
  delete: () => Promise<void>;
};

export class DaytonaSandboxBackend implements SandboxBackend {
  private sandbox: DaytonaSandboxHandle | null = null;

  async setup(_conversationId: string, _workDir?: string): Promise<void> {
    const { Daytona } = await import("@daytonaio/sdk");
    const daytona = new Daytona({
      ...(process.env.DAYTONA_API_KEY ? { apiKey: process.env.DAYTONA_API_KEY } : {}),
      ...(process.env.DAYTONA_SERVER_URL ? { serverUrl: process.env.DAYTONA_SERVER_URL } : {}),
      ...(process.env.DAYTONA_TARGET ? { target: process.env.DAYTONA_TARGET } : {}),
    });

    const snapshot = process.env.E2B_TEMPLATE || DEFAULT_DAYTONA_SNAPSHOT;
    this.sandbox = (await daytona.create({
      snapshot,
    })) as DaytonaSandboxHandle;
  }

  async execute(
    command: string,
    opts?: { timeout?: number; env?: Record<string, string> },
  ): Promise<ExecuteResult> {
    if (!this.sandbox) {
      throw new Error("DaytonaSandboxBackend not set up");
    }

    const timeoutSeconds = opts?.timeout ? Math.max(1, Math.ceil(opts.timeout / 1000)) : undefined;
    const result = (await this.sandbox.process.executeCommand(
      command,
      DEFAULT_WORKDIR,
      opts?.env,
      timeoutSeconds,
    )) as DaytonaProcessResult;

    return {
      exitCode: result.exitCode ?? 0,
      stdout: result.stdout ?? result.result ?? "",
      stderr: result.stderr ?? "",
    };
  }

  async writeFile(path: string, content: string | Uint8Array): Promise<void> {
    if (!this.sandbox) {
      throw new Error("DaytonaSandboxBackend not set up");
    }

    const normalizedContent =
      typeof content === "string" ? Buffer.from(content, "utf8") : Buffer.from(content);
    await this.sandbox.fs.uploadFile(normalizedContent, path);
  }

  async readFile(path: string): Promise<string> {
    if (!this.sandbox) {
      throw new Error("DaytonaSandboxBackend not set up");
    }

    const content = await this.sandbox.fs.downloadFile(path);
    if (typeof content === "string") {
      return content;
    }
    return Buffer.from(content).toString("utf8");
  }

  async teardown(): Promise<void> {
    if (!this.sandbox) {
      return;
    }

    await this.sandbox.delete().catch(() => {});
    this.sandbox = null;
  }

  isAvailable(): boolean {
    return isDaytonaConfigured();
  }
}

export function isDaytonaConfigured(): boolean {
  return Boolean(process.env.DAYTONA_API_KEY);
}
