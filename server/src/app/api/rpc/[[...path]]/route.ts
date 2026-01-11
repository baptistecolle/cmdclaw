import { RPCHandler } from "@orpc/server/fetch";
import { appRouter } from "@/server/orpc";
import { createORPCContext } from "@/server/orpc/context";

export const runtime = "nodejs";

const handler = new RPCHandler(appRouter);

async function handleRequest(request: Request) {
  try {
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
      headers: { "Content-Type": "application/json" }
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
