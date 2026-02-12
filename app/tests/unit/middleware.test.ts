import { describe, expect, test } from "vitest";
import { NextRequest } from "next/server";
import { middleware } from "@/middleware";

describe("middleware", () => {
  test("redirects unauthenticated protected routes to login with callback", () => {
    const request = new NextRequest("http://localhost:3000/chat");
    const response = middleware(request);

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(
      "http://localhost:3000/login?callbackUrl=%2Fchat",
    );
  });

  test("allows protected routes with session cookie", () => {
    const request = new NextRequest("http://localhost:3000/settings", {
      headers: {
        cookie: "better-auth.session_token=session-123",
      },
    });

    const response = middleware(request);
    expect(response.status).toBe(200);
    expect(response.headers.get("location")).toBeNull();
  });

  test("allows public routes without authentication", () => {
    const request = new NextRequest("http://localhost:3000/login");
    const response = middleware(request);

    expect(response.status).toBe(200);
    expect(response.headers.get("location")).toBeNull();
  });

  test("skips auth checks for rpc routes", () => {
    const request = new NextRequest("http://localhost:3000/api/rpc/conversation.list");
    const response = middleware(request);

    expect(response.status).toBe(200);
    expect(response.headers.get("location")).toBeNull();
  });
});
