use bun and not npm

use bun db:push for migration and not db:generate

when editing plugin of better-auth, use bun auth:generate to generate the schema again

only commit when i ask you to do so

you can do bun run typecheck     to check type

after implementing a feature, ideally test it through bun run chat
if bun run chat is not good enough to test the feature, report that clearly so the user knows

## Chat CLI auth

If `bun run chat` says "You must be logged in", the saved token has expired. To re-authenticate:

1. Check if a valid token exists: `cat ~/.bap/chat-config.json`
2. If token is expired/missing, ask the user to run `bun run chat --auth` in their terminal and approve the device code in the browser. The token is saved to `~/.bap/chat-config.json`.
3. Alternatively, if the user provides a token, use: `bun run chat --token <token>`
