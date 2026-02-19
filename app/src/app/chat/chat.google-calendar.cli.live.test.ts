import { afterAll, beforeAll, describe, expect, test } from "vitest";
import {
  assertExitOk,
  closeDbPool,
  ensureCliAuth,
  expectedUserEmail,
  getGoogleCalendarAccessTokenForExpectedUser,
  liveEnabled,
  readUpcomingGoogleCalendarEvent,
  responseTimeoutMs,
  resolveLiveModel,
  runChatMessage,
} from "../../../tests/e2e-cli/live-fixtures";

let liveModel = "";

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function buildGoogleCalendarReadPrompt(args: { eventId: string }): string {
  return [
    `You are authenticated as ${expectedUserEmail}.`,
    `Use Google Calendar tools to read the event with id ${args.eventId} from the primary calendar.`,
    `Return only: GCAL_EVENT_ID=${args.eventId} <summary> | START=<start>`,
  ].join("\n");
}

describe.runIf(liveEnabled)("@live CLI chat google-calendar", () => {
  beforeAll(async () => {
    await ensureCliAuth();
    liveModel = await resolveLiveModel();
  });

  afterAll(async () => {
    await closeDbPool();
  });

  test(
    "reads upcoming event and verifies against Google Calendar provider API",
    { timeout: Math.max(responseTimeoutMs + 90_000, 300_000) },
    async () => {
      const googleCalendarAccessToken = await getGoogleCalendarAccessTokenForExpectedUser();
      const upcomingEvent = await readUpcomingGoogleCalendarEvent({
        token: googleCalendarAccessToken,
      });

      const result = await runChatMessage({
        message: buildGoogleCalendarReadPrompt({ eventId: upcomingEvent.id }),
        model: liveModel,
        autoApprove: true,
        timeoutMs: responseTimeoutMs,
      });

      assertExitOk(result, "chat google_calendar read-only");
      expect(result.stdout).not.toContain("[error]");
      expect(result.stdout).not.toContain("[auth_needed]");
      expect(result.stdout).toContain(`GCAL_EVENT_ID=${upcomingEvent.id}`);
      expect(normalizeWhitespace(result.stdout)).toContain(
        normalizeWhitespace(upcomingEvent.summary),
      );
      expect(result.stdout).toContain(upcomingEvent.start);
    },
  );
});
