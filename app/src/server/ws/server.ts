/**
 * Bun WebSocket server for BYOC daemon connections.
 * Runs as a separate process alongside Next.js on WS_PORT (default 4097).
 *
 * Handles:
 * - Device authentication via JWT
 * - Ping/pong heartbeat for device online status
 * - Request/response messaging between server and daemon
 */

import type { ServerWebSocket } from "bun";
import { db } from "@/server/db/client";
import { device } from "@/server/db/schema";
import { eq } from "drizzle-orm";
import { verifyDeviceToken } from "@/server/services/device-auth";
import type { DaemonMessage, DaemonResponse, DeviceCapabilities } from "@/server/sandbox/types";

interface DeviceConnection {
  ws: ServerWebSocket<WebSocketData>;
  userId: string;
  deviceId: string;
  lastPing: number;
}

interface WebSocketData {
  deviceId: string;
  userId: string;
  authenticated: boolean;
  token?: string;
}

// Active device connections keyed by deviceId
const connections = new Map<string, DeviceConnection>();

// Pending request/response promises keyed by message id
const pendingRequests = new Map<
  string,
  {
    resolve: (response: DaemonResponse) => void;
    reject: (error: Error) => void;
    timeout: ReturnType<typeof setTimeout>;
  }
>();

const HEARTBEAT_INTERVAL_MS = 30_000;
const HEARTBEAT_TIMEOUT_MS = 45_000;
const REQUEST_TIMEOUT_MS = 120_000; // 2 minutes for command execution

/**
 * Send a message to a connected device.
 */
export function sendToDevice(deviceId: string, message: DaemonMessage): boolean {
  const conn = connections.get(deviceId);
  if (!conn) return false;

  try {
    conn.ws.send(JSON.stringify(message));
    return true;
  } catch {
    return false;
  }
}

/**
 * Send a message and wait for the corresponding response.
 */
export function waitForResponse(
  deviceId: string,
  message: DaemonMessage & { id: string },
  timeoutMs = REQUEST_TIMEOUT_MS
): Promise<DaemonResponse> {
  return new Promise((resolve, reject) => {
    const sent = sendToDevice(deviceId, message);
    if (!sent) {
      reject(new Error("Device not connected"));
      return;
    }

    const timeout = setTimeout(() => {
      pendingRequests.delete(message.id);
      reject(new Error("Request timed out"));
    }, timeoutMs);

    pendingRequests.set(message.id, { resolve, reject, timeout });
  });
}

/**
 * Check if a device is currently connected.
 */
export function isDeviceOnline(deviceId: string): boolean {
  return connections.has(deviceId);
}

/**
 * Get the WebSocket for a connected device.
 */
export function getDeviceSocket(deviceId: string): ServerWebSocket<WebSocketData> | undefined {
  return connections.get(deviceId)?.ws;
}

/**
 * Get all connected device IDs for a user.
 */
export function getOnlineDevicesForUser(userId: string): string[] {
  const result: string[] = [];
  for (const [deviceId, conn] of connections) {
    if (conn.userId === userId) {
      result.push(deviceId);
    }
  }
  return result;
}

async function handleAuthentication(
  ws: ServerWebSocket<WebSocketData>,
  token: string
): Promise<boolean> {
  const result = await verifyDeviceToken(token);
  if (!result) {
    ws.send(JSON.stringify({ type: "error", error: "Invalid token" }));
    ws.close(4001, "Invalid token");
    return false;
  }

  ws.data.deviceId = result.deviceId;
  ws.data.userId = result.userId;
  ws.data.authenticated = true;

  connections.set(result.deviceId, {
    ws,
    userId: result.userId,
    deviceId: result.deviceId,
    lastPing: Date.now(),
  });

  // Update device online status
  await db
    .update(device)
    .set({ isOnline: true, lastSeenAt: new Date() })
    .where(eq(device.id, result.deviceId));

  ws.send(JSON.stringify({ type: "authenticated", deviceId: result.deviceId }));
  console.log(`[WS] Device ${result.deviceId} connected (user: ${result.userId})`);
  return true;
}

async function handleDisconnect(ws: ServerWebSocket<WebSocketData>): Promise<void> {
  const { deviceId } = ws.data;
  if (!deviceId) return;

  connections.delete(deviceId);

  // Update device offline status
  try {
    await db
      .update(device)
      .set({ isOnline: false, lastSeenAt: new Date() })
      .where(eq(device.id, deviceId));
  } catch (err) {
    console.error(`[WS] Failed to update device status:`, err);
  }

  console.log(`[WS] Device ${deviceId} disconnected`);
}

function handleMessage(ws: ServerWebSocket<WebSocketData>, raw: string): void {
  let msg: DaemonResponse;
  try {
    msg = JSON.parse(raw);
  } catch {
    ws.send(JSON.stringify({ type: "error", error: "Invalid JSON" }));
    return;
  }

  // Handle pong from daemon
  if (msg.type === "pong") {
    const conn = connections.get(ws.data.deviceId);
    if (conn) conn.lastPing = Date.now();
    return;
  }

  // Route responses to pending requests
  if ("id" in msg && msg.id) {
    const pending = pendingRequests.get(msg.id);
    if (pending) {
      clearTimeout(pending.timeout);
      pendingRequests.delete(msg.id);
      pending.resolve(msg);
      return;
    }
  }
}

// Heartbeat: ping all devices, disconnect stale ones
function startHeartbeat(): void {
  setInterval(async () => {
    const now = Date.now();
    for (const [deviceId, conn] of connections) {
      if (now - conn.lastPing > HEARTBEAT_TIMEOUT_MS) {
        console.log(`[WS] Device ${deviceId} timed out`);
        conn.ws.close(4002, "Heartbeat timeout");
        await handleDisconnect(conn.ws);
      } else {
        try {
          conn.ws.send(JSON.stringify({ type: "ping" }));
        } catch {
          await handleDisconnect(conn.ws);
        }
      }
    }
  }, HEARTBEAT_INTERVAL_MS);
}

/**
 * Start the WebSocket server.
 */
export function startWebSocketServer(port: number = 4097): void {
  Bun.serve<WebSocketData>({
    port,
    fetch(req, server) {
      const url = new URL(req.url);

      // Health check
      if (url.pathname === "/health") {
        return new Response(
          JSON.stringify({
            status: "ok",
            connections: connections.size,
          }),
          { headers: { "Content-Type": "application/json" } }
        );
      }

      // WebSocket upgrade
      if (url.pathname === "/ws") {
        const token = url.searchParams.get("token");
        if (!token) {
          return new Response("Missing token", { status: 401 });
        }

        const upgraded = server.upgrade(req, {
          data: {
            deviceId: "",
            userId: "",
            authenticated: false,
            token,
          },
        });

        if (!upgraded) {
          return new Response("WebSocket upgrade failed", { status: 500 });
        }
        return undefined;
      }

      return new Response("Not Found", { status: 404 });
    },

    websocket: {
      async open(ws) {
        // Authenticate on connect using the token from query params
        const token = ws.data.token;
        if (token) {
          const ok = await handleAuthentication(ws, token);
          if (!ok) return;
        } else {
          ws.close(4001, "No token provided");
        }
      },

      message(ws, message) {
        if (!ws.data.authenticated) {
          ws.send(JSON.stringify({ type: "error", error: "Not authenticated" }));
          return;
        }
        handleMessage(ws, typeof message === "string" ? message : new TextDecoder().decode(message));
      },

      close(ws) {
        handleDisconnect(ws);
      },
    },
  });

  startHeartbeat();
  console.log(`[WS] WebSocket server started on port ${port}`);
}
