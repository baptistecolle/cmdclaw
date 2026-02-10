import { z } from "zod";
import { baseProcedure } from "../middleware";
import { generationManager } from "@/server/services/generation-manager";
import { getTokensForIntegrations } from "@/server/integrations/cli-env";
import { env } from "@/env";

/**
 * Internal router for plugin callbacks from E2B sandbox.
 * These endpoints are called by the OpenCode plugin running inside the sandbox.
 */

// Verify the plugin auth secret
function verifyPluginSecret(authHeader: string | undefined): boolean {
  if (!env.BAP_SERVER_SECRET) {
    if (process.env.NODE_ENV !== "production") {
      console.warn("[Internal] BAP_SERVER_SECRET not configured, allowing internal plugin request in development");
      return true;
    }
    console.warn("[Internal] BAP_SERVER_SECRET not configured");
    return false;
  }
  const expected = `Bearer ${env.BAP_SERVER_SECRET}`;
  return authHeader === expected;
}

/**
 * Plugin requests approval for a write operation.
 * Called by the integration-permissions plugin when detecting a write CLI command.
 */
const approvalRequest = baseProcedure
  .input(
    z.object({
      sandboxId: z.string(),
      conversationId: z.string(),
      integration: z.string(),
      operation: z.string(),
      command: z.string(),
      toolInput: z.unknown(),
      authHeader: z.string().optional(),
    })
  )
  .output(
    z.object({
      decision: z.enum(["allow", "deny"]),
    })
  )
  .handler(async ({ input }) => {
    console.log("[Internal] approvalRequest received:", {
      conversationId: input.conversationId,
      integration: input.integration,
      operation: input.operation,
      hasAuthHeader: !!input.authHeader,
    });

    // Verify auth
    if (!verifyPluginSecret(input.authHeader)) {
      console.error("[Internal] Invalid plugin auth for approval request");
      return { decision: "deny" as const };
    }

    // Find the active generation for this conversation
    const genId = generationManager.getGenerationForConversation(input.conversationId);
    console.log("[Internal] Generation lookup:", { conversationId: input.conversationId, genId: genId ?? "NOT FOUND" });
    if (!genId) {
      console.error("[Internal] No active generation for conversation:", input.conversationId);
      return { decision: "deny" as const };
    }

    const allowedIntegrations = generationManager.getAllowedIntegrationsForConversation(
      input.conversationId
    );
    if (allowedIntegrations && !allowedIntegrations.includes(input.integration as any)) {
      console.warn("[Internal] Integration not allowed for workflow:", input.integration);
      return { decision: "deny" as const };
    }

    // Wait for user approval via GenerationManager
    const decision = await generationManager.waitForApproval(genId, {
      toolInput: input.toolInput as Record<string, unknown>,
      integration: input.integration,
      operation: input.operation,
      command: input.command,
    });

    return { decision };
  });

/**
 * Plugin requests OAuth authentication for an integration.
 * Called by the integration-permissions plugin when detecting missing tokens.
 */
const authRequest = baseProcedure
  .input(
    z.object({
      conversationId: z.string(),
      integration: z.string(),
      reason: z.string().optional(),
      authHeader: z.string().optional(),
    })
  )
  .output(
    z.object({
      success: z.boolean(),
      tokens: z.record(z.string(), z.string()).optional(),
    })
  )
  .handler(async ({ input }) => {
    // Verify auth
    if (!verifyPluginSecret(input.authHeader)) {
      console.error("[Internal] Invalid plugin auth for auth request");
      return { success: false };
    }

    console.log("[Internal] Auth request:", {
      conversationId: input.conversationId,
      integration: input.integration,
      reason: input.reason,
    });

    // Find the active generation for this conversation
    const genId = generationManager.getGenerationForConversation(input.conversationId);
    if (!genId) {
      console.error("[Internal] No active generation for conversation:", input.conversationId);
      return { success: false };
    }

    const allowedIntegrations = generationManager.getAllowedIntegrationsForConversation(
      input.conversationId
    );
    if (allowedIntegrations && !allowedIntegrations.includes(input.integration as any)) {
      console.warn("[Internal] Integration not allowed for workflow:", input.integration);
      return { success: false };
    }

    // Wait for OAuth to complete via GenerationManager
    const result = await generationManager.waitForAuth(genId, {
      integration: input.integration,
      reason: input.reason,
    });

    if (!result.success || !result.userId) {
      return { success: false };
    }

    // Fetch fresh tokens for the integration
    const tokens = await getTokensForIntegrations(result.userId, [input.integration]);

    return { success: true, tokens };
  });

export const internalRouter = {
  approvalRequest,
  authRequest,
};
