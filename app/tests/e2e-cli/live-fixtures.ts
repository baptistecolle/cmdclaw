import { and, eq } from "drizzle-orm";
import { spawn } from "node:child_process";
import type { IntegrationType } from "../../src/server/oauth/config";
import { loadConfig, createRpcClient } from "../../scripts/lib/cli-shared";
import { closePool, db } from "../../src/server/db/client";
import { integration, integrationToken, user } from "../../src/server/db/schema";
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
export const gmailPollIntervalMs = Number(process.env.E2E_GMAIL_POLL_INTERVAL_MS ?? "2500");

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

type GmailMessageRef = {
  id?: string;
};

type GmailHeader = {
  name?: string;
  value?: string;
};

type GmailListResponse = {
  messages?: GmailMessageRef[];
};

type GmailMessageResponse = {
  id?: string;
  internalDate?: string;
  payload?: {
    headers?: GmailHeader[];
  };
};

type GoogleCalendarEventDateTime = {
  dateTime?: string;
  date?: string;
};

type GoogleCalendarEvent = {
  id?: string;
  summary?: string;
  start?: GoogleCalendarEventDateTime;
};

type GoogleCalendarEventsResponse = {
  items?: GoogleCalendarEvent[];
};

type UnipileUserResponse = {
  provider_id?: string;
  display_name?: string;
  headline?: string;
  public_identifier?: string;
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

export async function withIntegrationTokensTemporarilyRemoved<T>(args: {
  email: string;
  integrationType: IntegrationType;
  run: () => Promise<T>;
}): Promise<T> {
  const dbUser = await db.query.user.findFirst({
    where: eq(user.email, args.email),
    columns: { id: true },
  });
  if (!dbUser) {
    return args.run();
  }

  const dbIntegration = await db.query.integration.findFirst({
    where: and(eq(integration.userId, dbUser.id), eq(integration.type, args.integrationType)),
    columns: { id: true },
  });
  if (!dbIntegration) {
    return args.run();
  }

  const previousTokens = await db.query.integrationToken.findMany({
    where: eq(integrationToken.integrationId, dbIntegration.id),
  });

  if (previousTokens.length > 0) {
    await db.delete(integrationToken).where(eq(integrationToken.integrationId, dbIntegration.id));
  }

  try {
    return await args.run();
  } finally {
    const currentTokens = await db.query.integrationToken.findMany({
      where: eq(integrationToken.integrationId, dbIntegration.id),
    });

    if (currentTokens.length === 0 && previousTokens.length > 0) {
      await db.insert(integrationToken).values(
        previousTokens.map((token) => ({
          integrationId: dbIntegration.id,
          accessToken: token.accessToken,
          refreshToken: token.refreshToken,
          tokenType: token.tokenType,
          expiresAt: token.expiresAt,
          idToken: token.idToken,
        })),
      );
    }
  }
}

export async function resolveLiveModel(): Promise<string> {
  return resolveLiveE2EModel();
}

export function getCliClient() {
  const serverUrl = process.env.BAP_SERVER_URL || defaultServerUrl;
  const config = loadConfig(serverUrl);
  if (!config?.token) {
    throw new Error(
      `Missing CLI auth token for ${serverUrl}. Run: bun run chat -- --server ${serverUrl} --auth`,
    );
  }
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
  conversation?: string;
  autoApprove?: boolean;
  questionAnswers?: string[];
  files?: string[];
  timeoutMs?: number;
}): Promise<CommandResult> {
  const commandArgs = ["run", "chat", "--", "--message", args.message, "--no-validate"];

  if (args.model) {
    commandArgs.push("--model", args.model);
  }

  if (args.conversation) {
    commandArgs.push("--conversation", args.conversation);
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

async function gmailApi<T>(
  token: string,
  path: string,
  params: Record<string, string | number | boolean> = {},
): Promise<T> {
  const query = new URLSearchParams(
    Object.entries(params).map(([key, value]) => [key, String(value)]),
  ).toString();
  const url = `https://gmail.googleapis.com/gmail/v1/users/me/${path}${query ? `?${query}` : ""}`;

  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  if (!response.ok) {
    throw new Error(`Gmail API ${path} failed with HTTP ${response.status}`);
  }

  return (await response.json()) as T;
}

function parseGmailInternalDate(value: string | undefined): number {
  if (!value) {
    return 0;
  }
  const numeric = Number(value);
  if (Number.isNaN(numeric)) {
    return 0;
  }
  return numeric;
}

function readHeader(headers: GmailHeader[] | undefined, name: string): string {
  if (!headers) {
    return "";
  }
  const match = headers.find((header) => header.name?.toLowerCase() === name.toLowerCase());
  return match?.value?.trim() ?? "";
}

export async function getGmailAccessTokenForExpectedUser(): Promise<string> {
  const dbUser = await db.query.user.findFirst({
    where: eq(user.email, expectedUserEmail),
  });

  if (!dbUser) {
    throw new Error(`Live e2e user not found: ${expectedUserEmail}`);
  }

  const tokens = await getValidTokensForUser(dbUser.id);
  const gmailToken = tokens.get("gmail");

  if (!gmailToken) {
    throw new Error(
      `Gmail is not connected for ${expectedUserEmail}. Connect Gmail in app integrations before running this test.`,
    );
  }

  return gmailToken;
}

async function googleCalendarApi<T>(
  token: string,
  path: string,
  params: Record<string, string | number | boolean> = {},
): Promise<T> {
  const query = new URLSearchParams(
    Object.entries(params).map(([key, value]) => [key, String(value)]),
  ).toString();
  const url = `https://www.googleapis.com/calendar/v3/${path}${query ? `?${query}` : ""}`;

  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  if (!response.ok) {
    throw new Error(`Google Calendar API ${path} failed with HTTP ${response.status}`);
  }

  return (await response.json()) as T;
}

function normalizeCalendarStart(start: GoogleCalendarEventDateTime | undefined): string {
  if (!start) {
    return "";
  }
  return (start.dateTime ?? start.date ?? "").trim();
}

export async function getGoogleCalendarAccessTokenForExpectedUser(): Promise<string> {
  const dbUser = await db.query.user.findFirst({
    where: eq(user.email, expectedUserEmail),
  });

  if (!dbUser) {
    throw new Error(`Live e2e user not found: ${expectedUserEmail}`);
  }

  const tokens = await getValidTokensForUser(dbUser.id);
  const googleCalendarToken = tokens.get("google_calendar");

  if (!googleCalendarToken) {
    throw new Error(
      `Google Calendar is not connected for ${expectedUserEmail}. Connect Google Calendar in app integrations before running this test.`,
    );
  }

  return googleCalendarToken;
}

export async function readUpcomingGoogleCalendarEvent(args: {
  token: string;
  calendarId?: string;
}): Promise<{ id: string; summary: string; start: string }> {
  const encodedCalendarId = encodeURIComponent(args.calendarId ?? "primary");
  const events = await googleCalendarApi<GoogleCalendarEventsResponse>(
    args.token,
    `calendars/${encodedCalendarId}/events`,
    {
      maxResults: 5,
      singleEvents: true,
      orderBy: "startTime",
      timeMin: new Date().toISOString(),
    },
  );

  const readableEvent = (events.items ?? []).find((event) => {
    const id = event.id?.trim() ?? "";
    const summary = event.summary?.replace(/\s+/g, " ").trim() ?? "";
    const start = normalizeCalendarStart(event.start);
    return Boolean(id && summary && start);
  });

  if (!readableEvent?.id) {
    throw new Error("Could not find a readable upcoming event in Google Calendar.");
  }

  return {
    id: readableEvent.id,
    summary: readableEvent.summary!.replace(/\s+/g, " ").trim(),
    start: normalizeCalendarStart(readableEvent.start),
  };
}

export async function getLinkedInAccountIdForExpectedUser(): Promise<string> {
  const dbUser = await db.query.user.findFirst({
    where: eq(user.email, expectedUserEmail),
    columns: { id: true },
  });

  if (!dbUser) {
    throw new Error(`Live e2e user not found: ${expectedUserEmail}`);
  }

  const linkedInIntegration = await db.query.integration.findFirst({
    where: and(eq(integration.userId, dbUser.id), eq(integration.type, "linkedin")),
    columns: { providerAccountId: true },
  });

  if (!linkedInIntegration?.providerAccountId) {
    throw new Error(
      `LinkedIn is not connected for ${expectedUserEmail}. Connect LinkedIn in app integrations before running this test.`,
    );
  }

  return linkedInIntegration.providerAccountId;
}

async function unipileApi<T>(
  path: string,
  params: Record<string, string | number | boolean> = {},
): Promise<T> {
  const unipileApiKey = process.env.UNIPILE_API_KEY;
  const unipileDsn = process.env.UNIPILE_DSN;
  if (!unipileApiKey || !unipileDsn) {
    throw new Error(
      "Missing Unipile configuration. Set UNIPILE_API_KEY and UNIPILE_DSN to run LinkedIn live tests.",
    );
  }

  const query = new URLSearchParams(
    Object.entries(params).map(([key, value]) => [key, String(value)]),
  ).toString();
  const url = `https://${unipileDsn}/api/v1/${path}${query ? `?${query}` : ""}`;

  const response = await fetch(url, {
    headers: {
      "X-API-KEY": unipileApiKey,
      Accept: "application/json",
    },
  });

  if (!response.ok) {
    throw new Error(`Unipile API ${path} failed with HTTP ${response.status}`);
  }

  return (await response.json()) as T;
}

export async function readLinkedInOwnProfile(args: {
  accountId: string;
}): Promise<{ id: string; name: string; headline: string; publicIdentifier: string }> {
  const meProfile = await unipileApi<UnipileUserResponse>("users/me", {
    account_id: args.accountId,
  });

  const id = meProfile.provider_id?.trim() ?? "";
  const name = meProfile.display_name?.trim() ?? "";
  const publicIdentifier = meProfile.public_identifier?.trim() ?? "";
  let headline = meProfile.headline?.replace(/\s+/g, " ").trim() ?? "";

  // LinkedIn `users/me` may omit headline; mirror runtime behavior by following up with users/{identifier}.
  if (!headline && publicIdentifier) {
    const fullProfile = await unipileApi<UnipileUserResponse>(
      `users/${encodeURIComponent(publicIdentifier)}`,
      {
        account_id: args.accountId,
      },
    );
    headline = fullProfile.headline?.replace(/\s+/g, " ").trim() ?? "";
  }

  if (!id) {
    throw new Error("LinkedIn provider verification failed: own profile missing provider_id.");
  }
  if (!headline) {
    throw new Error("LinkedIn provider verification failed: own profile missing headline.");
  }

  return { id, name, headline, publicIdentifier };
}

export async function readLatestInboxMessage(args: {
  token: string;
}): Promise<{ id: string; subject: string; internalDateMs: number }> {
  const list = await gmailApi<GmailListResponse>(args.token, "messages", {
    maxResults: 10,
    labelIds: "INBOX",
    q: "in:inbox",
  });

  const messages = (list.messages ?? []).filter((message): message is { id: string } =>
    Boolean(message.id),
  );
  const detailsList = await Promise.all(
    messages.map(async (message) => ({
      id: message.id,
      details: await gmailApi<GmailMessageResponse>(args.token, `messages/${message.id}`, {
        format: "metadata",
        metadataHeaders: "Subject",
      }),
    })),
  );

  for (const entry of detailsList) {
    const subject = readHeader(entry.details.payload?.headers, "Subject");
    if (!subject) {
      continue;
    }
    return {
      id: entry.id,
      subject: subject.replace(/\s+/g, " ").trim(),
      internalDateMs: parseGmailInternalDate(entry.details.internalDate),
    };
  }

  throw new Error("Could not find a readable latest message in Gmail inbox.");
}

export function parseSlackTimestamp(value: string): number {
  return parseSlackTs(value);
}

export async function closeDbPool(): Promise<void> {
  await closePool();
}
