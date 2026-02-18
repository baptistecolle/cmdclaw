import { eq } from "drizzle-orm";
import { spawn } from "node:child_process";
import { loadConfig, createRpcClient } from "../../scripts/lib/cli-shared";
import { closePool, db } from "../../src/server/db/client";
import { user } from "../../src/server/db/schema";
import { getValidTokensForUser } from "../../src/server/integrations/token-refresh";
import { resolveLiveE2EModel } from "../e2e/live-chat-model";

export const liveEnabled = process.env.E2E_LIVE === "1";
export const defaultServerUrl = process.env.BAP_SERVER_URL ?? "http://127.0.0.1:3000";
export const responseTimeoutMs = Number(process.env.E2E_RESPONSE_TIMEOUT_MS ?? "180000");
export const commandTimeoutMs = Number(process.env.E2E_CLI_TIMEOUT_MS ?? String(responseTimeoutMs));
export const artifactTimeoutMs = Number(process.env.E2E_ARTIFACT_TIMEOUT_MS ?? "45000");
export const slackPollIntervalMs = Number(process.env.E2E_SLACK_POLL_INTERVAL_MS ?? "2500");
export const slackPostVerifyTimeoutMs = Number(
  process.env.E2E_SLACK_POST_VERIFY_TIMEOUT_MS ?? "30000",
);

export const expectedUserEmail = "baptiste@heybap.com";
export const sourceChannelName = "bap-experiments";
export const targetChannelName = "e2e-slack-testing";
export const echoPrefix = "test message: the previous message is:";

export const questionPrompt =
  process.env.E2E_CHAT_QUESTION_PROMPT ??
  "Use the question tool exactly once with header 'Pick', question 'Choose one', and options 'Alpha' and 'Beta'. After I answer, respond exactly as SELECTED=<answer>.";
export const fillPdfPrompt =
  process.env.E2E_FILL_PDF_PROMPT ??
  "Using your pdf-fill tool. Fill the attached PDF form. Use the name Sandra wherever a name is requested. Save the output as filled-sandra.pdf";

export type CommandResult = {
  code: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
};

type SlackMessage = {
  ts?: string;
  text?: string;
  subtype?: string;
};

type SlackApiResponse = {
  ok?: boolean;
  error?: string;
  channels?: Array<{ id?: string; name?: string }>;
  messages?: SlackMessage[];
  response_metadata?: { next_cursor?: string };
};

export function runBunCommand(
  args: string[],
  timeoutMs = commandTimeoutMs,
): Promise<CommandResult> {
  return new Promise((resolveDone) => {
    const child = spawn("bun", args, {
      env: {
        ...process.env,
        BAP_SERVER_URL: defaultServerUrl,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    let settled = false;
    let timedOut = false;

    const timer = setTimeout(() => {
      if (!settled) {
        timedOut = true;
        child.kill("SIGTERM");
      }
    }, timeoutMs);

    child.stdout.on("data", (chunk: Buffer | string) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk: Buffer | string) => {
      stderr += chunk.toString();
    });

    child.on("close", (code) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      resolveDone({ code, stdout, stderr, timedOut });
    });

    child.on("error", (error) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      stderr += `\n${String(error)}\n`;
      resolveDone({ code: -1, stdout, stderr, timedOut });
    });
  });
}

export function assertExitOk(result: CommandResult, label: string): void {
  if (result.code === 0) {
    return;
  }
  const timeoutHint = result.timedOut ? " (timed out)" : "";
  throw new Error(
    `${label} exited with code ${String(result.code)}${timeoutHint}\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`,
  );
}

export async function ensureCliAuth(): Promise<void> {
  const authResult = await runBunCommand(["run", "chat:auth"], 120_000);
  assertExitOk(authResult, "bun run chat:auth");
}

export async function resolveLiveModel(): Promise<string> {
  return resolveLiveE2EModel();
}

