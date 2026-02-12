## Bap App

### Development

```bash
bun install
bun run dev
```

### Testing

```bash
bun run test               # all Vitest unit tests
bun run test:unit          # unit test suite only
bun run test:unit:watch    # unit tests in watch mode
bun run test:e2e           # Playwright e2e smoke tests
bun run test:e2e:live      # Playwright real-LLM tests (@live tag, opt-in)
bun run test:coverage      # generate coverage report for unit tests
bun run test:coverage:check  # enforce 60% coverage threshold
bun run test:all           # run unit + e2e sequentially
```

### Live Chat E2E (Real LLM)

The live suite is opt-in and now auto-generates an authenticated Playwright storage state from a test DB session.

Run the live suite:

```bash
E2E_LIVE=1 bun run test:e2e:live
```

Optional environment variables:

- `E2E_AUTH_STATE_PATH` (default: `playwright/.auth/user.json`)
- `E2E_TEST_EMAIL` (default: `e2e-playwright@heybap.local`)
- `E2E_TEST_NAME` (default: `Playwright E2E`)
- `E2E_SESSION_TTL_HOURS` (default: `24`)
- `E2E_CHAT_MODEL` (model id, e.g. `claude-sonnet-4-20250514`)
- `E2E_CHAT_PROMPT` (default: `hi`)
- `E2E_RESPONSE_TIMEOUT_MS` (default: `90000`)

If your environment hits file watcher limits (`EMFILE`), start the app separately and skip Playwright-managed `webServer`:

```bash
PLAYWRIGHT_BASE_URL=http://127.0.0.1:4173 PLAYWRIGHT_SKIP_WEBSERVER=1 E2E_LIVE=1 bun run test:e2e:live
```
