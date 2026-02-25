import { z } from "zod";
import { env } from "@/env";
import { getTokensForIntegrations } from "@/server/integrations/cli-env";
import { generationManager } from "@/server/services/generation-manager";
import { resolveGenerationIdForInternalCallback } from "@/server/services/internal-callback-generation";

export const runtime = "nodejs";

const authRequestSchema = z.object({
  generationId: z.string().optional(),
  sandboxId: z.string().optional(),
  conversationId: z.string().min(1),
  integration: z.enum([
    "gmail",
    "outlook",
    "outlook_calendar",
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
    "dynamics",
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

  if (!env.CMDCLAW_SERVER_SECRET) {
    if (process.env.NODE_ENV !== "production") {
      console.warn(
        "[Internal] CMDCLAW_SERVER_SECRET not configured, allowing internal auth request in development",
      );
      return true;
    }
    console.warn("[Internal] CMDCLAW_SERVER_SECRET not configured");
    return false;
  }

  return providedAuth === `Bearer ${env.CMDCLAW_SERVER_SECRET}`;
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

    const genId = await resolveGenerationIdForInternalCallback({
      conversationId: input.conversationId,
      generationId: input.generationId,
      sandboxId: input.sandboxId,
    });
    console.log("[Internal] Auth generation lookup:", {
      conversationId: input.conversationId,
      requestedGenerationId: input.generationId ?? "NOT PROVIDED",
      sandboxId: input.sandboxId ?? "NOT PROVIDED",
      genId: genId ?? "NOT FOUND",
    });
    if (!genId) {
      console.error("[Internal] No active generation for conversation:", input.conversationId);
      return Response.json({ success: false });
    }

    const allowedIntegrations = await generationManager.getAllowedIntegrationsForGeneration(genId);

    if (Array.isArray(allowedIntegrations) && !allowedIntegrations.includes(input.integration)) {
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
