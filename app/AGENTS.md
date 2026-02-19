# App Agent Instructions

## Package manager and scripts
-  Use `bun`, not `npm`.
-  Use `bun db:push` for migrations, not `db:generate`.
-  When editing a Better Auth plugin, run `bun auth:generate` to regenerate the schema.
-  Run `bun run check` to validate types and lint.

## Testing workflow
-  After implementing a feature, test it with `bun run chat` when possible.
-  If `bun run chat` is not sufficient to validate the change, clearly report that limitation. If applicable, say how you would change `bun run chat` to support testing this feature.
-  Don't forget to always typecheck and lint via `bun run check`.
-  After a large codebase change, run `bun run test`.
-  When creating a test, always run it to check if it is correct. Maybe the test uncovers a bug, so stop if you think this is the case and report it to the user.
-  Keep runtime behavior compatible with Vercel serverless: do not rely on in-memory state for correctness (execution, approvals, auth, routing, locks, or dedupe). Use durable storage/queue/locks (DB/Redis/BullMQ) as the source of truth.
-  `bun run dev` behavior should stay functionally compatible with Vercel serverless architecture (no hidden in-memory-only correctness path in dev).

-  My infra is BullMQ queues on Railway and Next.js on Vercel, so serverless.

## Tmux
Both the worker and the server are always on in tmux; you can use tmux to look at the logs. They are hot reloaded, so no need to restart them; they will pick the latest changes.

## Pitfalls
-  Do not add unnecessary environment variables to control behavior; ask the user if you want to add a variable to be sure it is really needed.

## Database
Use `bun run db:push` when you edit schema.ts for my app to use the latest schema changes

## Bun
always use bun not npm or pnpm