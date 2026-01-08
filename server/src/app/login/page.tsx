'use client';

import type React from "react";
import Link from "next/link";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { authClient } from "@/lib/auth-client";

type SignInState = "idle" | "sending" | "sent" | "error";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<SignInState>("idle");
  const [session, setSession] = useState<{ user?: { email?: string; name?: string } } | null>(null);

  useEffect(() => {
    authClient.getSession().then((res) => {
      if (res?.data?.session && res?.data?.user) {
        setSession(res.data);
      } else {
        setSession(null);
      }
    });
  }, []);

  const requestMagicLink = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setStatus("sending");
    setError(null);
    setMessage(null);

    const { error: signInError } = await authClient.signIn.magicLink({
      email,
      callbackURL: "/accounts",
      newUserCallbackURL: "/accounts",
      errorCallbackURL: "/login?error=magic-link",
    });

    if (signInError) {
      setStatus("error");
      setError(signInError?.message || "Unable to send the magic link right now.");
      return;
    }

    setStatus("sent");
    setMessage(
      "We sent a magic link to your inbox. In development the link is also printed in the server logs."
    );
  };

  const handleSignOut = async () => {
    const { error: signOutError } = await authClient.signOut();
    if (!signOutError) {
      setSession(null);
      setStatus("idle");
      setMessage(null);
    }
  };

  return (
    <div className="min-h-screen bg-background px-4 py-12">
      <div className="mx-auto flex w-full max-w-lg flex-col gap-6 rounded-2xl border bg-card p-6 shadow-sm">
        <div className="space-y-1 text-center">
          <p className="text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">
            ViralPilot
          </p>
          <h1 className="text-2xl font-semibold tracking-tight">Log in</h1>
          <p className="text-sm text-muted-foreground">Enter your email to get a magic link.</p>
        </div>

        {session?.user ? (
          <div className="space-y-3">
            <div className="rounded-xl border bg-muted/60 p-3">
              <p className="text-sm font-medium">Signed in</p>
              <p className="text-sm text-muted-foreground">
                {session.user.name || session.user.email}
              </p>
              {session.user.email && (
                <p className="text-xs text-muted-foreground">{session.user.email}</p>
              )}
            </div>
            <div className="flex flex-col gap-2 sm:flex-row">
              <Button asChild className="flex-1">
                <Link href="/accounts">Continue</Link>
              </Button>
              <Button variant="outline" className="flex-1" onClick={handleSignOut}>
                Sign out
              </Button>
            </div>
          </div>
        ) : (
          <form onSubmit={requestMagicLink} className="space-y-3">
            <label className="text-sm font-medium text-muted-foreground" htmlFor="email">
              Email
            </label>
            <Input
              id="email"
              type="email"
              autoComplete="email"
              placeholder="you@example.com"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              required
              aria-invalid={status === "error"}
            />
            <Button type="submit" className="w-full" disabled={!email || status === "sending"}>
              {status === "sending" ? "Sending…" : "Send magic link"}
            </Button>
          </form>
        )}

        {message && !session?.user && (
          <div className="rounded-xl border border-primary/30 bg-primary/10 p-3 text-sm text-primary">
            {message}
          </div>
        )}

        {error && (
          <div className="rounded-xl border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
            {error}
          </div>
        )}
      </div>
    </div>
  );
}
