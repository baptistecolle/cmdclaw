"use client";

import { usePathname, useSearchParams } from "next/navigation";
import posthog from "posthog-js";
import { PostHogProvider, usePostHog } from "posthog-js/react";
import { Suspense, useEffect } from "react";
import { env } from "@/env";
import { authClient } from "@/lib/auth-client";

const posthogKey = env.NEXT_PUBLIC_POSTHOG_KEY;
const posthogHost = env.NEXT_PUBLIC_POSTHOG_HOST ?? "https://app.posthog.com";
const isPosthogEnabled = Boolean(posthogKey);

if (isPosthogEnabled) {
  posthog.init(posthogKey!, {
    api_host: posthogHost,
    capture_pageview: false,
  });
}

function PostHogPageView() {
  const posthogClient = usePostHog();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  useEffect(() => {
    if (!posthogClient) {
      return;
    }
    const search = searchParams?.toString();
    const url = `${window.location.origin}${pathname}${search ? `?${search}` : ""}`;
    posthogClient.capture("$pageview", { $current_url: url });
  }, [posthogClient, pathname, searchParams]);

  return null;
}

function PostHogIdentify() {
  const posthogClient = usePostHog();

  useEffect(() => {
    if (!posthogClient) {
      return;
    }
    let cancelled = false;

    authClient
      .getSession()
      .then((res) => {
        if (cancelled) {
          return;
        }
        const user = res?.data?.user;
        if (!user) {
          posthogClient.reset();
          return;
        }
        const properties: Record<string, string> = {};
        if (user.email) {
          properties.email = user.email;
        }
        if ("name" in user && typeof user.name === "string" && user.name) {
          properties.name = user.name;
        }
        posthogClient.identify(user.id, properties);
      })
      .catch(() => {
        if (!cancelled) {
          posthogClient.reset();
        }
      });

    return () => {
      cancelled = true;
    };
  }, [posthogClient]);

  return null;
}

type PostHogClientProviderProps = {
  children: React.ReactNode;
};

export function PostHogClientProvider({ children }: PostHogClientProviderProps) {
  if (!isPosthogEnabled) {
    return <>{children}</>;
  }

  return (
    <PostHogProvider client={posthog}>
      <Suspense fallback={null}>
        <PostHogPageView />
      </Suspense>
      <PostHogIdentify />
      {children}
    </PostHogProvider>
  );
}
