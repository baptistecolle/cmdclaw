import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { db } from "@/server/db/client";
import { integration } from "@/server/db/schema";
import { generationManager } from "@/server/services/generation-manager";

type DynamicsInstance = {
  id: string;
  friendlyName: string;
  instanceUrl: string;
  apiUrl: string;
};

type DynamicsMetadata = {
  pendingInstanceSelection?: boolean;
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

  await db
    .update(integration)
    .set({
      enabled: true,
      metadata: {
        ...metadata,
        pendingInstanceSelection: false,
        availableInstances: [],
        instanceUrl: selected.instanceUrl,
        instanceName: selected.friendlyName,
      },
    })
    .where(eq(integration.id, dynamicsIntegration.id));

  if (parsed.data.generationId) {
    try {
      await generationManager.submitAuthResult(
        parsed.data.generationId,
        parsed.data.integration ?? "dynamics",
        true,
        userId,
      );
    } catch (error) {
      console.warn("[Dynamics pending] Failed to auto-submit auth result:", error);
    }
  }

  return Response.json({ success: true });
}
