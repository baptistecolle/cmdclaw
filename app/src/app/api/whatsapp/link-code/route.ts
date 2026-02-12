import { eq } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { db } from "@/server/db/client";
import { whatsappLinkCode, whatsappUserLink } from "@/server/db/schema";

function generateLinkCode(): string {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

async function insertLinkCodeWithRetry(params: {
  userId: string;
  expiresAt: Date;
  maxAttempts: number;
  attempt?: number;
}): Promise<{ ok: true; code: string } | { ok: false }> {
  const { userId, expiresAt, maxAttempts } = params;
  const attempt = params.attempt ?? 0;
  const code = generateLinkCode();

  try {
    await db.insert(whatsappLinkCode).values({
      userId,
      code,
      expiresAt,
    });
    return { ok: true, code };
  } catch (err) {
    if (attempt >= maxAttempts - 1) {
      console.error("[whatsapp-link] Failed to create code:", err);
      return { ok: false };
    }
    return insertLinkCodeWithRetry({
      userId,
      expiresAt,
      maxAttempts,
      attempt: attempt + 1,
    });
  }
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

  const inserted = await insertLinkCodeWithRetry({
    userId: currentUser.id,
    expiresAt,
    maxAttempts: 5,
  });
  if (!inserted.ok) {
    return new Response("Failed to create link code", { status: 500 });
  }

  return Response.json({
    code: inserted.code,
    expiresAt: expiresAt.toISOString(),
    alreadyLinked: !!existingLink,
  });
}
