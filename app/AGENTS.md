# App Agent Instructions

## Package manager and scripts
- Use `bun`, not `npm`.
- Use `bun db:push` for migrations, not `db:generate`.
- When editing a Better Auth plugin, run `bun auth:generate` to regenerate the schema.
- Run `bun run check` to validate types and lint.

## Testing workflow
- After implementing a feature, test it with `bun run chat` when possible.
- If `bun run chat` is not sufficient to validate the change, clearly report that limitation. If applicable say how you would change `bun run chat` to support testing this feature
- Don't forget to always typecheck and lint via `bun run check`
- After large codebase change run `bun run test`
- When creating a test always run to check if it correct. Maybe the test uncover a bug so stop if you think this is the case and report to the user

## Commit policy
- Do not commit unless the user explicitly asks.

- do not add uncessary environemtn variable to control behaviour ask user if you want to add variable to be sure it is really needed
