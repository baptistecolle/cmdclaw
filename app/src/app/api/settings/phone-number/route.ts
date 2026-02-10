import { auth } from "@/lib/auth";
import { db } from "@/server/db/client";
import { user } from "@/server/db/schema";
import { eq } from "drizzle-orm";

export async function DELETE(request: Request) {
  const sessionData = await auth.api.getSession({ headers: request.headers });
  const currentUser = sessionData?.user;

  if (!currentUser) {
    return new Response("Unauthorized", { status: 401 });
  }

  await db.update(user).set({ phoneNumber: null }).where(eq(user.id, currentUser.id));

  return Response.json({ status: true });
}
