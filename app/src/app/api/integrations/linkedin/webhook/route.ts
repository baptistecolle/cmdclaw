import { eq, and } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/server/db/client";
import { integration } from "@/server/db/schema";
import { getUnipileAccount } from "@/server/integrations/unipile";

interface AccountStatusPayload {
  account_id: string;
  message: string;
  account_type: string;
}

interface UnipileWebhookPayload {
  AccountStatus?: AccountStatusPayload;
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as UnipileWebhookPayload;

    console.log("LinkedIn webhook received:", JSON.stringify(body, null, 2));

    // Handle AccountStatus webhook format
    const accountStatus = body.AccountStatus;
    if (!accountStatus) {
      console.error("Missing AccountStatus in webhook payload");
      return NextResponse.json({ ok: false, error: "Missing AccountStatus" }, { status: 400 });
    }

    const { account_id, message } = accountStatus;
    // Get userId from query params (passed in notify_url)
    const userId = request.nextUrl.searchParams.get("userId");

    if (!account_id) {
      console.error("Missing account_id in webhook payload");
      return NextResponse.json({ ok: false, error: "Missing account_id" }, { status: 400 });
    }

    switch (message) {
      case "CREATION_SUCCESS": {
        if (!userId) {
          // userId not available via webhook (Unipile strips query params)
          // Integration will be linked via redirect instead
          console.log("CREATION_SUCCESS received - integration will be linked via redirect");
          return NextResponse.json({ ok: true });
        }

        try {
          const account = await getUnipileAccount(account_id);

          const existingIntegration = await db.query.integration.findFirst({
            where: and(eq(integration.userId, userId), eq(integration.type, "linkedin")),
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
          return NextResponse.json(
            { ok: false, error: "Failed to process account" },
            { status: 500 },
          );
        }
        break;
      }

      case "DISCONNECTED":
      case "CREATION_FAILED":
      case "ERROR": {
        const existingIntegration = await db.query.integration.findFirst({
          where: eq(integration.providerAccountId, account_id),
        });

        if (existingIntegration) {
          await db
            .update(integration)
            .set({ enabled: false })
            .where(eq(integration.id, existingIntegration.id));

          console.log(`LinkedIn integration disabled for account ${account_id}: ${message}`);
        }
        break;
      }

      default:
        console.log(`Unhandled webhook message: ${message}`);
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("LinkedIn webhook error:", error);
    return NextResponse.json({ ok: false, error: "Internal server error" }, { status: 500 });
  }
}
