/**
 * Dev startup script for the BYOC WebSocket server.
 * Run with: bun scripts/start-ws.ts
 */

import * as dotenvConfig from "dotenv/config";
import { startWebSocketServer } from "@/server/ws/server";

void dotenvConfig;

const port = parseInt(process.env.WS_PORT || "4097", 10);
startWebSocketServer(port);
