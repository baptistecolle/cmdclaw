# Sandbox Templates

This folder contains provider-specific sandbox images/snapshots used by Bap.

- `common/` - Shared sandbox assets used by all providers.
- `e2b/` - E2B-specific template definition and build files.
- `daytona/` - Daytona snapshot build files.

Build commands (from `app/`):

```bash
bun run e2b:build:dev
bun run e2b:build:prod
bun run daytona:build:dev
bun run daytona:build:prod
```
