import { RPCHandler } from "@orpc/server/fetch";
import { createHash } from "node:crypto";
import { POST as approvalRequestHandler } from "@/app/api/internal/approval-request/route";
import { POST as authRequestHandler } from "@/app/api/internal/auth-request/route";
import { appRouter } from "@/server/orpc";
import { createORPCContext } from "@/server/orpc/context";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const handler = new RPCHandler(appRouter);

// Map old oRPC dot-notation paths used by E2B plugin to plain API handlers
const INTERNAL_HANDLERS: Record<string, (req: Request) => Promise<Response>> = {
  "/api/rpc/internal.approvalRequest": approvalRequestHandler,
  "/api/rpc/internal.authRequest": authRequestHandler,
};

function getCookieValue(cookieHeader: string, cookieName: string): string | null {
  const match = cookieHeader
    .split(";")
    .map((chunk) => chunk.trim())
    .find((chunk) => chunk.startsWith(`${cookieName}=`));

  if (!match) {
    return null;
  }

  return match.slice(cookieName.length + 1);
}

function logUnauthorizedRpcRequest(request: Request, response: Response): void {
  if (response.status !== 401) {
    return;
  }

  const cookieHeader = request.headers.get("cookie") ?? "";
  const secureSessionToken = getCookieValue(cookieHeader, "__Secure-better-auth.session_token");
  const regularSessionToken = getCookieValue(cookieHeader, "better-auth.session_token");
  const sessionToken = secureSessionToken ?? regularSessionToken;

  console.warn("[Auth Debug] RPC request returned 401", {
    path: new URL(request.url).pathname,
    method: request.method,
    hasSessionCookie: Boolean(sessionToken),
    sessionCookieName: secureSessionToken
      ? "__Secure-better-auth.session_token"
      : regularSessionToken
        ? "better-auth.session_token"
        : null,
    sessionCookieFingerprint: sessionToken
      ? createHash("sha256").update(sessionToken).digest("hex").slice(0, 12)
      : null,
    userAgent: request.headers.get("user-agent"),
    referer: request.headers.get("referer"),
  });
}

function withNoStore(response: Response): Response {
  const nextHeaders = new Headers(response.headers);
  nextHeaders.set("Cache-Control", "no-store, no-cache, must-revalidate, private");
  nextHeaders.set("Pragma", "no-cache");
  nextHeaders.set("Expires", "0");
  nextHeaders.append("Vary", "Cookie");
  nextHeaders.append("Vary", "Authorization");
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: nextHeaders,
  });
}

async function handleRequest(request: Request) {
  try {
    let response: Response | null = null;

    // Route legacy plugin paths to plain API handlers
    const url = new URL(request.url);
    const internalHandler = INTERNAL_HANDLERS[url.pathname];
    if (internalHandler) {
      response = await internalHandler(request);
      logUnauthorizedRpcRequest(request, response);
      return withNoStore(response);
    }

    const context = await createORPCContext({ headers: request.headers });
    const handlerResult = await handler.handle(request, {
      prefix: "/api/rpc",
      context,
    });

    response = handlerResult.response ?? new Response("Not found", { status: 404 });
    logUnauthorizedRpcRequest(request, response);
    return withNoStore(response);
  } catch (error) {
    console.error("[RPC Handler Error]", error);
    return withNoStore(
      new Response(JSON.stringify({ error: String(error) }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      }),
    );
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
