## CmdClaw App

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
bun run test:e2e:live:slack  # Playwright live Slack bridge e2e (opt-in)
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
- `E2E_TEST_EMAIL` (default: `baptiste@cmdclaw.com`)
- `E2E_TEST_NAME` (default: `Playwright E2E`)
- `E2E_SESSION_TTL_HOURS` (default: `24`)
- `E2E_CHAT_MODEL` (model id, default: `kimi-k2.5-free`, e.g. `claude-sonnet-4-6`)
- `E2E_CHAT_PROMPT` (default: `hi`)
- `E2E_RESPONSE_TIMEOUT_MS` (default: `90000`)

If your environment hits file watcher limits (`EMFILE`), start the app separately and skip Playwright-managed `webServer`:

```bash
PLAYWRIGHT_BASE_URL=http://127.0.0.1:4173 PLAYWRIGHT_SKIP_WEBSERVER=1 E2E_LIVE=1 bun run test:e2e:live
```

### Live Slack Bridge E2E

This test verifies the Slack provider flow end-to-end:

- seeds a real Slack root message in your test channel
- triggers `/api/slack/events` with a valid Slack signature
- waits for the AI-generated Slack thread reply

Run:

```bash
E2E_LIVE=1 E2E_SLACK_CHANNEL_ID=<channel-id> bun run test:e2e:live:slack
```

Required environment variables:

- `SLACK_BOT_TOKEN`
- `SLACK_SIGNING_SECRET`
- `E2E_SLACK_CHANNEL_ID`

Optional environment variables:

- `E2E_SLACK_CHAT_MODEL` (defaults to `E2E_CHAT_MODEL` or live model resolver)
- `E2E_SLACK_RESPONSE_TIMEOUT_MS` (default: `120000`)
- `E2E_SLACK_POLL_INTERVAL_MS` (default: `2500`)
