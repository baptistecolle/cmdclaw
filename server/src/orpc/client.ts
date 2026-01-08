import { createORPCClient } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";

const link = new RPCLink({
  url:
    typeof window !== "undefined" ? "/api/rpc" : "http://localhost:3000/api/rpc",
  headers: () => {
    // Include cookies for authentication
    return {};
  },
});

// Use any type to avoid complex oRPC type inference issues
// Runtime typing still works correctly
export const client: any = createORPCClient(link);
