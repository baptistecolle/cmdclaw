import type { RouterClient } from "@orpc/server";
import { createORPCClient } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";
import { authClient } from "@/lib/auth-client";
import type { AppRouter } from "@/server/orpc";

function getBaseUrl() {
  if (typeof window !== "undefined") {
    return window.location.origin;
  }
  return `http://localhost:${process.env.PORT ?? 3000}`;
}

let loginRedirectInFlight = false;

type SessionCheckResult = "session_present" | "session_missing" | "check_failed";

function getRequestUrl(input: RequestInfo | URL): string {
  if (typeof input === "string") {
    return input;
  }

  if (input instanceof URL) {
    return input.toString();
  }

  if (input instanceof Request) {
    return input.url;
  }

  return "unknown";
}

async function checkSessionAfterUnauthorized(): Promise<SessionCheckResult> {
  try {
    const sessionResult = await authClient.getSession();
    if (sessionResult?.data?.session && sessionResult?.data?.user) {
      return "session_present";
    }
    return "session_missing";
  } catch (error) {
    console.error("[Auth Debug] Failed to confirm session after oRPC 401", error);
    return "check_failed";
  }
}

// Custom fetch that handles 401 errors by redirecting to login
async function fetchWithAuthRedirect(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> {
  const response = await fetch(input, init);

  if (response.status === 401 && typeof window !== "undefined") {
    const sessionCheck = await checkSessionAfterUnauthorized();
    const requestUrl = getRequestUrl(input);

    console.warn("[Auth Debug] oRPC request returned 401", {
      method: init?.method ?? "GET",
      requestUrl,
      currentPath: window.location.pathname + window.location.search,
      sessionCheck,
    });

    if (sessionCheck === "session_missing" && !loginRedirectInFlight) {
      loginRedirectInFlight = true;
      const callbackUrl = encodeURIComponent(window.location.pathname + window.location.search);
      window.location.href = `/login?callbackUrl=${callbackUrl}`;
      return new Promise(() => {});
    }
  }

  return response;
}

const link = new RPCLink({
  url: `${getBaseUrl()}/api/rpc`,
  headers: () => ({}),
  fetch: fetchWithAuthRedirect,
});

export const client: RouterClient<AppRouter> = createORPCClient(link);
