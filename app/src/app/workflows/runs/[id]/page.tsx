"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useWorkflowRun } from "@/orpc/hooks";
import { ChatArea } from "@/components/chat/chat-area";
import { Button } from "@/components/ui/button";
import { Loader2, ArrowLeft } from "lucide-react";

export default function WorkflowRunPage() {
  const params = useParams<{ id: string }>();
  const runId = params?.id;
  const { data: run, isLoading } = useWorkflowRun(runId);

  if (isLoading) {
    return (
      <div className="flex h-full min-h-0 flex-col">
        <div className="flex items-center gap-3 border-b px-4 py-2">
          <div className="h-9 w-9" />
          <div>
            <h2 className="text-sm font-medium">Workflow run</h2>
            <p className="font-mono text-xs text-muted-foreground">ID: {runId}</p>
          </div>
        </div>
        <div className="flex min-h-0 flex-1 items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin" />
        </div>
      </div>
    );
  }

  if (!run) {
    return <div className="p-6 text-sm text-muted-foreground">Run not found.</div>;
  }

  if (!run.conversationId) {
    return (
      <div className="space-y-4 p-6">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" asChild>
            <Link href={`/workflows/${run.workflowId}`}>
              <ArrowLeft className="h-4 w-4" />
            </Link>
          </Button>
          <h2 className="text-lg font-semibold">Run details unavailable in chat view</h2>
        </div>
        <p className="text-sm text-muted-foreground">
          This run does not have a linked conversation, so it cannot be opened in the chat
          interface.
        </p>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-3 border-b px-4 py-2">
        <Button variant="ghost" size="icon" asChild>
          <Link href={`/workflows/${run.workflowId}`}>
            <ArrowLeft className="h-4 w-4" />
          </Link>
        </Button>
        <div>
          <h2 className="text-sm font-medium">Workflow run</h2>
          <p className="text-xs text-muted-foreground font-mono">ID: {run.id}</p>
        </div>
      </div>
      <div className="flex min-h-0 flex-1 overflow-hidden bg-background">
        <ChatArea conversationId={run.conversationId} />
      </div>
    </div>
  );
}
