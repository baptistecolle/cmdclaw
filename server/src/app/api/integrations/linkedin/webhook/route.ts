import { NextRequest, NextResponse } from "next/server";
import { db } from "@/server/db/client";
import { integration } from "@/server/db/schema";
import { eq, and } from "drizzle-orm";
import { getUnipileAccount } from "@/server/integrations/unipile";

interface UnipileWebhookPayload {
  event: string;
  account_id: string;
  name?: string;
  status?: string;
  error?: string;
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as UnipileWebhookPayload;

    console.log("LinkedIn webhook received:", JSON.stringify(body, null, 2));

    const { event, account_id, name: userId } = body;

    if (!account_id) {
      console.error("Missing account_id in webhook payload");
      return NextResponse.json({ ok: false, error: "Missing account_id" }, { status: 400 });
    }

    switch (event) {
      case "account.created":
      case "account.connected": {
        if (!userId) {
          console.error("Missing userId (name) in webhook payload for account creation");
          return NextResponse.json({ ok: false, error: "Missing userId" }, { status: 400 });
        }

        try {
          const account = await getUnipileAccount(account_id);

          const existingIntegration = await db.query.integration.findFirst({
            where: and(
              eq(integration.userId, userId),
              eq(integration.type, "linkedin")
            ),
          });

          if (existingIntegration) {
            await db
              .update(integration)
              .set({
                providerAccountId: account_id,
                displayName: account.name || account.identifier,
                enabled: true,
                metadata: {
                  unipileAccountId: account_id,
                  linkedinIdentifier: account.identifier,
                },
              })
              .where(eq(integration.id, existingIntegration.id));
          } else {
            await db.insert(integration).values({
              userId,
              type: "linkedin",
              providerAccountId: account_id,
              displayName: account.name || account.identifier,
              enabled: true,
              metadata: {
                unipileAccountId: account_id,
                linkedinIdentifier: account.identifier,
              },
            });
          }

          console.log(`LinkedIn integration created/updated for user ${userId}`);
        } catch (error) {
          console.error("Failed to fetch Unipile account or create integration:", error);
          return NextResponse.json({ ok: false, error: "Failed to process account" }, { status: 500 });
        }
        break;
      }

      case "account.disconnected":
      case "account.error": {
        const existingIntegration = await db.query.integration.findFirst({
          where: eq(integration.providerAccountId, account_id),
        });

        if (existingIntegration) {
          await db
            .update(integration)
            .set({ enabled: false })
            .where(eq(integration.id, existingIntegration.id));

          console.log(`LinkedIn integration disabled for account ${account_id}: ${event}`);
        }
        break;
      }

      default:
        console.log(`Unhandled webhook event: ${event}`);
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("LinkedIn webhook error:", error);
    return NextResponse.json(
      { ok: false, error: "Internal server error" },
      { status: 500 }
    );
  }
}
