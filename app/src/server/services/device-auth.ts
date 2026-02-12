/**
 * Device authentication helpers for BYOC daemon.
 * Uses Better Auth's device authorization plugin for the code flow.
 * This module provides token verification for WebSocket connections.
 */

import { eq } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { db } from "@/server/db/client";
import { device } from "@/server/db/schema";

/**
 * Verify a Better Auth bearer token and resolve the device.
 * Used by the WebSocket server to authenticate daemon connections.
 */
export async function verifyDeviceToken(
  token: string,
  deviceId: string,
): Promise<{ userId: string; deviceId: string } | null> {
  try {
    const session = await auth.api.getSession({
      headers: new Headers({ Authorization: `Bearer ${token}` }),
    });

    if (!session?.user?.id) {
      return null;
    }

    // Verify the device exists and belongs to this user
    const dev = await db.query.device.findFirst({
      where: eq(device.id, deviceId),
    });

    if (!dev || dev.userId !== session.user.id) {
      return null;
    }

    return { userId: session.user.id, deviceId };
  } catch {
    return null;
  }
}
