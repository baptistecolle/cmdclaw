import { tool } from "@opencode-ai/plugin";
import { promises as fs } from "node:fs";
import path from "node:path";

type SendFileArgs = {
  path: string;
  description?: string;
};

type ToolContext = {
  worktree?: string;
  directory: string;
};

const OUTBOX_DIR = "/app/send-file-outbox";

function isAllowedAbsolutePath(target: string): boolean {
  return (
    target === "/app" ||
    target.startsWith("/app/") ||
    target === "/home/user" ||
    target.startsWith("/home/user/")
  );
}

export default tool({
  description:
    "Expose a sandbox file to the user as a downloadable artifact. " +
    "Use this after creating the final output file.",
  args: {
    path: tool.schema
      .string()
      .describe("Absolute path or path relative to worktree for the file to send"),
    description: tool.schema.string().optional().describe("Optional short description"),
  },
  async execute(args: SendFileArgs, context: ToolContext) {
    const worktree = context.worktree || context.directory;
    const sourcePath = path.isAbsolute(args.path) ? args.path : path.resolve(worktree, args.path);

    if (!isAllowedAbsolutePath(sourcePath)) {
      throw new Error("path must resolve under /app or /home/user");
    }

    const stat = await fs.stat(sourcePath).catch(() => null);
    if (!stat) {
      throw new Error(`File not found: ${args.path}`);
    }
    if (!stat.isFile()) {
      throw new Error(`Path is not a file: ${args.path}`);
    }

    await fs.mkdir(OUTBOX_DIR, { recursive: true });
    const stagedName = `${Date.now()}-${path.basename(sourcePath)}`;
    const stagedPath = path.join(OUTBOX_DIR, stagedName);
    await fs.copyFile(sourcePath, stagedPath);

    const descriptionSuffix = args.description
      ? ` description=${JSON.stringify(args.description)}`
      : "";
    return `ok=true path=${sourcePath} stagedPath=${stagedPath} filename=${path.basename(sourcePath)} sizeBytes=${stat.size}${descriptionSuffix} message="File staged for user download."`;
  },
});