export function getCliClient() {
  const config = loadConfig();
  if (!config?.token) {
    throw new Error("Missing CLI auth token. Run bun run chat:auth first.");
  }
  const serverUrl = config.serverUrl || process.env.BAP_SERVER_URL || defaultServerUrl;
  return createRpcClient(serverUrl, config.token);
}

export function requireMatch(output: string, pattern: RegExp, context: string): string {
  const matched = output.match(pattern);
  if (!matched) {
    throw new Error(`Expected output to match ${pattern}: ${context}`);
  }
  return matched[1] ?? "";
}

export function extractConversationId(output: string): string {
  return requireMatch(output, /\[conversation\]\s+([^\s]+)/, output);
}

export async function runChatMessage(args: {
  message: string;
  model?: string;
  autoApprove?: boolean;
  questionAnswers?: string[];
  files?: string[];
  timeoutMs?: number;
}): Promise<CommandResult> {
  const commandArgs = ["run", "chat", "--", "--message", args.message, "--no-validate"];

  if (args.model) {
    commandArgs.push("--model", args.model);
  }

  if (args.autoApprove) {
    commandArgs.push("--auto-approve");
  }

  for (const answer of args.questionAnswers ?? []) {
    commandArgs.push("--question-answer", answer);
  }

  for (const file of args.files ?? []) {
    commandArgs.push("--file", file);
  }

  return runBunCommand(commandArgs, args.timeoutMs ?? commandTimeoutMs);
}

export function encodeUtf16Be(text: string): Buffer {
  const buffer = Buffer.alloc(text.length * 2);
  for (let index = 0; index < text.length; index += 1) {
    const codePoint = text.charCodeAt(index);
    buffer[index * 2] = (codePoint >> 8) & 0xff;
    buffer[index * 2 + 1] = codePoint & 0xff;
  }
  return buffer;
}

export function containsPdfText(pdfBytes: Buffer, expectedText: string): boolean {
  const binary = pdfBytes.toString("latin1");
  const variants = Array.from(
    new Set([expectedText, expectedText.toLowerCase(), expectedText.toUpperCase()]),
  );

  for (const variant of variants) {
    if (pdfBytes.includes(Buffer.from(variant))) {
      return true;
    }

    if (pdfBytes.includes(encodeUtf16Be(variant))) {
      return true;
    }

    const utf16Hex = encodeUtf16Be(variant).toString("hex").toUpperCase();
    if (
      binary.includes(`<${utf16Hex}>`) ||
      binary.includes(`<FEFF${utf16Hex}>`) ||
      binary.includes(`<feff${utf16Hex.toLowerCase()}>`)
    ) {
      return true;
    }
  }

  return false;
}

