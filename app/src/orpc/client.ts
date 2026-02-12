import type { RouterClient } from "@orpc/server";
import { createORPCClient } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";
import type { AppRouter } from "@/server/orpc";

function getBaseUrl() {
  if (typeof window !== "undefined") {
    return window.location.origin;
  }
  return `http://localhost:${process.env.PORT ?? 3000}`;
}

// Custom fetch that handles 401 errors by redirecting to login
async function fetchWithAuthRedirect(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> {
  const response = await fetch(input, init);

  if (response.status === 401 && typeof window !== "undefined") {
    // Redirect to login with current path as callback
    const callbackUrl = encodeURIComponent(window.location.pathname + window.location.search);
    window.location.href = `/login?callbackUrl=${callbackUrl}`;
    // Return a never-resolving promise to prevent further processing
    return new Promise(() => {});
  }

  return response;
}

const link = new RPCLink({
  url: `${getBaseUrl()}/api/rpc`,
  headers: () => ({}),
  fetch: fetchWithAuthRedirect,
});

export const client: RouterClient<AppRouter> = createORPCClient(link);
