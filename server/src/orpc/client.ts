import type { RouterClient } from "@orpc/server";
import { createORPCClient } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";
import type { AppRouter } from "@/server/orpc";

function getBaseUrl() {
  if (typeof window !== "undefined") {
    return window.location.origin;
  }
  return "http://localhost:3000";
}

const link = new RPCLink({
  url: `${getBaseUrl()}/api/rpc`,
  headers: () => ({}),
});

export const client: RouterClient<AppRouter> = createORPCClient(link);
