"use client";

export default function WorkflowRunsIndexPage() {
  return (
    <div className="flex h-full items-center justify-center p-6">
      <div className="text-center">
        <h2 className="text-lg font-semibold">Select a workflow run</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Choose a run from the sidebar to open its chat-style view.
        </p>
      </div>
    </div>
  );
}
