import { RPCHandler } from "@orpc/server/fetch";
import { appRouter } from "@/server/orpc";
import { createORPCContext } from "@/server/orpc/context";

export const runtime = "nodejs";

const handler = new RPCHandler(appRouter);

async function handleRequest(request: Request) {
  const context = await createORPCContext({ headers: request.headers });
  const result = await handler.handle(request, { context });

  if (!result.matched) {
    return new Response("Not found", { status: 404 });
  }

  return result.response;
}

export { handleRequest as GET, handleRequest as POST };
