"use client";

import { AppShell } from "@/components/app-shell";
import { usePathname } from "next/navigation";

export default function WorkflowsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const isRunsRoute = pathname?.startsWith("/workflows/runs");

  return (
    <AppShell>
      {isRunsRoute ? (
        <div className="flex h-full min-h-0 w-full flex-1 overflow-hidden bg-background">{children}</div>
      ) : (
        <div className="min-h-screen bg-background">
          <div className="container px-4 py-6">
            <main className="mx-auto w-full max-w-[1500px]">{children}</main>
          </div>
        </div>
      )}
    </AppShell>
  );
}
