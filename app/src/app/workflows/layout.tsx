"use client";

import { usePathname } from "next/navigation";
import { AppShell } from "@/components/app-shell";

export default function WorkflowsLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isRunsRoute = pathname?.startsWith("/workflows/runs");
  const isWorkflowEditorRoute =
    pathname?.startsWith("/workflows/") && pathname !== "/workflows" && !isRunsRoute;

  return (
    <AppShell>
      {isRunsRoute || isWorkflowEditorRoute ? (
        <div className="bg-background flex h-full min-h-0 w-full flex-1 overflow-hidden">
          {children}
        </div>
      ) : (
        <div className="bg-background min-h-screen">
          <div className="container px-4 py-6">
            <main className="mx-auto w-full max-w-[1500px]">{children}</main>
          </div>
        </div>
      )}
    </AppShell>
  );
}
