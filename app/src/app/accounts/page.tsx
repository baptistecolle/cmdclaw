"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { authClient } from "@/lib/auth-client";

type SessionData = Awaited<ReturnType<typeof authClient.getSession>>["data"];

type InfoRowProps = {
  label: string;
  value: string;
};

function InfoRow({ label, value }: InfoRowProps) {
  return (
    <div className="bg-muted/50 rounded-lg border px-3 py-2">
      <p className="text-muted-foreground text-[11px] font-semibold tracking-[0.14em] uppercase">
        {label}
      </p>
      <p className="text-sm font-medium break-all">{value}</p>
    </div>
  );
}

export default function AccountsPage() {
  const [sessionData, setSessionData] = useState<SessionData | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");

  useEffect(() => {
    authClient
      .getSession()
      .then((res) => {
        setSessionData(res?.data ?? null);
        setStatus("ready");
      })
      .catch(() => setStatus("error"));
  }, []);

  const user = sessionData?.user;
  const activeSession = sessionData?.session;

  return (
    <div className="flex flex-1 flex-col gap-4">
      <div className="bg-card rounded-xl border p-6 shadow-sm">
        <div className="flex flex-col justify-between gap-2 sm:flex-row sm:items-start">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Account</h1>
            <p className="text-muted-foreground text-sm">
              Quick snapshot of who is signed in right now.
            </p>
          </div>
          <Button asChild variant="outline" size="sm">
            <Link href="/login">Open login</Link>
          </Button>
        </div>

        <div className="mt-5 space-y-4">
          {status === "loading" && (
            <div
              className="bg-muted/70 h-28 animate-pulse rounded-lg"
              aria-label="Loading session"
            />
          )}

          {status === "error" && (
            <div className="border-destructive/30 bg-destructive/10 text-destructive rounded-lg border p-3 text-sm">
              Unable to load your session right now. Please try again in a moment.
            </div>
          )}

          {status === "ready" && user && (
            <div className="bg-muted/50 space-y-4 rounded-xl border p-4">
              <div>
                <p className="text-muted-foreground text-[11px] font-semibold tracking-[0.14em] uppercase">
                  Signed in as
                </p>
                <p className="text-lg leading-tight font-semibold">
                  {user.name || user.email || "Current user"}
                </p>
                {user.email && <p className="text-muted-foreground text-sm">{user.email}</p>}
              </div>

              <Separator />

              <div className="grid gap-3 sm:grid-cols-2">
                <InfoRow label="User ID" value={user.id ?? "Not available"} />
                <InfoRow label="Session ID" value={activeSession?.id ?? "Not available"} />
                <InfoRow label="Session status" value={activeSession ? "Active" : "Missing"} />
                <InfoRow
                  label="Expires at"
                  value={
                    activeSession?.expiresAt
                      ? typeof activeSession.expiresAt === "string"
                        ? activeSession.expiresAt
                        : activeSession.expiresAt.toISOString()
                      : "Not available"
                  }
                />
              </div>
            </div>
          )}

          {status === "ready" && !user && (
            <div className="bg-muted/50 space-y-3 rounded-lg border p-4">
              <p className="text-muted-foreground text-sm">
                No user is currently signed in. Use the login link to start a session.
              </p>
              <Button asChild size="sm">
                <Link href="/login">Go to login</Link>
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
