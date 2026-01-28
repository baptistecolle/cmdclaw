/**
 * Device authentication service for BYOC daemon.
 * Implements an OAuth-like device code flow:
 * 1. Daemon requests a code pair (userCode + deviceCode)
 * 2. User enters userCode on heybap.com/connect
 * 3. Daemon polls with deviceCode until approved
 * 4. On approval, daemon receives a JWT for WebSocket auth
 */

import { SignJWT, jwtVerify } from "jose";
import { db } from "@/server/db/client";
import { device, deviceCode } from "@/server/db/schema";
import { eq, and, lt } from "drizzle-orm";
import { env } from "@/env";

const DEVICE_CODE_TTL_MS = 15 * 60 * 1000; // 15 minutes

function getJWTSecret(): Uint8Array {
  const secret = env.BYOC_JWT_SECRET;
  if (!secret) {
    throw new Error("BYOC_JWT_SECRET is not configured");
  }
  return new TextEncoder().encode(secret);
}

/**
 * Generate a short human-readable code (e.g. "ABCD-1234")
 */
function generateUserCode(): string {
  const letters = "ABCDEFGHJKLMNPQRSTUVWXYZ"; // no I, O
  const digits = "0123456789";
  let code = "";
  for (let i = 0; i < 4; i++) {
    code += letters[Math.floor(Math.random() * letters.length)];
  }
  code += "-";
  for (let i = 0; i < 4; i++) {
    code += digits[Math.floor(Math.random() * digits.length)];
  }
  return code;
}

/**
 * Generate device code pair for the daemon to begin auth flow.
 */
export async function generateDeviceCode(): Promise<{
  userCode: string;
  deviceCode: string;
  expiresAt: Date;
}> {
  const userCode = generateUserCode();
  const dCode = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + DEVICE_CODE_TTL_MS);

  await db.insert(deviceCode).values({
    userCode,
    deviceCode: dCode,
    status: "pending",
    expiresAt,
  });

  return { userCode, deviceCode: dCode, expiresAt };
}

/**
 * Approve a device code (called when user enters code on web UI).
 * Creates the device record and links it to the user.
 */
export async function approveDevice(params: {
  userCode: string;
  userId: string;
  deviceName?: string;
  platform?: string;
}): Promise<{ success: boolean; error?: string }> {
  const code = await db.query.deviceCode.findFirst({
    where: eq(deviceCode.userCode, params.userCode.toUpperCase()),
  });

  if (!code) {
    return { success: false, error: "Invalid code" };
  }

  if (code.status !== "pending") {
    return { success: false, error: "Code already used" };
  }

  if (code.expiresAt < new Date()) {
    await db
      .update(deviceCode)
      .set({ status: "expired" })
      .where(eq(deviceCode.id, code.id));
    return { success: false, error: "Code expired" };
  }

  // Create device record
  const [newDevice] = await db
    .insert(device)
    .values({
      userId: params.userId,
      name: params.deviceName || "My Device",
      platform: params.platform || "unknown",
    })
    .returning();

  // Update code as approved
  await db
    .update(deviceCode)
    .set({
      status: "approved",
      userId: params.userId,
      deviceId: newDevice.id,
    })
    .where(eq(deviceCode.id, code.id));

  return { success: true };
}

/**
 * Poll for device code approval. Returns a JWT token when approved.
 */
export async function pollDeviceCode(dCode: string): Promise<{
  status: "pending" | "approved" | "expired" | "denied";
  token?: string;
  deviceId?: string;
}> {
  const code = await db.query.deviceCode.findFirst({
    where: eq(deviceCode.deviceCode, dCode),
  });

  if (!code) {
    return { status: "denied" };
  }

  if (code.expiresAt < new Date() && code.status === "pending") {
    await db
      .update(deviceCode)
      .set({ status: "expired" })
      .where(eq(deviceCode.id, code.id));
    return { status: "expired" };
  }

  if (code.status !== "approved" || !code.userId || !code.deviceId) {
    return { status: code.status as "pending" | "expired" | "denied" };
  }

  // Generate JWT for the device
  const token = await new SignJWT({
    sub: code.userId,
    deviceId: code.deviceId,
    type: "device",
  })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("365d")
    .sign(getJWTSecret());

  return {
    status: "approved",
    token,
    deviceId: code.deviceId,
  };
}

/**
 * Verify a device JWT token.
 */
export async function verifyDeviceToken(
  token: string
): Promise<{ userId: string; deviceId: string } | null> {
  try {
    const { payload } = await jwtVerify(token, getJWTSecret());
    if (
      payload.type !== "device" ||
      typeof payload.sub !== "string" ||
      typeof payload.deviceId !== "string"
    ) {
      return null;
    }

    // Verify device still exists
    const dev = await db.query.device.findFirst({
      where: eq(device.id, payload.deviceId),
    });

    if (!dev || dev.userId !== payload.sub) {
      return null;
    }

    return { userId: payload.sub, deviceId: payload.deviceId };
  } catch {
    return null;
  }
}

/**
 * Clean up expired device codes.
 */
export async function cleanupExpiredCodes(): Promise<void> {
  await db
    .delete(deviceCode)
    .where(
      and(
        eq(deviceCode.status, "pending"),
        lt(deviceCode.expiresAt, new Date())
      )
    );
}
