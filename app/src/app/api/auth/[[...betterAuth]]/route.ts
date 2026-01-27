import { toNextJsHandler } from "better-auth/next-js";
import { NextRequest, NextResponse } from "next/server";

import { auth } from "@/lib/auth";

const trustedOrigins = [
  "https://localcan.baptistecolle.com",
  "https://heybap.com",
  "https://app.heybap.com",
  "https://www.heybap.com",
  "http://localhost:3000",
];

function getCorsHeaders(origin: string | null) {
  const isAllowed = origin && trustedOrigins.includes(origin);
  return {
    "Access-Control-Allow-Origin": isAllowed ? origin : trustedOrigins[0],
    "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Allow-Credentials": "true",
  };
}

const { GET: getHandler, POST: postHandler, PUT: putHandler, PATCH: patchHandler, DELETE: deleteHandler } = toNextJsHandler(auth);

async function withCors(request: NextRequest, handler: (req: NextRequest) => Promise<Response>) {
  const origin = request.headers.get("origin");
  const response = await handler(request);
  const corsHeaders = getCorsHeaders(origin);

  const newResponse = new NextResponse(response.body, response);
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
