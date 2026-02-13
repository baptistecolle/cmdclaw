"use client";

import { WorkflowRunsSidebar } from "@/components/workflows/workflow-runs-sidebar";

export default function WorkflowRunsLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="bg-background flex h-full min-h-0 w-full flex-1 overflow-hidden">
      <div className="flex h-full min-h-0 w-full flex-1">
        <WorkflowRunsSidebar />
        <main className="flex min-h-0 min-w-0 flex-1 flex-col">{children}</main>
      </div>
    </div>
  );
}
