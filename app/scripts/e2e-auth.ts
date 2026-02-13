import { serializeSignedCookie } from "better-call";
import { eq } from "drizzle-orm";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { auth } from "../src/lib/auth";
import { db, closePool } from "../src/server/db/client";
import { session, user } from "../src/server/db/schema";

type StorageCookie = {
  name: string;
  value: string;
  domain: string;
  path: string;
  expires: number;
  httpOnly: boolean;
  secure: boolean;
  sameSite: "Lax" | "None" | "Strict";
};

type StorageState = {
  cookies: StorageCookie[];
  origins: Array<{
    origin: string;
    localStorage: Array<{ name: string; value: string }>;
  }>;
};

function getAuthSecret(): string {
  const secret = process.env.BETTER_AUTH_SECRET;
  if (!secret) {
    throw new Error(
      "BETTER_AUTH_SECRET is required to sign better-auth session cookies for Playwright storage state.",
    );
  }
  return secret;
}

function getBaseUrl(): string {
  const fromEnv = process.env.PLAYWRIGHT_BASE_URL;
  if (fromEnv) {
    return fromEnv;
  }

  const port = process.env.PLAYWRIGHT_PORT ?? "4173";
  return `http://127.0.0.1:${port}`;
}

function getStorageStatePath(): string {
  return process.env.E2E_AUTH_STATE_PATH ?? "playwright/.auth/user.json";
}

async function ensureUser(): Promise<{ id: string; email: string }> {
  const email = process.env.E2E_TEST_EMAIL ?? "baptiste@heybap.com";
  const name = process.env.E2E_TEST_NAME ?? "Playwright E2E";
  const now = new Date();

  const existing = await db.query.user.findFirst({
    where: eq(user.email, email),
  });

  if (existing) {
    await db
      .update(user)
      .set({
        name,
        emailVerified: true,
        onboardedAt: existing.onboardedAt ?? now,
        updatedAt: now,
      })
      .where(eq(user.id, existing.id));

    return { id: existing.id, email };
  }

  const userId = randomUUID();
  await db.insert(user).values({
    id: userId,
    email,
    name,
    emailVerified: true,
    onboardedAt: now,
    role: "user",
    createdAt: now,
    updatedAt: now,
  });

  return { id: userId, email };
}

async function createSession(userId: string): Promise<{ token: string; expiresAt: Date }> {
  const now = new Date();
  const ttlHours = Number(process.env.E2E_SESSION_TTL_HOURS ?? "24");
  const expiresAt = new Date(now.getTime() + ttlHours * 60 * 60 * 1000);
  const token = randomBytes(48).toString("hex");

  await db.insert(session).values({
    id: randomUUID(),
    userId,
    token,
    expiresAt,
    createdAt: now,
    updatedAt: now,
    ipAddress: "127.0.0.1",
    userAgent: "playwright-e2e-auth-bootstrap",
  });

  return { token, expiresAt };
}

async function buildStorageState(
  baseUrl: string,
  token: string,
  expiresAt: Date,
): Promise<StorageState> {
  const url = new URL(baseUrl);
  const secure = url.protocol === "https:";
  const expires = Math.floor(expiresAt.getTime() / 1000);
  const secret = getAuthSecret();
  const signedToken = (await serializeSignedCookie("", token, secret)).replace("=", "");

  const cookies: StorageCookie[] = [
    {
      name: "better-auth.session_token",
      value: signedToken,
      domain: url.hostname,
      path: "/",
      expires,
      httpOnly: true,
      secure,
      sameSite: "Lax",
    },
  ];

  if (secure) {
    cookies.push({
      name: "__Secure-better-auth.session_token",
      value: signedToken,
      domain: url.hostname,
      path: "/",
      expires,
      httpOnly: true,
      secure: true,
      sameSite: "Lax",
    });
  }

  return { cookies, origins: [] };
}

async function verifySessionCookie(signedToken: string): Promise<void> {
  const sessionData = await auth.api.getSession({
    headers: new Headers({
      cookie: `better-auth.session_token=${signedToken}`,
    }),
  });

  if (!sessionData?.session || !sessionData?.user) {
    throw new Error(
      "Generated session cookie could not be resolved by better-auth (getSession returned null).",
    );
  }
}

async function main(): Promise<void> {
  const baseUrl = getBaseUrl();
  const storagePath = getStorageStatePath();

  const { id: userId, email } = await ensureUser();
  const { token, expiresAt } = await createSession(userId);

  const state = await buildStorageState(baseUrl, token, expiresAt);
  const signedToken = state.cookies.find(
    (cookie) => cookie.name === "better-auth.session_token",
  )?.value;

  if (!signedToken) {
    throw new Error("Failed to create signed better-auth.session_token cookie.");
  }

  await verifySessionCookie(signedToken);

  mkdirSync(dirname(storagePath), { recursive: true });
  writeFileSync(storagePath, `${JSON.stringify(state, null, 2)}\n`, "utf8");

  console.log(`[e2e-auth] user=${email}`);
  console.log(`[e2e-auth] baseUrl=${baseUrl}`);
  console.log(`[e2e-auth] storageState=${storagePath}`);
  console.log(`[e2e-auth] expiresAt=${expiresAt.toISOString()}`);
}

main()
  .catch((err) => {
    console.error("[e2e-auth] bootstrap failed:", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closePool();
  });
