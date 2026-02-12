/**
 * Device authentication flow for the Bap daemon.
 * Uses Better Auth's device authorization plugin (RFC 8628):
 * 1. Request a device code from the Better Auth endpoint
 * 2. Display user code to the user
 * 3. Poll until the user approves on the web UI
 * 4. Register the device via oRPC
 */

import { saveConfig, type DaemonConfig } from "./config";
import { logger } from "./logger";
import { hostname, platform, arch } from "os";

const CLIENT_ID = "bap-daemon";

export async function authenticate(serverUrl: string): Promise<DaemonConfig | null> {
  console.log("\n  Authenticating with", serverUrl, "\n");

  // 1. Request device code via Better Auth
  let deviceCode: string;
  let userCode: string;
  let verificationUri: string;
  let interval = 5;
  let expiresIn = 1800; // default 30 min

  try {
    const res = await fetch(`${serverUrl}/api/auth/device/code`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        client_id: CLIENT_ID,
      }),
    });

    if (!res.ok) {
      logger.error("auth", `Failed to request code: ${res.status}`);
      console.error("  Failed to request device code. Is the server running?");
      return null;
    }

    const data = await res.json();
    deviceCode = data.device_code;
    userCode = data.user_code;
    verificationUri = data.verification_uri_complete || data.verification_uri;
    interval = data.interval || 5;
    expiresIn = data.expires_in || 1800;
  } catch (err) {
    logger.error("auth", "Failed to connect to server", err);
    console.error("  Could not connect to server at", serverUrl);
    return null;
  }

  // 2. Display code to user
  console.log("  Visit the following URL and enter the code:\n");
  console.log(`    ${verificationUri}\n`);
  console.log(`    Code: \x1b[1m${userCode}\x1b[0m\n`);
  console.log("  Waiting for approval...\n");

  // 3. Poll for token via Better Auth
  let pollingInterval = interval * 1000;
  const deadline = Date.now() + expiresIn * 1000;

  while (Date.now() < deadline) {
    await sleep(pollingInterval);

    try {
      const res = await fetch(`${serverUrl}/api/auth/device/token`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          grant_type: "urn:ietf:params:oauth:grant-type:device_code",
          device_code: deviceCode,
          client_id: CLIENT_ID,
        }),
      });

      const data = await res.json();

      if (data.access_token) {
        // 4. Register the device via oRPC
        const deviceName = hostname() || "My Device";
        const devicePlatform = `${platform()} ${arch()}`;

        const registerRes = await fetch(`${serverUrl}/api/rpc/device.register`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            token: data.access_token,
            deviceName,
            platform: devicePlatform,
          }),
        });

        if (!registerRes.ok) {
          console.error("  Failed to register device");
          return null;
        }

        const registerData = await registerRes.json();
        if (!registerData.success || !registerData.deviceId) {
          console.error("  Failed to register device:", registerData.error);
          return null;
        }

        const config: DaemonConfig = {
          serverUrl,
          token: data.access_token,
          deviceId: registerData.deviceId,
        };
        saveConfig(config);
        console.log("  \x1b[32mAuthenticated successfully!\x1b[0m\n");
        logger.info("auth", "Device authenticated", {
          deviceId: registerData.deviceId,
        });
        return config;
      }

      if (data.error) {
        switch (data.error) {
          case "authorization_pending":
            // Continue polling
            break;
          case "slow_down":
            pollingInterval += 5000;
            break;
          case "expired_token":
            console.error("  Code expired. Please try again.");
            return null;
          case "access_denied":
            console.error("  Authentication denied.");
            return null;
          default:
            logger.error("auth", `Unexpected error: ${data.error}`);
            break;
        }
      }
    } catch {
      // Network error, retry
    }
  }

  console.error("  Code expired. Please try again.");
  return null;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
