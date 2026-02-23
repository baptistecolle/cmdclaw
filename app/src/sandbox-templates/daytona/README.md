# Daytona Snapshot Builder

This folder contains Daytona snapshot builders for Bap sandbox runtimes.

## Prerequisites

- `DAYTONA_API_KEY`
- Optional: `DAYTONA_SERVER_URL` and `DAYTONA_TARGET`

## Build snapshots

```bash
bun src/sandbox-templates/daytona/build.dev.ts
bun src/sandbox-templates/daytona/build.prod.ts
```

Defaults:

- dev snapshot: `bap-agent-dev`
- prod snapshot: `bap-agent-prod`

Override names with:

- `DAYTONA_SNAPSHOT_DEV`
- `DAYTONA_SNAPSHOT_PROD`

## Runtime selection

When `DAYTONA_API_KEY` is set and `E2B_API_KEY` is not set, Bap can select Daytona as the sandbox backend for direct mode generations.
