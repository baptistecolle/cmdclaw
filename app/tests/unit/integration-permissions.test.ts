import { afterEach, describe, expect, it, vi } from "vitest";
import { getCallbackBaseUrls } from "@/sandbox-templates/common/plugins/integration-permissions";

describe("getCallbackBaseUrls", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("prefers public non-vercel URLs and excludes localcan in production", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("APP_URL", "http://localhost:3000");
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://app.cmdclaw.ai");

    expect(getCallbackBaseUrls()).toEqual(["https://app.cmdclaw.ai"]);
  });

  it("uses localcan fallback only in non-production localhost setups", () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("APP_URL", "http://localhost:3000");
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "");
    vi.stubEnv("E2B_CALLBACK_BASE_URL", "");

    expect(getCallbackBaseUrls()).toEqual([
      "http://localhost:3000",
      "https://localcan.baptistecolle.com",
    ]);
  });
});
