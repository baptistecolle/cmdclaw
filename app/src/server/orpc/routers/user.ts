import { eq } from "drizzle-orm";
import { user } from "@/server/db/schema";
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

export const userRouter = {
  me,
  completeOnboarding,
};
