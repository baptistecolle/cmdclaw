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
 * Priority:
 * 1. SANDBOX_DEFAULT when set and provider is configured
 * 2. E2B when configured
 * 3. Daytona when configured
 */
export function getPreferredCloudSandboxProvider(): CloudSandboxProvider | null {
  const configuredDefault = env.SANDBOX_DEFAULT;

  if (configuredDefault === "daytona" && isDaytonaConfigured()) {
    return "daytona";
  }

  if (configuredDefault === "e2b" && isE2BConfigured()) {
    return "e2b";
  }

  if (isE2BConfigured()) {
    return "e2b";
  }

  if (isDaytonaConfigured()) {
    return "daytona";
  }

  return null;
}

/**
 * Get a SandboxBackend for a generation.
 *
 * If a deviceId is provided and the device is online, returns a BYOCSandboxBackend.
 * Otherwise falls back to E2B, then Daytona if configured.
 */
export function getSandboxBackend(
  conversationId: string,
  userId: string,
  deviceId?: string,
): SandboxBackend {
  // Prefer BYOC if device is specified and online
  if (deviceId && isDeviceOnline(deviceId)) {
    return new BYOCSandboxBackend(deviceId);
  }

  const provider = getPreferredCloudSandboxProvider();
  if (provider === "e2b") {
    return new E2BSandboxBackend();
  }
  if (provider === "daytona") {
    return new DaytonaSandboxBackend();
  }

  throw new Error(
    "No sandbox backend available: no BYOC device connected and neither E2B nor Daytona are configured",
  );
}
