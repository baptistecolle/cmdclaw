# App Agent Instructions

## Package manager and scripts
- Use `bun`, not `npm`.
- Use `bun db:push` for migrations, not `db:generate`.
- When editing a Better Auth plugin, run `bun auth:generate` to regenerate the schema.
- Run `bun run check` to validate types and lint.

## Testing workflow
- After implementing a feature, test it with `bun run chat` when possible.
- If `bun run chat` is not sufficient to validate the change, clearly report that limitation.

## Commit policy
- Do not commit unless the user explicitly asks.

## Chat CLI auth
If `bun run chat` shows `You must be logged in`, the saved token has expired.

1. Check whether a valid token exists in `chat-config.json`.
2. If the token is missing or expired, ask the user to run `bun run chat --auth` in their terminal and approve the device code in the browser. The token is saved to `chat-config.json`.
3. If the user provides a token directly, use `bun run chat --token <token>`.
