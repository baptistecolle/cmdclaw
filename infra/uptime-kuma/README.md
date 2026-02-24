# Uptime Kuma + Playwright Monitoring

This setup runs Uptime Kuma plus a Playwright monitor runner container. The runner executes your `@live` checks every 15 minutes and reports pass/fail plus execution time to Kuma.

## 1) Configure env

```bash
cd infra/uptime-kuma
cp .env.example .env
```

Edit `.env`:
- set `KUMA_PUSH_URL` with your push monitor URL,
- include all app/test env needed by your `@live` Playwright tests.

Only this `infra/uptime-kuma/.env` file is loaded by the runner.

## 2) Start stack

```bash
docker compose up -d --build
```

Open Kuma at `http://<your-vps-ip>:3001` and create your admin account.

## 3) Create monitors in Kuma

Create at least:
- HTTP monitor for your app health endpoint (`/health` or similar).
- Push monitor for Playwright checks (name it `playwright-live`).

Copy its push URL to `infra/uptime-kuma/.env` as `KUMA_PUSH_URL`.

## 4) Behavior

`playwright-monitor` container:
- runs `bun run monitor:playwright:kuma`
- waits `MONITOR_INTERVAL_SECONDS` (default `900`)
- repeats forever
- pushes status to Kuma each run

No host cron needed.

## 5) Lifecycle Commands

Start (first run or after config changes):
```bash
docker compose up -d --build
```

Stop:
```bash
docker compose down
```

Rebuild and restart after code or Dockerfile changes:
```bash
docker compose down && docker compose up -d --build
```

## Notes

- `test:e2e:live` currently includes auth bootstrap (`test:e2e:auth`) before tests.
- `test:e2e:live:prod` targets `https://app.cmdclaw.com` and skips local web server startup/build.
- `test:e2e:live:prod:monitor` also writes:
  - `test-results/monitor/results.json`
  - `playwright-report/monitor/index.html`
- If auth bootstrap is too slow, set `MONITOR_COMMAND` to a narrower smoke command.
