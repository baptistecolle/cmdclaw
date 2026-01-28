import { z } from "zod";
import { baseProcedure, protectedProcedure } from "../middleware";
import { db } from "@/server/db/client";
import { device } from "@/server/db/schema";
import { eq } from "drizzle-orm";
import {
  generateDeviceCode,
  approveDevice,
  pollDeviceCode,
} from "@/server/services/device-auth";

/**
 * Request a new device code pair (called by daemon, no auth required).
 */
const requestCode = baseProcedure
  .output(
    z.object({
      userCode: z.string(),
      deviceCode: z.string(),
      expiresAt: z.string(),
    })
  )
  .handler(async () => {
    const result = await generateDeviceCode();
    return {
      userCode: result.userCode,
      deviceCode: result.deviceCode,
      expiresAt: result.expiresAt.toISOString(),
    };
  });

/**
 * Poll for device code approval (called by daemon, no auth required).
 */
const poll = baseProcedure
  .input(z.object({ deviceCode: z.string() }))
  .output(
    z.object({
      status: z.enum(["pending", "approved", "expired", "denied"]),
      token: z.string().optional(),
      deviceId: z.string().optional(),
    })
  )
  .handler(async ({ input }) => {
    return await pollDeviceCode(input.deviceCode);
  });

/**
 * Approve a device code (called by user from web UI, requires auth).
 */
const approve = protectedProcedure
  .input(
    z.object({
      userCode: z.string().min(1),
      deviceName: z.string().optional(),
      platform: z.string().optional(),
    })
  )
  .output(
    z.object({
      success: z.boolean(),
      error: z.string().optional(),
    })
  )
  .handler(async ({ input, context }) => {
    return await approveDevice({
      userCode: input.userCode,
      userId: context.user.id,
      deviceName: input.deviceName,
      platform: input.platform,
    });
  });

/**
 * List user's devices (requires auth).
 */
const list = protectedProcedure
  .output(
    z.array(
      z.object({
        id: z.string(),
        name: z.string(),
        platform: z.string(),
        isOnline: z.boolean(),
        lastSeenAt: z.string().nullable(),
        capabilities: z.unknown().nullable(),
        createdAt: z.string(),
      })
    )
  )
  .handler(async ({ context }) => {
    const devices = await db.query.device.findMany({
      where: eq(device.userId, context.user.id),
    });

    return devices.map((d) => ({
      id: d.id,
      name: d.name,
      platform: d.platform,
      isOnline: d.isOnline,
      lastSeenAt: d.lastSeenAt?.toISOString() ?? null,
      capabilities: d.capabilities ?? null,
      createdAt: d.createdAt.toISOString(),
    }));
  });

/**
 * Revoke (delete) a device (requires auth).
 */
const revoke = protectedProcedure
  .input(z.object({ deviceId: z.string() }))
  .output(z.object({ success: z.boolean() }))
  .handler(async ({ input, context }) => {
    const dev = await db.query.device.findFirst({
      where: eq(device.id, input.deviceId),
    });

    if (!dev || dev.userId !== context.user.id) {
      return { success: false };
    }

    await db.delete(device).where(eq(device.id, input.deviceId));
    return { success: true };
  });

export const deviceRouter = {
  requestCode,
  poll,
  approve,
  list,
  revoke,
};
