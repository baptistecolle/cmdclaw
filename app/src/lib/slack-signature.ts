import crypto from "crypto";
import { env } from "@/env";

/**
 * Verify Slack request signature (HMAC-SHA256).
 * https://api.slack.com/authentication/verifying-requests-from-slack
 */
export function verifySlackSignature(
  body: string,
  timestamp: string,
  signature: string,
): boolean {
  const secret = env.SLACK_SIGNING_SECRET;
  if (!secret) return false;

  // Reject requests older than 5 minutes (replay attack prevention)
  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - Number(timestamp)) > 300) return false;

  const sigBasestring = `v0:${timestamp}:${body}`;
  const mySignature =
    "v0=" +
    crypto.createHmac("sha256", secret).update(sigBasestring).digest("hex");

  const expectedBuffer = Buffer.from(mySignature);
  const actualBuffer = Buffer.from(signature);

  if (expectedBuffer.length !== actualBuffer.length) {
    return false;
  }

  try {
    return crypto.timingSafeEqual(expectedBuffer, actualBuffer);
  } catch {
    return false;
  }
}
