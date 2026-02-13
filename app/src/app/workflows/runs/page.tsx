"use client";

import { SidebarTrigger } from "@/components/animate-ui/components/radix/sidebar";

export default function WorkflowRunsIndexPage() {
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-12 items-center gap-2 border-b px-3 sm:px-4">
        <SidebarTrigger className="md:hidden" />
        <span className="text-sm font-medium">Workflow runs</span>
      </div>
      <div className="flex flex-1 items-center justify-center p-6">
        <div className="text-center">
          <h2 className="text-lg font-semibold">Select a workflow run</h2>
          <p className="text-muted-foreground mt-1 text-sm">
            Choose a run from the sidebar to open its chat-style view.
          </p>
        </div>
      </div>
    </div>
  );
}
