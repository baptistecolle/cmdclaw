#!/usr/bin/env bash
set -euo pipefail

if [[ ! -f package.json ]]; then
  echo "[playwright-monitor] package.json not found in $(pwd)" >&2
  exit 1
fi

echo "[playwright-monitor] installing dependencies"
bun install --frozen-lockfile

interval="${MONITOR_INTERVAL_SECONDS:-900}"
if ! [[ "$interval" =~ ^[0-9]+$ ]] || [[ "$interval" -lt 60 ]]; then
  echo "[playwright-monitor] invalid MONITOR_INTERVAL_SECONDS=$interval (must be integer >= 60)" >&2
  exit 1
fi

echo "[playwright-monitor] starting loop (interval=${interval}s)"
while true; do
  echo "[playwright-monitor] run started at $(date -u +"%Y-%m-%dT%H:%M:%SZ")"
  if bun run monitor:playwright:kuma; then
    echo "[playwright-monitor] run completed"
  else
    echo "[playwright-monitor] run failed (will retry on next interval)" >&2
  fi

  sleep "$interval"
done
