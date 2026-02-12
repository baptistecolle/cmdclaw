import { env } from "@/env";
import { generationManager } from "@/server/services/generation-manager";

export const runtime = "nodejs";

function verifyPluginSecret(
  authHeader: string | undefined,
  requestAuthHeader: string | null,
): boolean {
  const providedAuth = authHeader ?? requestAuthHeader ?? undefined;

  if (!env.BAP_SERVER_SECRET) {
    if (process.env.NODE_ENV !== "production") {
      console.warn(
        "[Internal] BAP_SERVER_SECRET not configured, allowing internal approval request in development",
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

    console.log("[Internal] approvalRequest received:", {
      conversationId: input.conversationId,
      integration: input.integration,
      operation: input.operation,
      hasAuthHeader: !!input.authHeader,
    });

    if (
      !verifyPluginSecret(
        input.authHeader,
        request.headers.get("authorization"),
      )
    ) {
      console.error("[Internal] Invalid plugin auth for approval request");
      return Response.json({ decision: "deny" });
    }

    const genId = generationManager.getGenerationForConversation(
      input.conversationId,
    );
    console.log("[Internal] Generation lookup:", {
      conversationId: input.conversationId,
      genId: genId ?? "NOT FOUND",
    });

    if (!genId) {
      console.error(
        "[Internal] No active generation for conversation:",
        input.conversationId,
      );
      return Response.json({ decision: "deny" });
    }

    const allowedIntegrations =
      generationManager.getAllowedIntegrationsForConversation(
        input.conversationId,
      );
    if (
      allowedIntegrations &&
      !allowedIntegrations.includes(input.integration as unknown)
    ) {
      console.warn(
        "[Internal] Integration not allowed for workflow:",
        input.integration,
      );
      return Response.json({ decision: "deny" });
    }

    const decision = await generationManager.waitForApproval(genId, {
      toolInput: input.toolInput as Record<string, unknown>,
      integration: input.integration,
      operation: input.operation,
      command: input.command,
    });

    return Response.json({ decision });
  } catch (error) {
    console.error("[Internal] approvalRequest error:", error);
    return Response.json({ decision: "deny" }, { status: 500 });
  }
}
