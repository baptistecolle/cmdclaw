'use client';

import type React from "react";
import Link from "next/link";
import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { authClient } from "@/lib/auth-client";

type SignInState = "idle" | "sending" | "sent" | "error";

function GoogleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24">
      <path
        fill="currentColor"
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
      />
      <path
        fill="currentColor"
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
      />
      <path
        fill="currentColor"
        d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
      />
      <path
        fill="currentColor"
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
      />
    </svg>
  );
}

function AppleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
      <path d="M17.05 20.28c-.98.95-2.05.8-3.08.35-1.09-.46-2.09-.48-3.24 0-1.44.62-2.2.44-3.06-.35C2.79 15.25 3.51 7.59 9.05 7.31c1.35.07 2.29.74 3.08.8 1.18-.24 2.31-.93 3.57-.84 1.51.12 2.65.72 3.4 1.8-3.12 1.87-2.38 5.98.48 7.13-.57 1.5-1.31 2.99-2.54 4.09l.01-.01zM12.03 7.25c-.15-2.23 1.66-4.07 3.74-4.25.29 2.58-2.34 4.5-3.74 4.25z" />
    </svg>
  );
}

function LoginContent() {
  const searchParams = useSearchParams();
  const callbackUrl = searchParams.get("callbackUrl") || "/chat";

  const [email, setEmail] = useState("");
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

    const { error: signInError } = await authClient.signIn.magicLink({
      email,
      callbackURL: callbackUrl,
      newUserCallbackURL: callbackUrl,
      errorCallbackURL: "/login?error=magic-link",
    });

    if (signInError) {
      setStatus("error");
      setError(signInError?.message || "Unable to send the magic link right now.");
      return;
    }

    setStatus("sent");
  };

  const handleSignOut = async () => {
    const { error: signOutError } = await authClient.signOut();
    if (!signOutError) {
      setSession(null);
      setStatus("idle");
    }
  };

  const handleGoogleSignIn = async () => {
    await authClient.signIn.social({
      provider: "google",
      callbackURL: callbackUrl,
    });
  };

  const handleAppleSignIn = async () => {
    await authClient.signIn.social({
      provider: "apple",
      callbackURL: callbackUrl,
    });
  };

  return (
    <div className="mx-auto flex w-full max-w-lg flex-col gap-6 rounded-2xl border bg-card p-6 shadow-sm">
      <div className="space-y-1 text-center">
        <p className="text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">
          Bap
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
              <Link href={callbackUrl}>Continue</Link>
            </Button>
            <Button variant="outline" className="flex-1" onClick={handleSignOut}>
              Sign out
            </Button>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="flex flex-col gap-2">
            <Button
              type="button"
              variant="outline"
              className="w-full"
              onClick={handleGoogleSignIn}
            >
              <GoogleIcon />
              <span className="ml-2">Continue with Google</span>
            </Button>
            <Button
              type="button"
              variant="outline"
              className="w-full"
              onClick={handleAppleSignIn}
            >
              <AppleIcon />
              <span className="ml-2">Continue with Apple</span>
            </Button>
          </div>

          <div className="relative">
            <div className="absolute inset-0 flex items-center">
              <span className="w-full border-t" />
            </div>
            <div className="relative flex justify-center text-xs uppercase">
              <span className="bg-card px-2 text-muted-foreground">Or continue with</span>
            </div>
          </div>

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
            <Button type="submit" className="w-full" disabled={!email || status === "sending" || status === "sent"}>
              {status === "sending" ? "Sending..." : status === "sent" ? "Email sent, check your inbox" : "Send magic link"}
            </Button>
          </form>
        </div>
      )}


      {error && (
        <div className="rounded-xl border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
          {error}
        </div>
      )}
    </div>
  );
}

export default function LoginPage() {
  return (
    <div className="min-h-screen bg-background px-4 py-12 flex items-center justify-center">
      <Suspense fallback={
        <div className="mx-auto flex w-full max-w-lg flex-col gap-6 rounded-2xl border bg-card p-6 shadow-sm">
          <div className="space-y-1 text-center">
            <p className="text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">
              Bap
            </p>
            <h1 className="text-2xl font-semibold tracking-tight">Log in</h1>
            <p className="text-sm text-muted-foreground">Loading...</p>
          </div>
        </div>
      }>
        <LoginContent />
      </Suspense>
    </div>
  );
}
