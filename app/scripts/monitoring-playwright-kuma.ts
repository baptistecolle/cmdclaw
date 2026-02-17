import { spawn } from "node:child_process";
import { existsSync, readFileSync, rmSync } from "node:fs";

type Env = NodeJS.ProcessEnv;

const DEFAULT_COMMAND = "bun run test:e2e:live:prod:monitor";
const DEFAULT_TIMEOUT_MS = 15 * 60 * 1000;
const DEFAULT_JSON_PATH = "test-results/monitor/results.json";
const DEFAULT_MESSAGE_MAX_LENGTH = 800;

type PlaywrightSummary = {
  passed: number;
  skipped: number;
  failed: number;
  failedTitles: string[];
  skippedTitles: string[];
};

type PlaywrightNode = {
  title?: string;
  suites?: PlaywrightNode[];
  specs?: Array<{
    title?: string;
    tests?: Array<{
      outcome?: string;
      status?: string;
    }>;
  }>;
};

function getTimeoutMs(env: Env): number {
  const raw = env.MONITOR_TIMEOUT_MS?.trim();
  if (!raw) {
    return DEFAULT_TIMEOUT_MS;
  }
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`MONITOR_TIMEOUT_MS must be a positive number, got "${raw}"`);
  }
  return Math.floor(parsed);
}

function resolvePushUrl(env: Env): string {
  const pushUrl = env.KUMA_PUSH_URL?.trim();
  if (!pushUrl) {
    throw new Error("Missing KUMA_PUSH_URL");
  }
  return pushUrl;
}

function getJsonPath(env: Env): string {
  return env.MONITOR_PLAYWRIGHT_JSON_PATH?.trim() || DEFAULT_JSON_PATH;
}

function getMessageMaxLength(env: Env): number {
  const raw = env.MONITOR_MESSAGE_MAX_LENGTH?.trim();
  if (!raw) {
    return DEFAULT_MESSAGE_MAX_LENGTH;
  }
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 120) {
    throw new Error(`MONITOR_MESSAGE_MAX_LENGTH must be >= 120, got "${raw}"`);
  }
  return Math.floor(parsed);
}

function uniquePush(out: string[], item: string, maxItems: number): void {
  if (out.length >= maxItems || !item || out.includes(item)) {
    return;
  }
  out.push(item);
}

function flattenTitle(segments: string[]): string {
  return segments.filter(Boolean).join(" > ");
}

function parsePlaywrightSummary(jsonPath: string): PlaywrightSummary | null {
  if (!existsSync(jsonPath)) {
    return null;
  }

  const raw = readFileSync(jsonPath, "utf8");
  let parsed: { suites?: PlaywrightNode[] };
  try {
    parsed = JSON.parse(raw) as { suites?: PlaywrightNode[] };
  } catch {
    return null;
  }

  const summary: PlaywrightSummary = {
    passed: 0,
    skipped: 0,
    failed: 0,
    failedTitles: [],
    skippedTitles: [],
  };

  function walkSuite(suite: PlaywrightNode, parentTitles: string[]): void {
    const ownTitle = suite.title?.trim();
    const suiteTitles = ownTitle ? [...parentTitles, ownTitle] : parentTitles;

    for (const spec of suite.specs ?? []) {
      const specTitle = spec.title?.trim() || "unnamed test";
      const fullTitle = flattenTitle([...suiteTitles, specTitle]);
      const tests = spec.tests ?? [];
      if (tests.length === 0) {
        summary.skipped += 1;
        uniquePush(summary.skippedTitles, fullTitle, 6);
        continue;
      }

      for (const test of tests) {
        const outcome = test.outcome ?? "";
        const status = test.status ?? "";
        if (outcome === "unexpected" || status === "failed" || status === "timedOut") {
          summary.failed += 1;
          uniquePush(summary.failedTitles, fullTitle, 6);
          continue;
        }
        if (outcome === "skipped" || status === "skipped") {
          summary.skipped += 1;
          uniquePush(summary.skippedTitles, fullTitle, 6);
          continue;
        }
        summary.passed += 1;
      }
    }

    for (const child of suite.suites ?? []) {
      walkSuite(child, suiteTitles);
    }
  }

  for (const suite of parsed.suites ?? []) {
    walkSuite(suite, []);
  }

  return summary;
}

