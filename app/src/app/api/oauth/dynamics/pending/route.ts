import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { db } from "@/server/db/client";
import { integration } from "@/server/db/schema";
import { getOAuthConfig } from "@/server/oauth/config";

type DynamicsInstance = {
  id: string;
  friendlyName: string;
  instanceUrl: string;
  apiUrl: string;
};

type DynamicsMetadata = {
  pendingInstanceSelection?: boolean;
  pendingInstanceReauth?: boolean;
  availableInstances?: DynamicsInstance[];
  instanceUrl?: string;
  instanceName?: string;
  [key: string]: unknown;
};

const completeSchema = z.object({
  instanceUrl: z.string().url(),
  generationId: z.string().optional(),
  integration: z.string().optional(),
});

async function getAuthedUserId(headers: Headers): Promise<string | null> {
  const sessionData = await auth.api.getSession({ headers });
  return sessionData?.user?.id ?? null;
}

async function findPendingIntegration(userId: string) {
  return db.query.integration.findFirst({
    where: and(eq(integration.userId, userId), eq(integration.type, "dynamics")),
  });
}

function buildInstanceScope(instanceUrl: string): string {
  return `${instanceUrl.replace(/\/+$/, "")}/user_impersonation`;
}

function getRedirectBaseUrl(request: Request): string {
  return process.env.APP_URL ?? process.env.NEXT_PUBLIC_APP_URL ?? new URL(request.url).origin;
}

export async function GET(request: Request) {
  const userId = await getAuthedUserId(request.headers);
  if (!userId) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  const dynamicsIntegration = await findPendingIntegration(userId);
  if (!dynamicsIntegration?.metadata) {
    return Response.json({ error: "not_found" }, { status: 404 });
  }

  const metadata = dynamicsIntegration.metadata as DynamicsMetadata;
  const instances = Array.isArray(metadata.availableInstances) ? metadata.availableInstances : [];

  if (!metadata.pendingInstanceSelection || instances.length === 0) {
    return Response.json({ error: "no_pending_selection" }, { status: 404 });
  }

  return Response.json({
    instances,
    displayName: dynamicsIntegration.displayName,
  });
}

export async function POST(request: Request) {
  const userId = await getAuthedUserId(request.headers);
  if (!userId) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  const parsed = completeSchema.safeParse(await request.json());
  if (!parsed.success) {
    return Response.json({ error: "invalid_payload" }, { status: 400 });
  }

  const dynamicsIntegration = await findPendingIntegration(userId);
  if (!dynamicsIntegration?.metadata) {
    return Response.json({ error: "not_found" }, { status: 404 });
  }

  const metadata = dynamicsIntegration.metadata as DynamicsMetadata;
  const instances = Array.isArray(metadata.availableInstances) ? metadata.availableInstances : [];

  if (!metadata.pendingInstanceSelection || instances.length === 0) {
    return Response.json({ error: "no_pending_selection" }, { status: 404 });
  }

  const selected = instances.find((instance) => instance.instanceUrl === parsed.data.instanceUrl);
  if (!selected) {
    return Response.json({ error: "invalid_instance" }, { status: 400 });
  }

  const config = getOAuthConfig("dynamics");
  const redirectUrl = new URL("/integrations", getRedirectBaseUrl(request));
  if (parsed.data.generationId) {
    redirectUrl.searchParams.set("generation_id", parsed.data.generationId);
  }
  if (parsed.data.integration) {
    redirectUrl.searchParams.set("auth_complete", parsed.data.integration);
  }

  const state = Buffer.from(
    JSON.stringify({
      userId,
      type: "dynamics",
      redirectUrl: redirectUrl.toString(),
      dynamicsInstanceUrl: selected.instanceUrl,
      dynamicsInstanceName: selected.friendlyName,
    }),
  ).toString("base64url");
  const authParams = new URLSearchParams({
    client_id: config.clientId,
    response_type: "code",
    redirect_uri: config.redirectUri,
    response_mode: "query",
    scope: [
      "offline_access",
      "openid",
      "profile",
      "email",
      buildInstanceScope(selected.instanceUrl),
    ].join(" "),
    state,
  });

  await db
    .update(integration)
    .set({
      enabled: false,
      metadata: {
        ...metadata,
        pendingInstanceSelection: false,
        pendingInstanceReauth: true,
        availableInstances: [],
        instanceUrl: selected.instanceUrl,
        instanceName: selected.friendlyName,
      },
    })
    .where(eq(integration.id, dynamicsIntegration.id));

  return Response.json({
    requiresReauth: true,
    authUrl: `${config.authUrl}?${authParams.toString()}`,
  });
}