function normalizeChannelName(value: string): string {
  return value.replace(/^#/, "").trim().toLowerCase();
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function parseSlackTs(value: string): number {
  const numeric = Number(value);
  if (Number.isNaN(numeric)) {
    return 0;
  }
  return numeric;
}

async function slackApi(
  token: string,
  method: string,
  body: Record<string, string | number | boolean>,
): Promise<SlackApiResponse> {
  const isGet = method === "conversations.list" || method === "conversations.history";
  const query = new URLSearchParams(
    Object.entries(body).map(([key, value]) => [key, String(value)]),
  ).toString();
  const url = isGet
    ? `https://slack.com/api/${method}?${query}`
    : `https://slack.com/api/${method}`;

  const response = await fetch(url, {
    method: isGet ? "GET" : "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      ...(isGet ? {} : { "Content-Type": "application/json" }),
    },
    ...(isGet ? {} : { body: JSON.stringify(body) }),
  });

  if (!response.ok) {
    throw new Error(`Slack API ${method} failed with HTTP ${response.status}`);
  }

  const payload = (await response.json()) as SlackApiResponse;
  if (!payload.ok) {
    throw new Error(
      `Slack API ${method} error: ${String(payload.error ?? "unknown")} payload=${JSON.stringify(payload)}`,
    );
  }

  return payload;
}

export async function resolveChannelId(token: string, channelName: string): Promise<string> {
  const target = normalizeChannelName(channelName);

  const findWithCursor = async (cursor?: string): Promise<string | null> => {
    const payload = await slackApi(token, "conversations.list", {
      types: "public_channel,private_channel",
      limit: 1000,
      ...(cursor ? { cursor } : {}),
    });

    const channel = (payload.channels ?? []).find((candidate) => {
      const name = candidate.name;
      if (!name) {
        return false;
      }
      return normalizeChannelName(name) === target;
    });

    if (channel?.id) {
      return channel.id;
    }

    const nextCursor = payload.response_metadata?.next_cursor?.trim() ?? "";
    if (!nextCursor) {
      return null;
    }

    return findWithCursor(nextCursor);
  };

  const channelId = await findWithCursor();
  if (channelId) {
    return channelId;
  }

  throw new Error(`Slack channel not found: #${target}`);
}

export async function readLatestMessage(
  token: string,
  channelId: string,
): Promise<{ ts: string; text: string }> {
  const payload = await slackApi(token, "conversations.history", {
    channel: channelId,
    limit: 30,
  });

  const message = (payload.messages ?? []).find((candidate) => {
    if (!candidate.ts || !candidate.text) {
      return false;
    }
    if (candidate.subtype && candidate.subtype !== "thread_broadcast") {
      return false;
    }
    return normalizeWhitespace(candidate.text).length > 0;
  });

  if (!message?.ts || !message.text) {
    throw new Error("Could not find a readable latest message in Slack channel history.");
  }

  return { ts: message.ts, text: normalizeWhitespace(message.text) };
}

export async function findEchoMessageAfterTs(args: {
  token: string;
  channelId: string;
  afterTs: number;
  marker: string;
}): Promise<string | null> {
  const payload = await slackApi(args.token, "conversations.history", {
    channel: args.channelId,
    limit: 100,
  });

  const match = (payload.messages ?? []).find((candidate) => {
    const text = normalizeWhitespace(candidate.text ?? "");
    const ts = parseSlackTs(candidate.ts ?? "0");
    if (!text || ts <= args.afterTs) {
      return false;
    }
    return text.includes(args.marker) && text.includes(echoPrefix);
  });

  return match?.text ? normalizeWhitespace(match.text) : null;
}

export async function pollSlackEchoMessage(args: {
  token: string;
  channelId: string;
  afterTs: number;
  marker: string;
  deadlineMs: number;
}): Promise<string> {
  const found = await findEchoMessageAfterTs(args);
  if (found) {
    return found;
  }
  if (Date.now() >= args.deadlineMs) {
    return "";
  }
  await new Promise((resolveSleep) => setTimeout(resolveSleep, slackPollIntervalMs));
  return pollSlackEchoMessage(args);
}

export function buildSlackPrompt(marker: string): string {
  return [
    `You are authenticated as ${expectedUserEmail}.`,
    `Use Slack tools to read the latest message in #${sourceChannelName}.`,
    `Then send a new message in #${targetChannelName} with exactly this format:`,
    `[${marker}] ${echoPrefix} <previous message>`,
    "Do not post in any other channel.",
    "Return only the final posted message text.",
  ].join("\n");
}

export async function getSlackAccessTokenForExpectedUser(): Promise<string> {
  const dbUser = await db.query.user.findFirst({
    where: eq(user.email, expectedUserEmail),
  });

  if (!dbUser) {
    throw new Error(`Live e2e user not found: ${expectedUserEmail}`);
  }

  const tokens = await getValidTokensForUser(dbUser.id);
  const slackToken = tokens.get("slack");

  if (!slackToken) {
    throw new Error(
      `Slack is not connected for ${expectedUserEmail}. Connect Slack in app integrations before running this test.`,
    );
  }

  return slackToken;
}

export function parseSlackTimestamp(value: string): number {
  return parseSlackTs(value);
}

export async function closeDbPool(): Promise<void> {
  await closePool();
}
