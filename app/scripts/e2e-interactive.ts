import { existsSync, readdirSync } from "node:fs";
import { relative, resolve } from "node:path";
import readline from "node:readline";

type Mode = "all" | "service" | "type";

type TestMeta = {
  relativePath: string;
  service: string;
  type: string;
  live: boolean;
};

const DEFAULT_E2E_EMAIL = "baptiste@cmdclaw.com";
const SERVICE_TOKENS = [
  "slack",
  "discord",
  "telegram",
  "whatsapp",
  "email",
  "sms",
  "github",
  "notion",
];

function createPrompt(): readline.Interface {
  return readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
}

function ask(rl: readline.Interface, query: string): Promise<string> {
  return new Promise((resolveAnswer) => {
    rl.question(query, (answer) => resolveAnswer(answer.trim()));
  });
}

function toTokens(filePath: string): string[] {
  return filePath
    .toLowerCase()
    .split(/[/._-]+/)
    .map((token) => token.trim())
    .filter(Boolean);
}

function classifyService(tokens: string[]): string {
  const matched = SERVICE_TOKENS.find((token) => tokens.includes(token));
  return matched ?? "core";
}

function classifyType(tokens: string[]): string {
  if (tokens.includes("workflow") || tokens.includes("workflows")) {
    return "workflow";
  }
  if (tokens.includes("chat")) {
    return "chat";
  }
  if (tokens.includes("auth")) {
    return "auth";
  }
  return "other";
}

function isE2EFile(path: string): boolean {
  return path.endsWith(".e2e.ts") || path.endsWith(".e2e.test.ts");
}

function collectFiles(baseDir: string, startDir: string, out: string[]): void {
  if (!existsSync(startDir)) {
    return;
  }

  const entries = readdirSync(startDir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = resolve(startDir, entry.name);
    if (entry.isDirectory()) {
      collectFiles(baseDir, fullPath, out);
      continue;
    }
    if (entry.isFile() && isE2EFile(fullPath)) {
      out.push(relative(baseDir, fullPath));
    }
  }
}

function discoverE2ETests(baseDir: string): TestMeta[] {
  const discovered: string[] = [];
  collectFiles(baseDir, resolve(baseDir, "tests/e2e"), discovered);
  collectFiles(baseDir, resolve(baseDir, "src"), discovered);

  return discovered
    .toSorted((a, b) => a.localeCompare(b))
    .map((relativePath) => {
      const tokens = toTokens(relativePath);
      return {
        relativePath,
        service: classifyService(tokens),
        type: classifyType(tokens),
        live: tokens.includes("live"),
      };
    });
}

function parseYesNo(input: string, defaultYes: boolean): boolean {
  if (!input) {
    return defaultYes;
  }
  const lowered = input.toLowerCase();
  if (["y", "yes"].includes(lowered)) {
    return true;
  }
  if (["n", "no"].includes(lowered)) {
    return false;
  }
  return defaultYes;
}

function parseIndexSelection(input: string, max: number): number[] {
  const tokens = input
    .split(",")
    .map((value) => Number(value.trim()))
    .filter((value) => Number.isInteger(value) && value >= 1 && value <= max);
  return Array.from(new Set(tokens));
}

function printIndexedOptions(values: string[]): void {
  values.forEach((value, idx) => {
    console.log(`  ${idx + 1}. ${value}`);
  });
}

async function chooseMode(rl: readline.Interface): Promise<Mode> {
  console.log("\nSelect test scope:");
  console.log("  1. All tests");
  console.log("  2. By service");
  console.log("  3. By type");

  const raw = await ask(rl, "\nScope [1]: ");
  if (raw === "2") {
    return "service";
  }
  if (raw === "3") {
    return "type";
  }
  return "all";
}

async function chooseEmail(rl: readline.Interface): Promise<string> {
  const envEmail = process.env.E2E_TEST_EMAIL?.trim() || DEFAULT_E2E_EMAIL;
  const useDefault = parseYesNo(await ask(rl, `\nUse e2e user email "${envEmail}"? [Y/n]: `), true);
  if (useDefault) {
    return envEmail;
  }

  const customEmail = await ask(rl, "Enter e2e user email: ");
  if (!customEmail) {
    return envEmail;
  }
  return customEmail;
}

async function chooseTimeoutMs(rl: readline.Interface): Promise<number | null> {
  const raw = await ask(
    rl,
    "\nPer-test timeout (examples: 45s, 1m30s, 1min 30sec). Enter for Playwright default (30s): ",
  );
  if (!raw) {
    return null;
  }

  const value = parseHumanDurationMs(raw);
  if (value === null || value <= 0) {
    console.warn("Invalid timeout value, using default.");
    return null;
  }

  return value;
}

async function chooseFromList(
  rl: readline.Interface,
  title: string,
  values: string[],
): Promise<string[]> {
  console.log(`\n${title}:`);
  printIndexedOptions(values);
  const raw = await ask(rl, "\nEnter one or more numbers (comma-separated): ");
  const indexes = parseIndexSelection(raw, values.length);
  if (indexes.length === 0) {
    return [values[0]!];
  }
  return indexes.map((index) => values[index - 1]!);
}

function withEnv(baseEnv: NodeJS.ProcessEnv, entries: Record<string, string>): NodeJS.ProcessEnv {
  return {
    ...baseEnv,
    ...entries,
  };
}