function truncateWithEllipsis(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }
  return `${value.slice(0, maxLength - 3)}...`;
}

function buildSummaryMessage(
  monitorName: string,
  exitCode: number,
  runError: unknown,
  summary: PlaywrightSummary | null,
  reportUrl: string | undefined,
  maxLength: number,
): string {
  const parts: string[] = [];
  const result = exitCode === 0 && !runError ? "up" : "down";
  parts.push(`${monitorName} ${result}`);

  if (summary) {
    parts.push(`pass=${summary.passed}`);
    parts.push(`skip=${summary.skipped}`);
    parts.push(`fail=${summary.failed}`);
    if (summary.failedTitles.length > 0) {
      parts.push(`failed:[${summary.failedTitles.join(" | ")}]`);
    }
    if (summary.skippedTitles.length > 0) {
      parts.push(`skipped:[${summary.skippedTitles.join(" | ")}]`);
    }
  } else {
    parts.push(`exit=${exitCode}${runError ? ",runtime=error" : ""}`);
    parts.push("summary=unavailable");
  }

  if (reportUrl) {
    parts.push(`report=${reportUrl}`);
  }

  return truncateWithEllipsis(parts.join(" ; "), maxLength);
}

function buildKumaUrl(pushUrl: string, status: "up" | "down", msg: string, pingMs: number): string {
  const url = new URL(pushUrl);
  url.searchParams.set("status", status);
  url.searchParams.set("msg", msg);
  url.searchParams.set("ping", String(Math.max(1, Math.round(pingMs))));
  return url.toString();
}

function runCommand(command: string, env: Env, timeoutMs: number): Promise<number> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, {
      shell: true,
      stdio: "inherit",
      env,
    });

    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      setTimeout(() => {
        child.kill("SIGKILL");
      }, 10_000).unref();
      reject(new Error(`Playwright monitor command timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });

    child.on("exit", (code) => {
      clearTimeout(timer);
      resolve(code ?? 1);
    });
  });
}

async function pushResult(
  pushUrl: string,
  status: "up" | "down",
  msg: string,
  pingMs: number,
): Promise<void> {
  const target = buildKumaUrl(pushUrl, status, msg, pingMs);
  const response = await fetch(target, { method: "GET" });
  if (!response.ok) {
    throw new Error(`Uptime Kuma push failed with status ${response.status}`);
  }
}

async function main(): Promise<void> {
  const command = process.env.MONITOR_COMMAND?.trim() || DEFAULT_COMMAND;
  const timeoutMs = getTimeoutMs(process.env);
  const jsonPath = getJsonPath(process.env);
  const messageMaxLength = getMessageMaxLength(process.env);
  const pushUrl = resolvePushUrl(process.env);
  const monitorName = process.env.MONITOR_NAME?.trim() || "playwright-live";
  const reportUrl = process.env.MONITOR_REPORT_URL?.trim();

  rmSync(jsonPath, { force: true });

  const startedAt = Date.now();
  let exitCode = 1;
  let runError: unknown;

  try {
    exitCode = await runCommand(command, process.env, timeoutMs);
  } catch (error) {
    runError = error;
  }

  const durationMs = Date.now() - startedAt;
  const summary = parsePlaywrightSummary(jsonPath);
  const isUp = exitCode === 0 && !runError;
  const status: "up" | "down" = isUp ? "up" : "down";
  const message = buildSummaryMessage(
    monitorName,
    exitCode,
    runError,
    summary,
    reportUrl,
    messageMaxLength,
  );
  await pushResult(pushUrl, status, message, durationMs);

  if (!isUp) {
    if (runError) {
      throw runError;
    }
    process.exit(exitCode);
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[monitoring-playwright-kuma] ${message}`);
  process.exit(1);
});
