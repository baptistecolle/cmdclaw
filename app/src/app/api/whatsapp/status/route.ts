import { auth } from "@/lib/auth";
import { getWhatsAppStatus } from "@/server/services/whatsapp-bot";

export async function GET(request: Request) {
  const sessionData = await auth.api.getSession({ headers: request.headers });
  if (!sessionData?.user || sessionData.user.role !== "admin") {
    return new Response("Forbidden", { status: 403 });
  }

  // Disabled for now: avoid starting Baileys while WhatsApp integration is unused.
  // await ensureWhatsAppSocket();
  const status = getWhatsAppStatus();
  return Response.json(status);
}
