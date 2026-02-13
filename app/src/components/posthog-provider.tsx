"use client";

import { usePathname, useSearchParams } from "next/navigation";
import posthogClientLib from "posthog-js";
import { PostHogProvider, usePostHog } from "posthog-js/react";
import { Suspense, useEffect } from "react";
import { env } from "@/env";
import { authClient } from "@/lib/auth-client";

const posthogKey = env.NEXT_PUBLIC_POSTHOG_KEY;
const posthogUiHost = "https://eu.posthog.com";
const posthogProxyPath = "/_bap_lattice";
const isPosthogEnabled = Boolean(posthogKey);

if (isPosthogEnabled) {
  posthogClientLib.init(posthogKey!, {
    api_host: posthogProxyPath,
    ui_host: posthogUiHost,
    capture_pageview: false,
    capture_exceptions: {
      capture_unhandled_errors: true,
      capture_unhandled_rejections: true,
      capture_console_errors: true,
    },
    enable_recording_console_log: true,
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
    <PostHogProvider client={posthogClientLib}>
      <Suspense fallback={null}>
        <PostHogPageView />
      </Suspense>
      <PostHogIdentify />
      {children}
    </PostHogProvider>
  );
}
