import { toNextJsHandler } from "better-auth/next-js";
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";

const trustedOrigins = new Set([
  "https://app.heybap.com",
  "https://heybap.com",
  "https://www.heybap.com",
  "https://localcan.baptistecolle.com",
  `http://localhost:${process.env.PORT ?? 3000}`,
  `http://127.0.0.1:${process.env.PORT ?? 3000}`,
]);

const DEFAULT_ALLOWED_ORIGIN = "https://app.heybap.com";

function getCorsHeaders(origin: string | null) {
  const isAllowed = origin && trustedOrigins.has(origin);
  return {
    "Access-Control-Allow-Origin": isAllowed ? origin : DEFAULT_ALLOWED_ORIGIN,
    "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Allow-Credentials": "true",
  };
}

const {
  GET: getHandler,
  POST: postHandler,
  PUT: putHandler,
  PATCH: patchHandler,
  DELETE: deleteHandler,
} = toNextJsHandler(auth);

async function withCors(request: NextRequest, handler: (req: NextRequest) => Promise<Response>) {
  const origin = request.headers.get("origin");
  const response = await handler(request);
  const corsHeaders = getCorsHeaders(origin);

  const newResponse = new NextResponse(response.body, response);

  // Preserve Set-Cookie headers from the original response.
  // new NextResponse(body, init) can drop multi-value Set-Cookie headers,
  // so we re-apply them explicitly.
  const setCookies = response.headers.getSetCookie();
  if (setCookies.length > 0) {
    // Clear any partially-copied cookies first
    // eslint-disable-next-line drizzle/enforce-delete-with-where -- Headers.delete, not a Drizzle query
    newResponse.headers.delete("set-cookie");
    for (const cookie of setCookies) {
      newResponse.headers.append("set-cookie", cookie);
    }
  }

  Object.entries(corsHeaders).forEach(([key, value]) => {
    newResponse.headers.set(key, value);
  });

  return newResponse;
}

export async function OPTIONS(request: NextRequest) {
  const origin = request.headers.get("origin");
  return new NextResponse(null, {
    status: 204,
    headers: getCorsHeaders(origin),
  });
}

export async function GET(request: NextRequest) {
  return withCors(request, getHandler);
}

export async function POST(request: NextRequest) {
  return withCors(request, postHandler);
}

export async function PUT(request: NextRequest) {
  return withCors(request, putHandler);
}

export async function PATCH(request: NextRequest) {
  return withCors(request, patchHandler);
}

export async function DELETE(request: NextRequest) {
  return withCors(request, deleteHandler);
}
