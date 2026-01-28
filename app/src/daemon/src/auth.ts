/**
 * Device authentication flow for the Bap daemon.
 * Implements OAuth-like device code flow:
 * 1. Request a code pair from the server
 * 2. Display user code to the user
 * 3. Poll until the user approves on heybap.com/connect
 */

import { saveConfig, type DaemonConfig } from "./config";
import { logger } from "./logger";

const POLL_INTERVAL_MS = 3000;

export async function authenticate(serverUrl: string): Promise<DaemonConfig | null> {
  console.log("\n  Authenticating with", serverUrl, "\n");

  // 1. Request device code
  let userCode: string;
  let deviceCode: string;
  let expiresAt: string;

  try {
    const res = await fetch(`${serverUrl}/api/rpc/device.requestCode`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });

    if (!res.ok) {
      logger.error("auth", `Failed to request code: ${res.status}`);
      console.error("  Failed to request device code. Is the server running?");
      return null;
    }

    const data = await res.json();
    userCode = data.userCode;
    deviceCode = data.deviceCode;
    expiresAt = data.expiresAt;
  } catch (err) {
    logger.error("auth", "Failed to connect to server", err);
    console.error("  Could not connect to server at", serverUrl);
    return null;
  }

  // 2. Display code to user
  console.log("  Visit the following URL and enter the code:\n");
  console.log(`    ${serverUrl}/connect\n`);
  console.log(`    Code: \x1b[1m${userCode}\x1b[0m\n`);
  console.log("  Waiting for approval...\n");

  // 3. Poll until approved
  const expiry = new Date(expiresAt).getTime();

  while (Date.now() < expiry) {
    try {
      const res = await fetch(`${serverUrl}/api/rpc/device.poll`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ deviceCode }),
      });

      if (!res.ok) {
        await sleep(POLL_INTERVAL_MS);
        continue;
      }

      const data = await res.json();

      if (data.status === "approved" && data.token && data.deviceId) {
        const config: DaemonConfig = {
          serverUrl,
          token: data.token,
          deviceId: data.deviceId,
        };
        saveConfig(config);
        console.log("  \x1b[32mAuthenticated successfully!\x1b[0m\n");
        logger.info("auth", "Device authenticated", { deviceId: data.deviceId });
        return config;
      }

      if (data.status === "expired") {
        console.error("  Code expired. Please try again.");
        return null;
      }

      if (data.status === "denied") {
        console.error("  Authentication denied.");
        return null;
      }

      // Still pending
    } catch {
      // Network error, retry
    }

    await sleep(POLL_INTERVAL_MS);
  }

  console.error("  Code expired. Please try again.");
  return null;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
