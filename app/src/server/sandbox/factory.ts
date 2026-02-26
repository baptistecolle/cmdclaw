/**
 * Factory for selecting the appropriate SandboxBackend based on context.
 */

import { env } from "@/env";
import { isDeviceOnline } from "@/server/ws/server";
import type { SandboxBackend } from "./types";
import { BYOCSandboxBackend } from "./byoc";
import { DaytonaSandboxBackend, isDaytonaConfigured } from "./daytona";
import { E2BSandboxBackend } from "./e2b";
import { isE2BConfigured } from "./e2b";

export type CloudSandboxProvider = "e2b" | "daytona";

/**
 * Resolve which cloud sandbox provider should be used when no BYOC device is active.
 *
 * SANDBOX_DEFAULT is authoritative: if it points to a provider that is not configured,
 * throw immediately instead of falling back to the other provider.
 */
export function getPreferredCloudSandboxProvider(): CloudSandboxProvider {
  const configuredDefault = env.SANDBOX_DEFAULT;

  if (configuredDefault === "e2b") {
    if (!isE2BConfigured()) {
      throw new Error("SANDBOX_DEFAULT is set to 'e2b' but E2B_API_KEY is not configured");
    }
    return "e2b";
  }

  if (configuredDefault === "daytona") {
    if (!isDaytonaConfigured()) {
      throw new Error("SANDBOX_DEFAULT is set to 'daytona' but DAYTONA_API_KEY is not configured");
    }
    return "daytona";
  }

  throw new Error(`Unsupported SANDBOX_DEFAULT value: ${configuredDefault}`);
}

/**
 * Get a SandboxBackend for a generation.
 *
 * If a deviceId is provided and the device is online, returns a BYOCSandboxBackend.
 */
export function getSandboxBackend(
  conversationId: string,
  userId: string,
  deviceId?: string,
): SandboxBackend {
  // Silence lint about unused params while preserving public API.
  void conversationId;
  void userId;

  // Prefer BYOC if device is specified and online
  if (deviceId && isDeviceOnline(deviceId)) {
    return new BYOCSandboxBackend(deviceId);
  }

  const provider = getPreferredCloudSandboxProvider();
  if (provider === "e2b") {
    return new E2BSandboxBackend();
  }
  return new DaytonaSandboxBackend();
}
