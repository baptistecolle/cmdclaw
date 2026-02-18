import { beforeAll, describe, expect, test } from "vitest";
import { defaultServerUrl, ensureCliAuth, liveEnabled } from "./live-fixtures";

describe.runIf(liveEnabled)("@live CLI auth", () => {
  beforeAll(async () => {
    await ensureCliAuth();
  });

  test("auth smoke: unauth /chat redirects to /login callback and public routes stay reachable", async () => {
    const chatResponse = await fetch(`${defaultServerUrl}/chat`, { redirect: "manual" });
    expect(chatResponse.status).toBeGreaterThanOrEqual(300);
    expect(chatResponse.status).toBeLessThan(400);
    expect(chatResponse.headers.get("location") ?? "").toContain("/login?callbackUrl=%2Fchat");

    const loginResponse = await fetch(`${defaultServerUrl}/login?callbackUrl=%2Fchat`);
    expect(loginResponse.ok).toBeTruthy();
    const loginHtml = await loginResponse.text();
    expect(loginHtml).toContain("Log in");

    const termsResponse = await fetch(`${defaultServerUrl}/legal/terms`);
    expect(termsResponse.ok).toBeTruthy();

    const supportResponse = await fetch(`${defaultServerUrl}/support`);
    expect(supportResponse.ok).toBeTruthy();

    const rpcResponse = await fetch(`${defaultServerUrl}/api/rpc`, { redirect: "manual" });
    expect([301, 302, 303, 307, 308]).not.toContain(rpcResponse.status);
  });
});
