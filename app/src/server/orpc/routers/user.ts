import { ORPCError } from "@orpc/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { buildUserForwardingAddress, EMAIL_FORWARDED_TRIGGER_TYPE } from "@/lib/email-forwarding";
import { user, workflow } from "@/server/db/schema";
import { protectedProcedure } from "../middleware";

// Get current user with onboardedAt status
const me = protectedProcedure.handler(async ({ context }) => {
  const dbUser = await context.db.query.user.findFirst({
    where: eq(user.id, context.user.id),
  });

  return {
    id: context.user.id,
    name: context.user.name,
    email: context.user.email,
    image: context.user.image,
    onboardedAt: dbUser?.onboardedAt ?? null,
  };
});

// Mark onboarding as complete
const completeOnboarding = protectedProcedure.handler(async ({ context }) => {
  await context.db
    .update(user)
    .set({ onboardedAt: new Date() })
    .where(eq(user.id, context.user.id));

  return { success: true };
});

const forwarding = protectedProcedure.handler(async ({ context }) => {
  const dbUser = await context.db.query.user.findFirst({
    where: eq(user.id, context.user.id),
    columns: {
      id: true,
      defaultForwardedWorkflowId: true,
    },
  });

  const receivingDomain = process.env.RESEND_RECEIVING_DOMAIN?.trim().toLowerCase() ?? null;
  const userForwardingAddress = receivingDomain
    ? buildUserForwardingAddress(context.user.id, receivingDomain)
    : null;

  const workflows = await context.db.query.workflow.findMany({
    where: and(
      eq(workflow.ownerId, context.user.id),
      eq(workflow.triggerType, EMAIL_FORWARDED_TRIGGER_TYPE),
    ),
    columns: {
      id: true,
      name: true,
      status: true,
      updatedAt: true,
    },
    orderBy: (row, { desc }) => [desc(row.updatedAt)],
  });

  return {
    receivingDomain,
    userForwardingAddress,
    defaultForwardedWorkflowId: dbUser?.defaultForwardedWorkflowId ?? null,
    workflows,
  };
});

const setDefaultForwardedWorkflow = protectedProcedure
  .input(
    z.object({
      workflowId: z.string().nullable(),
    }),
  )
  .handler(async ({ input, context }) => {
    if (input.workflowId) {
      const owned = await context.db.query.workflow.findFirst({
        where: and(
          eq(workflow.id, input.workflowId),
          eq(workflow.ownerId, context.user.id),
          eq(workflow.triggerType, EMAIL_FORWARDED_TRIGGER_TYPE),
        ),
        columns: { id: true },
      });

      if (!owned) {
        throw new ORPCError("NOT_FOUND", {
          message: "Workflow not found for forwarded-email default",
        });
      }
    }

    await context.db
      .update(user)
      .set({ defaultForwardedWorkflowId: input.workflowId })
      .where(eq(user.id, context.user.id));

    return { success: true };
  });

export const userRouter = {
  me,
  completeOnboarding,
  forwarding,
  setDefaultForwardedWorkflow,
};
