import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const APP_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../.."
);

export type SkillCliResult = {
  status: number;
  stdout: string;
  stderr: string;
  combined: string;
};

export function runSkillCli(
  scriptPathFromAppRoot: string,
  args: string[],
  envOverrides: Record<string, string | undefined>
): SkillCliResult {
  const scriptPath = path.resolve(APP_ROOT, scriptPathFromAppRoot);
  const result = spawnSync("bun", [scriptPath, ...args], {
    cwd: APP_ROOT,
    encoding: "utf8",
    timeout: 15_000,
    env: {
      ...process.env,
      ...envOverrides,
    },
  });

  const stdout = result.stdout ?? "";
  const stderr = result.stderr ?? "";

  return {
    status: result.status ?? (result.error ? -1 : 0),
    stdout,
    stderr,
    combined: `${stdout}\n${stderr}`,
  };
}
