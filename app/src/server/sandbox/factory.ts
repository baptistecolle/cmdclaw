/**
 * Factory for selecting the appropriate SandboxBackend based on context.
 */

import { isDeviceOnline } from "@/server/ws/server";
import type { SandboxBackend } from "./types";
import { BYOCSandboxBackend } from "./byoc";
import { DaytonaSandboxBackend, isDaytonaConfigured } from "./daytona";
import { E2BSandboxBackend } from "./e2b";
import { isE2BConfigured } from "./e2b";

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

  if (isE2BConfigured()) {
    return new E2BSandboxBackend();
  }

  if (isDaytonaConfigured()) {
    return new DaytonaSandboxBackend();
  }

  throw new Error(
    "No sandbox backend available: no BYOC device connected and neither E2B nor Daytona are configured",
  );
}
