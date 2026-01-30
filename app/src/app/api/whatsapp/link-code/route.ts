import { auth } from "@/lib/auth";
import { db } from "@/server/db/client";
import { whatsappLinkCode, whatsappUserLink } from "@/server/db/schema";
import { eq } from "drizzle-orm";

function generateLinkCode(): string {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

export async function POST(request: Request) {
  const sessionData = await auth.api.getSession({ headers: request.headers });
  const currentUser = sessionData?.user;
  if (!currentUser) {
    return new Response("Unauthorized", { status: 401 });
  }

  if (!currentUser.phoneNumber) {
    return new Response("Phone number required", { status: 400 });
  }

  const existingLink = await db.query.whatsappUserLink.findFirst({
    where: eq(whatsappUserLink.userId, currentUser.id),
  });

  await db
    .update(whatsappLinkCode)
    .set({ usedAt: new Date() })
    .where(eq(whatsappLinkCode.userId, currentUser.id));

  const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

  let code = "";
  for (let attempt = 0; attempt < 5; attempt += 1) {
    code = generateLinkCode();
    try {
      await db.insert(whatsappLinkCode).values({
        userId: currentUser.id,
        code,
        expiresAt,
      });
      break;
    } catch (err) {
      if (attempt === 4) {
        console.error("[whatsapp-link] Failed to create code:", err);
        return new Response("Failed to create link code", { status: 500 });
      }
    }
  }

  return Response.json({
    code,
    expiresAt: expiresAt.toISOString(),
    alreadyLinked: !!existingLink,
  });
}