function parseHumanDurationMs(input: string): number | null {
  const trimmed = input.trim().toLowerCase();
  if (!trimmed) {
    return null;
  }

  if (/^\d+$/.test(trimmed)) {
    return Number(trimmed);
  }

  let totalMs = 0;
  const pattern =
    /(\d+(?:\.\d+)?)\s*(milliseconds?|millisecond|msecs?|msec|ms|minutes?|minute|mins?|min|m|seconds?|second|secs?|sec|s)/g;

  let matched = false;
  let remaining = trimmed;
  for (const match of trimmed.matchAll(pattern)) {
    const quantity = Number(match[1]);
    const rawUnit = (match[2] ?? "").toLowerCase();
    if (!Number.isFinite(quantity)) {
      return null;
    }

    let unitMs: number;
    if (
      rawUnit === "ms" ||
      rawUnit === "msec" ||
      rawUnit === "msecs" ||
      rawUnit === "millisecond" ||
      rawUnit === "milliseconds"
    ) {
      unitMs = 1;
    } else if (
      rawUnit === "s" ||
      rawUnit === "sec" ||
      rawUnit === "secs" ||
      rawUnit === "second" ||
      rawUnit === "seconds"
    ) {
      unitMs = 1000;
    } else if (
      rawUnit === "m" ||
      rawUnit === "min" ||
      rawUnit === "mins" ||
      rawUnit === "minute" ||
      rawUnit === "minutes"
    ) {
      unitMs = 60_000;
    } else {
      return null;
    }

    totalMs += Math.round(quantity * unitMs);
    matched = true;
    remaining = remaining.replace(match[0], " ");
  }

  if (!matched) {
    return null;
  }

  if (remaining.replaceAll(/\s+/g, "").length > 0) {
    return null;
  }

  return totalMs;
}

async function runCommand(cmd: string[], env: NodeJS.ProcessEnv): Promise<number> {
  const proc = Bun.spawn({
    cmd,
    cwd: process.cwd(),
    env,
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  });
  return await proc.exited;
}

async function main(): Promise<void> {
  const extraArgs = process.argv.slice(2);
  if (extraArgs.length > 0) {
    console.error(
      `This command does not accept extra Playwright flags. Received: ${extraArgs.join(" ")}`,
    );
    process.exit(1);
  }

  const baseDir = process.cwd();
  const tests = discoverE2ETests(baseDir);

  if (tests.length === 0) {
    console.error("No e2e test files found.");
    process.exit(1);
  }

  const rl = createPrompt();
  try {
    const mode = await chooseMode(rl);
    let selected = tests;
    if (mode === "service") {
      const services = Array.from(new Set(tests.map((test) => test.service))).toSorted();
      const picked = await chooseFromList(rl, "Services", services);
      selected = tests.filter((test) => picked.includes(test.service));
    } else if (mode === "type") {
      const types = Array.from(new Set(tests.map((test) => test.type))).toSorted();
      const picked = await chooseFromList(rl, "Types", types);
      selected = tests.filter((test) => picked.includes(test.type));
    }

    const email = await chooseEmail(rl);
    const recordVideo = parseYesNo(await ask(rl, "\nRecord video? [Y/n]: "), true);
    const reuseServer = parseYesNo(await ask(rl, "Reuse existing server? [Y/n]: "), true);
    const timeoutMs = await chooseTimeoutMs(rl);

    if (selected.length === 0) {
      console.error("No tests match the selected filters.");
      process.exit(1);
    }

    const hasLiveTests = selected.some((test) => test.live);
    const selectedPaths = selected.map((test) => test.relativePath);
    const envUpdates: Record<string, string> = { E2E_TEST_EMAIL: email };

    if (recordVideo) {
      envUpdates.PLAYWRIGHT_VIDEO = "on";
    }
    if (reuseServer) {
      envUpdates.PLAYWRIGHT_SKIP_WEBSERVER = "1";
    }
    if (hasLiveTests) {
      envUpdates.E2E_LIVE = "1";
    }

    const env = withEnv(process.env, envUpdates);

    console.log("\nRunning with:");
    console.log(`  email=${email}`);
    console.log(`  recordVideo=${recordVideo ? "yes" : "no"}`);
    console.log(`  reuseServer=${reuseServer ? "yes" : "no"}`);
    console.log(`  timeoutMs=${timeoutMs ?? "default"}`);
    console.log(`  selectedTests=${selected.length}`);
    selectedPaths.forEach((testPath) => console.log(`    - ${testPath}`));

    if (hasLiveTests) {
      console.log("\nBootstrapping e2e auth state for live tests...");
      const authExit = await runCommand(["bun", "--env-file=.env", "scripts/e2e-auth.ts"], env);
      if (authExit !== 0) {
        process.exit(authExit);
      }
    }

    const playwrightArgs = ["bun", "--env-file=.env", "playwright", "test", ...selectedPaths];
    if (timeoutMs !== null) {
      playwrightArgs.push(`--timeout=${timeoutMs}`);
    }

    console.log("\nStarting Playwright...\n");
    const testExit = await runCommand(playwrightArgs, env);
    process.exit(testExit);
  } finally {
    rl.close();
  }
}

void main();
