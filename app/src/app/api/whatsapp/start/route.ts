import { auth } from "@/lib/auth";
import {
  ensureWhatsAppSocket,
  getWhatsAppStatus,
} from "@/server/services/whatsapp-bot";

export async function POST(request: Request) {
  const sessionData = await auth.api.getSession({ headers: request.headers });
  if (!sessionData?.user || sessionData.user.role !== "admin") {
    return new Response("Forbidden", { status: 403 });
  }

  await ensureWhatsAppSocket();
  const status = getWhatsAppStatus();
  return Response.json(status);
}
