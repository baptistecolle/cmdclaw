"use client";

import { useCustomer } from "autumn-js/react";
import { Loader2, CheckCircle2, CreditCard, Sparkles } from "lucide-react";
import { useCallback } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export default function BillingPage() {
  const { customer, attach, cancel, openBillingPortal, isLoading } = useCustomer();

  const isPro = customer?.products?.some((p) => p.id === "pro");

  const handleUpgrade = useCallback(async () => {
    await attach({ productId: "pro" });
  }, [attach]);

  const handleCancel = useCallback(async () => {
    await cancel({ productId: "pro" });
  }, [cancel]);

  const handleManageBilling = useCallback(async () => {
    await openBillingPortal();
  }, [openBillingPortal]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="text-muted-foreground h-6 w-6 animate-spin" />
      </div>
    );
  }

  return (
    <div>
      <div className="mb-6">
        <h2 className="text-xl font-semibold">Billing</h2>
        <p className="text-muted-foreground mt-1 text-sm">
          Manage your subscription and billing information.
        </p>
      </div>

      <div className="space-y-4">
        {/* Current Plan */}
        <div className="rounded-lg border p-5">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h3 className="font-medium">Current Plan</h3>
                <span
                  className={cn(
                    "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium",
                    isPro
                      ? "bg-purple-500/10 text-purple-700 dark:text-purple-400"
                      : "bg-muted text-muted-foreground",
                  )}
                >
                  {isPro ? (
                    <>
                      <Sparkles className="h-3 w-3" />
                      Pro
                    </>
                  ) : (
                    "Free"
                  )}
                </span>
              </div>
              <p className="text-muted-foreground mt-1 text-sm">
                {isPro
                  ? "You have access to E2B cloud sandboxes and increased message limits."
                  : "You're on the free plan with BYOC (Bring Your Own Compute) only."}
              </p>
            </div>
          </div>
        </div>

        {/* Plan Details */}
        <div className="grid gap-4 sm:grid-cols-2">
          {/* Free Plan Card */}
          <div className={cn("rounded-lg border p-5", !isPro && "ring-2 ring-foreground")}>
            <div className="mb-4">
              <h3 className="font-medium">Free</h3>
              <div className="mt-1 text-2xl font-bold">
                $0
                <span className="text-muted-foreground text-sm font-normal">/month</span>
              </div>
            </div>
            <ul className="text-muted-foreground space-y-2 text-sm">
              <li className="flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4 text-green-500" />
                BYOC (Bring Your Own Compute)
              </li>
              <li className="flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4 text-green-500" />
                Unlimited local sessions
              </li>
            </ul>
            {!isPro && (
              <div className="mt-4 border-t pt-4">
                <span className="text-muted-foreground text-xs">Current plan</span>
              </div>
            )}
          </div>

          {/* Pro Plan Card */}
          <div className={cn("rounded-lg border p-5", isPro && "ring-2 ring-purple-500")}>
            <div className="mb-4">
              <div className="flex items-center gap-2">
                <h3 className="font-medium">Pro</h3>
                <Sparkles className="h-4 w-4 text-purple-500" />
              </div>
              <div className="mt-1 text-2xl font-bold">
                €30
                <span className="text-muted-foreground text-sm font-normal">/month</span>
              </div>
            </div>
            <ul className="text-muted-foreground space-y-2 text-sm">
              <li className="flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4 text-green-500" />
                Everything in Free
              </li>
              <li className="flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4 text-green-500" />
                E2B Cloud Sandbox access
              </li>
              <li className="flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4 text-green-500" />
                10,000 messages/month included
              </li>
            </ul>
            <div className="mt-4 border-t pt-4">
              {isPro ? (
                <span className="text-xs text-purple-600 dark:text-purple-400">Current plan</span>
              ) : (
                <Button size="sm" onClick={handleUpgrade} className="w-full">
                  Upgrade to Pro
                </Button>
              )}
            </div>
          </div>
        </div>

        {/* Billing Actions */}
        {isPro && (
          <div className="rounded-lg border p-5">
            <h3 className="mb-4 font-medium">Manage Subscription</h3>
            <div className="flex flex-wrap gap-3">
              <Button variant="outline" size="sm" onClick={handleManageBilling}>
                <CreditCard className="mr-2 h-4 w-4" />
                Manage Billing
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={handleCancel}
                className="text-destructive hover:text-destructive"
              >
                Cancel Subscription
              </Button>
            </div>
          </div>
        )}
      </div>

      <div className="border-muted bg-muted/30 mt-6 rounded-lg border p-4">
        <p className="text-muted-foreground text-xs">
          Billing is handled securely through Stripe. You can manage your payment methods, view
          invoices, and update your subscription at any time.
        </p>
      </div>
    </div>
  );
}
