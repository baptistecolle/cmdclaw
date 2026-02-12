#!/usr/bin/env bun
/**
 * Bap Daemon CLI
 *
 * Connects your local machine to heybap.com as a compute backend.
 *
 * Usage:
 *   bap-daemon start          Start the daemon
 *   bap-daemon stop           Stop the daemon
 *   bap-daemon status         Show connection status
 *   bap-daemon auth           Re-run authentication
 *   bap-daemon auth --server  Specify a custom server URL
 */

import { platform, arch } from "os";
import { authenticate } from "./auth";
import { loadConfig, clearConfig } from "./config";
import { detectLocalProviders } from "./llm-proxy";
import { logger, setVerbose } from "./logger";
import { WSClient } from "./ws-client";

const DEFAULT_SERVER_URL = "https://heybap.com";

function printHelp(): void {
  console.log(`
  \x1b[1mbap-daemon\x1b[0m - Connect your machine to heybap.com

  \x1b[2mUsage:\x1b[0m
    bap-daemon start [--server URL] [--verbose]   Start the daemon
    bap-daemon stop                                Stop the daemon
    bap-daemon status                              Show connection status
    bap-daemon auth [--server URL]                 Run authentication
    bap-daemon help                                Show this help
`);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const command = args[0] || "start";

  // Parse flags
  const serverIdx = args.indexOf("--server");
  const serverUrl = serverIdx >= 0 ? args[serverIdx + 1] : undefined;
  const isVerbose = args.includes("--verbose") || args.includes("-v");

  setVerbose(isVerbose);

  switch (command) {
    case "start":
      await startDaemon(serverUrl);
      break;

    case "stop":
      console.log("  Use Ctrl+C or kill the daemon process.");
      break;

    case "status":
      await showStatus();
      break;

    case "auth":
      await runAuth(serverUrl);
      break;

    case "help":
    case "--help":
    case "-h":
      printHelp();
      break;

    default:
      console.error(`  Unknown command: ${command}`);
      printHelp();
      process.exit(1);
  }
}

async function startDaemon(serverUrlOverride?: string): Promise<void> {
  console.log("\n  \x1b[1mBap Daemon\x1b[0m\n");

  // Check for existing config
  let config = loadConfig();

  if (!config || !config.token) {
    console.log("  No configuration found. Starting authentication...\n");
    const url = serverUrlOverride || DEFAULT_SERVER_URL;
    config = await authenticate(url);
    if (!config) {
      process.exit(1);
    }
  }

  // Override server URL if provided
  if (serverUrlOverride) {
    config.serverUrl = serverUrlOverride;
  }

  // Detect local LLM providers
  const providers = await detectLocalProviders();
  if (providers.length > 0) {
    console.log(`  Found local LLM providers:`);
    for (const p of providers) {
      console.log(`    - ${p.name}: ${p.models.length} models`);
    }
    console.log();
  }

  // Build capabilities
  const capabilities = {
    sandbox: true,
    llmProxy: providers.length > 0,
    localModels: providers.flatMap((p) => p.models),
    platform: platform(),
    arch: arch(),
  };

  logger.info("daemon", "Starting daemon", { capabilities });

  // Connect WebSocket
  // For the WS URL, we need to determine the WS port.
  // In dev, the WS server runs on a separate port (default 4097).
  // In prod, it might be the same server or a different subdomain.
  let wsServerUrl = config.serverUrl;

  // If connecting to localhost Next.js, use WS port 4097
  const localhostMatch = wsServerUrl.match(/localhost:(\d+)|127\.0\.0\.1:(\d+)/);
  if (localhostMatch) {
    const port = localhostMatch[1] || localhostMatch[2];
    wsServerUrl = wsServerUrl.replace(`:${port}`, ":4097");
  }

  const client = new WSClient(wsServerUrl, config.token, config.deviceId);
  client.connect();

  // Handle shutdown
  const shutdown = () => {
    console.log("\n  Shutting down...");
    client.disconnect();
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  console.log("  Daemon running. Press Ctrl+C to stop.\n");

  // Keep process alive
  await new Promise(() => {});
}

async function showStatus(): Promise<void> {
  const config = loadConfig();

  if (!config || !config.token) {
    console.log("  Not authenticated. Run: bap-daemon auth");
    return;
  }

  console.log(`  Server: ${config.serverUrl}`);
  console.log(`  Device ID: ${config.deviceId}`);

  // Check local providers
  const providers = await detectLocalProviders();
  console.log(
    `  Local LLM providers: ${providers.length > 0 ? providers.map((p) => p.name).join(", ") : "none"}`,
  );
}

async function runAuth(serverUrlOverride?: string): Promise<void> {
  const url = serverUrlOverride || DEFAULT_SERVER_URL;
  clearConfig();
  await authenticate(url);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
