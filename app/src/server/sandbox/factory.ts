/**
 * Factory for selecting the appropriate SandboxBackend based on context.
 */

import { isDeviceOnline } from "@/server/ws/server";
import type { SandboxBackend } from "./types";
import { BYOCSandboxBackend } from "./byoc";
import { E2BSandboxBackend } from "./e2b";
import { isE2BConfigured } from "./e2b";

/**
 * Get a SandboxBackend for a generation.
 *
 * If a deviceId is provided and the device is online, returns a BYOCSandboxBackend.
 * Otherwise falls back to E2BSandboxBackend.
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

  // Fall back to E2B
  if (!isE2BConfigured()) {
    throw new Error(
      "No sandbox backend available: E2B not configured and no BYOC device connected",
    );
  }

  return new E2BSandboxBackend();
}
