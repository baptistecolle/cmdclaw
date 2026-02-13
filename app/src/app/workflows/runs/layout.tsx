"use client";

import { Suspense } from "react";
import { SidebarInset, SidebarProvider } from "@/components/animate-ui/components/radix/sidebar";
import { WorkflowRunsSidebar } from "@/components/workflows/workflow-runs-sidebar";

export default function WorkflowRunsLayout({ children }: { children: React.ReactNode }) {
  return (
    <SidebarProvider className="bg-background text-foreground h-full min-h-0 [--sidebar-width:20rem]">
      <Suspense fallback={null}>
        <WorkflowRunsSidebar />
      </Suspense>
      <SidebarInset className="min-h-0 min-w-0 overflow-hidden">
        <main className="flex min-h-0 min-w-0 flex-1 flex-col">{children}</main>
      </SidebarInset>
    </SidebarProvider>
  );
}
