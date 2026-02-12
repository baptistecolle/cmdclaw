import { env } from "@/env";
import { generationManager } from "@/server/services/generation-manager";
import { getTokensForIntegrations } from "@/server/integrations/cli-env";

export const runtime = "nodejs";

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
    const input = await request.json();

    console.log("[Internal] Auth request:", {
      conversationId: input.conversationId,
      integration: input.integration,
      reason: input.reason,
    });

    if (
      !verifyPluginSecret(
        input.authHeader,
        request.headers.get("authorization"),
      )
    ) {
      console.error("[Internal] Invalid plugin auth for auth request");
      return Response.json({ success: false });
    }

    const genId = generationManager.getGenerationForConversation(
      input.conversationId,
    );
    if (!genId) {
      console.error(
        "[Internal] No active generation for conversation:",
        input.conversationId,
      );
      return Response.json({ success: false });
    }

    const allowedIntegrations =
      generationManager.getAllowedIntegrationsForConversation(
        input.conversationId,
      );
    if (
      allowedIntegrations &&
      !allowedIntegrations.includes(input.integration as any)
    ) {
      console.warn(
        "[Internal] Integration not allowed for workflow:",
        input.integration,
      );
      return Response.json({ success: false });
    }

    const result = await generationManager.waitForAuth(genId, {
      integration: input.integration,
      reason: input.reason,
    });

    if (!result.success || !result.userId) {
      return Response.json({ success: false });
    }

    const tokens = await getTokensForIntegrations(result.userId, [
      input.integration,
    ]);
    return Response.json({ success: true, tokens });
  } catch (error) {
    console.error("[Internal] authRequest error:", error);
    return Response.json({ success: false }, { status: 500 });
  }
}
