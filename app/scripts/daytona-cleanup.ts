#!/usr/bin/env bun
import { Daytona } from "@daytonaio/sdk";
import * as dotenvConfig from "dotenv/config";

void dotenvConfig;

const KEEP_SNAPSHOT =
  process.env.DAYTONA_KEEP_SNAPSHOT || process.env.DAYTONA_SNAPSHOT_DEV || "cmdclaw-agent-dev";
const PAGE_SIZE = 100;
const TARGET_PREFIX = process.env.DAYTONA_CLEANUP_PREFIX || KEEP_SNAPSHOT;

function getDaytonaConfig(): {
  apiKey?: string;
  jwtToken?: string;
  organizationId?: string;
  apiUrl?: string;
  target?: string;
} {
  const apiKey = process.env.DAYTONA_API_KEY;
  const jwtToken = process.env.DAYTONA_JWT_TOKEN;
  const organizationId = process.env.DAYTONA_ORGANIZATION_ID;
  const apiUrl = process.env.DAYTONA_API_URL ?? process.env.DAYTONA_SERVER_URL;
  const target = process.env.DAYTONA_TARGET;

  if (!apiKey && !(jwtToken && organizationId)) {
    throw new Error(
      "Missing Daytona auth. Set DAYTONA_API_KEY, or set both DAYTONA_JWT_TOKEN and DAYTONA_ORGANIZATION_ID.",
    );
  }

  return {
    ...(apiKey ? { apiKey } : {}),
    ...(jwtToken ? { jwtToken } : {}),
    ...(organizationId ? { organizationId } : {}),
    ...(apiUrl ? { apiUrl } : {}),
    ...(target ? { target } : {}),
  };
}

async function collectSandboxes(
  daytona: Daytona,
  page = 1,
): Promise<Awaited<ReturnType<Daytona["list"]>>["items"]> {
  const result = await daytona.list(undefined, page, PAGE_SIZE);
  if (!result.totalPages || page >= result.totalPages) {
    return result.items ?? [];
  }
  const next = await collectSandboxes(daytona, page + 1);
  return [...(result.items ?? []), ...next];
}

async function collectSnapshots(
  daytona: Daytona,
  page = 1,
): Promise<Awaited<ReturnType<Daytona["snapshot"]["list"]>>["items"]> {
  const result = await daytona.snapshot.list(page, PAGE_SIZE);
  if (!result.totalPages || page >= result.totalPages) {
    return result.items ?? [];
  }
  const next = await collectSnapshots(daytona, page + 1);
  return [...(result.items ?? []), ...next];
}

async function main() {
  const daytona = new Daytona(getDaytonaConfig());

  console.log("Listing Daytona sandboxes...");
  const sandboxes = await collectSandboxes(daytona);
  const sandboxesToDelete = sandboxes.filter((sandbox) => sandbox.name.startsWith(TARGET_PREFIX));
  console.log(
    `Found ${sandboxes.length} sandbox(es). Deleting ${sandboxesToDelete.length} with prefix "${TARGET_PREFIX}".`,
  );

  if (sandboxesToDelete.length > 0) {
    console.log("Deleting sandboxes...");
    const sandboxResults = await Promise.allSettled(
      sandboxesToDelete.map(async (sandbox) => {
        const full = await daytona.get(sandbox.id);
        await full.delete();
      }),
    );
    const sandboxDeleted = sandboxResults.filter((r) => r.status === "fulfilled").length;
    const sandboxFailed = sandboxResults.length - sandboxDeleted;
    console.log(`✓ Deleted ${sandboxDeleted} sandbox(es).`);
    if (sandboxFailed > 0) {
      console.warn(`[warn] Failed to delete ${sandboxFailed} sandbox(es).`);
    }
  }

  console.log("Listing Daytona snapshots...");
  const snapshots = await collectSnapshots(daytona);
  const snapshotsToDelete = snapshots.filter(
    (snapshot) => snapshot.name.startsWith(TARGET_PREFIX) && snapshot.name !== KEEP_SNAPSHOT,
  );
  console.log(
    `Found ${snapshots.length} snapshot(s). Keeping "${KEEP_SNAPSHOT}", deleting ${snapshotsToDelete.length} with prefix "${TARGET_PREFIX}".`,
  );

  if (snapshotsToDelete.length > 0) {
    const snapshotResults = await Promise.allSettled(
      snapshotsToDelete.map(async (snapshot) => {
        await daytona.snapshot.delete(snapshot);
      }),
    );
    const snapshotDeleted = snapshotResults.filter((r) => r.status === "fulfilled").length;
    const snapshotFailed = snapshotResults.length - snapshotDeleted;
    console.log(`✓ Deleted ${snapshotDeleted} snapshot(s).`);
    if (snapshotFailed > 0) {
      console.warn(`[warn] Failed to delete ${snapshotFailed} snapshot(s).`);
    }
  }

  console.log("Cleanup complete.");
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
