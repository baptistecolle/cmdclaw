import { z } from "zod";
import { baseProcedure, protectedProcedure } from "../middleware";
import { db } from "@/server/db/client";
import { device } from "@/server/db/schema";
import { eq } from "drizzle-orm";
import { auth } from "@/lib/auth";

/**
 * Register a new device (called by daemon after Better Auth device code flow).
 * The daemon sends its Bearer token from the device code flow.
 */
const register = baseProcedure
  .input(
    z.object({
      token: z.string(),
      deviceName: z.string().optional(),
      platform: z.string().optional(),
    })
  )
  .output(
    z.object({
      success: z.boolean(),
      deviceId: z.string().optional(),
      error: z.string().optional(),
    })
  )
  .handler(async ({ input }) => {
    // Verify the Bearer token via Better Auth
    const session = await auth.api.getSession({
      headers: new Headers({ Authorization: `Bearer ${input.token}` }),
    });

    if (!session?.user?.id) {
      return { success: false, error: "Invalid token" };
    }

    // Create device record
    const [newDevice] = await db
      .insert(device)
      .values({
        userId: session.user.id,
        name: input.deviceName || "My Device",
        platform: input.platform || "unknown",
      })
      .returning();

    return { success: true, deviceId: newDevice.id };
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
  register,
  list,
  revoke,
};
