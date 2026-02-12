import { RPCHandler } from "@orpc/server/fetch";
import { appRouter } from "@/server/orpc";
import { createORPCContext } from "@/server/orpc/context";
import { POST as approvalRequestHandler } from "@/app/api/internal/approval-request/route";
import { POST as authRequestHandler } from "@/app/api/internal/auth-request/route";

export const runtime = "nodejs";

const handler = new RPCHandler(appRouter);

// Map old oRPC dot-notation paths used by E2B plugin to plain API handlers
const INTERNAL_HANDLERS: Record<string, (req: Request) => Promise<Response>> = {
  "/api/rpc/internal.approvalRequest": approvalRequestHandler,
  "/api/rpc/internal.authRequest": authRequestHandler,
};

async function handleRequest(request: Request) {
  try {
    // Route legacy plugin paths to plain API handlers
    const url = new URL(request.url);
    const internalHandler = INTERNAL_HANDLERS[url.pathname];
    if (internalHandler) {
      return internalHandler(request);
    }

    const context = await createORPCContext({ headers: request.headers });
    const { response } = await handler.handle(request, {
      prefix: "/api/rpc",
      context,
    });

    return response ?? new Response("Not found", { status: 404 });
  } catch (error) {
    console.error("[RPC Handler Error]", error);
    return new Response(JSON.stringify({ error: String(error) }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}

export {
  handleRequest as HEAD,
  handleRequest as GET,
  handleRequest as POST,
  handleRequest as PUT,
  handleRequest as PATCH,
  handleRequest as DELETE,
};
