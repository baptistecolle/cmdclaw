"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { usePathname } from "next/navigation";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { authClient } from "@/lib/auth-client";

type ORPCProviderProps = {
  children: ReactNode;
};

export function ORPCProvider({ children }: ORPCProviderProps) {
  const pathname = usePathname();
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 1000 * 60,
            refetchOnWindowFocus: false,
          },
        },
      }),
  );
  const lastSessionUserIdRef = useRef<string | null | undefined>(undefined);

  useEffect(() => {
    let active = true;

    const syncSessionUser = async () => {
      try {
        const sessionResult = await authClient.getSession();
        if (!active) {
          return;
        }
        const currentUserId = sessionResult?.data?.user?.id ?? null;
        const previousUserId = lastSessionUserIdRef.current;
        if (previousUserId === undefined) {
          lastSessionUserIdRef.current = currentUserId;
          return;
        }
        if (previousUserId !== currentUserId) {
          lastSessionUserIdRef.current = currentUserId;
          queryClient.clear();
          console.info("[Auth] Session principal changed, cleared client query cache", {
            previousUserId,
            currentUserId,
            pathname,
          });
          return;
        }
        lastSessionUserIdRef.current = currentUserId;
      } catch (error) {
        console.error("[Auth] Failed to sync session principal for cache guard", error);
      }
    };

    const runSync = () => {
      void syncSessionUser();
    };

    runSync();
    const interval = window.setInterval(runSync, 10_000);
    const onFocus = () => runSync();
    const onVisibilityChange = () => {
      if (!document.hidden) {
        runSync();
      }
    };

    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      active = false;
      window.clearInterval(interval);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [pathname, queryClient]);

  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}
