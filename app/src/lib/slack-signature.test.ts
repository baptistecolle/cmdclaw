import crypto from "crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { envState } = vi.hoisted(() => ({
  envState: {
    SLACK_SIGNING_SECRET: "test-signing-secret" as string | undefined,
  },
}));

vi.mock("@/env", () => ({
  env: envState,
}));

import { verifySlackSignature } from "./slack-signature";

function sign(body: string, timestamp: string, secret: string): string {
  return (
    "v0=" +
    crypto
      .createHmac("sha256", secret)
      .update(`v0:${timestamp}:${body}`)
      .digest("hex")
  );
}

describe("verifySlackSignature", () => {
  beforeEach(() => {
    envState.SLACK_SIGNING_SECRET = "test-signing-secret";
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-02-12T10:00:00.000Z"));
  });

  it("accepts a valid signature", () => {
    const body = JSON.stringify({ type: "event_callback" });
    const timestamp = String(Math.floor(Date.now() / 1000));
    const signature = sign(body, timestamp, envState.SLACK_SIGNING_SECRET!);

    expect(verifySlackSignature(body, timestamp, signature)).toBe(true);
  });

  it("rejects when signing secret is missing", () => {
    envState.SLACK_SIGNING_SECRET = undefined;

    expect(
      verifySlackSignature(
        "{}",
        String(Math.floor(Date.now() / 1000)),
        "v0=abc",
      ),
    ).toBe(false);
  });

  it("rejects old timestamps", () => {
    const body = "{}";
    const timestamp = String(Math.floor(Date.now() / 1000) - 301);
    const signature = sign(body, timestamp, envState.SLACK_SIGNING_SECRET!);

    expect(verifySlackSignature(body, timestamp, signature)).toBe(false);
  });

  it("rejects tampered bodies", () => {
    const originalBody = JSON.stringify({ text: "hello" });
    const tamperedBody = JSON.stringify({ text: "goodbye" });
    const timestamp = String(Math.floor(Date.now() / 1000));
    const signature = sign(
      originalBody,
      timestamp,
      envState.SLACK_SIGNING_SECRET!,
    );

    expect(verifySlackSignature(tamperedBody, timestamp, signature)).toBe(
      false,
    );
  });

  it("returns false for malformed signatures", () => {
    const timestamp = String(Math.floor(Date.now() / 1000));

    expect(verifySlackSignature("{}", timestamp, "v0=short")).toBe(false);
  });
});
