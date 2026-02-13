import { z } from "zod";
import { eq } from "drizzle-orm";
import { env } from "@/env";
import { db } from "@/server/db/client";
import { conversation } from "@/server/db/schema";
import { getTokensForIntegrations } from "@/server/integrations/cli-env";
import { generationManager } from "@/server/services/generation-manager";

export const runtime = "nodejs";

const authRequestSchema = z.object({
  conversationId: z.string().min(1),
  integration: z.enum([
    "gmail",
    "google_calendar",
    "google_docs",
    "google_sheets",
    "google_drive",
    "notion",
    "linear",
    "github",
    "airtable",
    "slack",
    "hubspot",
    "linkedin",
    "salesforce",
    "reddit",
    "twitter",
  ]),
  reason: z.string().optional(),
  authHeader: z.string().optional(),
});

function verifyPluginSecret(
  authHeader: string | undefined,
  requestAuthHeader: string | null,
): boolean {
  const providedAuth = authHeader ?? requestAuthHeader ?? undefined;

  if (!env.BAP_SERVER_SECRET) {
    if (process.env.NODE_ENV !== "production") {
      console.warn(
        "[Internal] BAP_SERVER_SECRET not configured, allowing internal auth request in development",
      );
      return true;
    }
    console.warn("[Internal] BAP_SERVER_SECRET not configured");
    return false;
  }

  return providedAuth === `Bearer ${env.BAP_SERVER_SECRET}`;
}

export async function POST(request: Request) {
  try {
    const parsed = authRequestSchema.safeParse(await request.json());
    if (!parsed.success) {
      return Response.json({ success: false }, { status: 400 });
    }
    const input = parsed.data;

    console.log("[Internal] Auth request:", {
      conversationId: input.conversationId,
      integration: input.integration,
      reason: input.reason,
    });

    if (!verifyPluginSecret(input.authHeader, request.headers.get("authorization"))) {
      console.error("[Internal] Invalid plugin auth for auth request");
      return Response.json({ success: false });
    }

    const inMemoryGenId = generationManager.getGenerationForConversation(input.conversationId);
    const conv =
      inMemoryGenId === undefined
        ? await db.query.conversation.findFirst({
            where: eq(conversation.id, input.conversationId),
          })
        : null;
    const genId = inMemoryGenId ?? conv?.currentGenerationId ?? undefined;
    console.log("[Internal] Auth generation lookup:", {
      conversationId: input.conversationId,
      inMemoryGenId: inMemoryGenId ?? "NOT FOUND",
      dbGenId: conv?.currentGenerationId ?? "NOT FOUND",
      genId: genId ?? "NOT FOUND",
    });
    if (!genId) {
      console.error("[Internal] No active generation for conversation:", input.conversationId);
      return Response.json({ success: false });
    }

    const allowedIntegrations = generationManager.getAllowedIntegrationsForConversation(
      input.conversationId,
    );
    if (allowedIntegrations && !allowedIntegrations.includes(input.integration)) {
      console.warn("[Internal] Integration not allowed for workflow:", input.integration);
      return Response.json({ success: false });
    }

    const result = await generationManager.waitForAuth(genId, {
      integration: input.integration,
      reason: input.reason,
    });

    if (!result.success || !result.userId) {
      return Response.json({ success: false });
    }

    const tokens = await getTokensForIntegrations(result.userId, [input.integration]);
    return Response.json({ success: true, tokens });
  } catch (error) {
    console.error("[Internal] authRequest error:", error);
    return Response.json({ success: false }, { status: 500 });
  }
}
