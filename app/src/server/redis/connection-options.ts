import type { RedisOptions } from "ioredis";

const DEFAULT_REDIS_PORT = 6379;

type StableRedisOptions = Pick<RedisOptions, "maxRetriesPerRequest" | "enableReadyCheck">;

export function buildRedisOptions(redisUrl: string, baseOptions: StableRedisOptions): RedisOptions {
  const parsed = parseRedisUrl(redisUrl);
  const protocol = parsed.protocol.toLowerCase();

  if (protocol !== "redis:" && protocol !== "rediss:") {
    throw new Error(`Unsupported Redis protocol "${parsed.protocol}" in REDIS_URL`);
  }

  const dbPath = parsed.pathname.replace(/^\/+/, "");
  const parsedDb = dbPath.length > 0 ? Number.parseInt(dbPath, 10) : undefined;
  const db = Number.isFinite(parsedDb) ? parsedDb : undefined;

  return {
    host: parsed.hostname,
    port: parsed.port ? Number.parseInt(parsed.port, 10) : DEFAULT_REDIS_PORT,
    username: parsed.username ? decodeURIComponent(parsed.username) : undefined,
    password: parsed.password ? decodeURIComponent(parsed.password) : undefined,
    ...(db !== undefined ? { db } : {}),
    ...(protocol === "rediss:" ? { tls: {} } : {}),
    ...baseOptions,
  };
}

function parseRedisUrl(rawRedisUrl: string): URL {
  try {
    return new URL(rawRedisUrl);
  } catch {
    return new URL(`redis://${rawRedisUrl}`);
  }
}
