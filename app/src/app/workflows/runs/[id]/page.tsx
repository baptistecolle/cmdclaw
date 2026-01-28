"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useWorkflowRun } from "@/orpc/hooks";
import { Button } from "@/components/ui/button";
import { Loader2, ArrowLeft } from "lucide-react";

function formatDate(value?: Date | string | null) {
  if (!value) return "—";
  const date = typeof value === "string" ? new Date(value) : value;
  return date.toLocaleString();
}

export default function WorkflowRunPage() {
  const params = useParams<{ id: string }>();
  const runId = params?.id;
  const { data: run, isLoading } = useWorkflowRun(runId);

  if (isLoading || !run) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-6 w-6 animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" asChild>
            <Link href={`/workflows/${run.workflowId}`}>
              <ArrowLeft className="h-4 w-4" />
            </Link>
          </Button>
          <div>
            <h2 className="text-xl font-semibold">Run {run.id.slice(0, 8)}</h2>
            <p className="text-sm text-muted-foreground">
              Status: {run.status} · Started {formatDate(run.startedAt)}
            </p>
          </div>
        </div>
        <div className="text-sm text-muted-foreground">
          Finished: {formatDate(run.finishedAt)}
        </div>
      </div>

      <div className="rounded-lg border p-4">
        <h3 className="text-sm font-semibold">Trigger payload</h3>
        <pre className="mt-2 max-h-64 overflow-auto rounded-md bg-muted p-3 text-xs">
          {JSON.stringify(run.triggerPayload ?? {}, null, 2)}
        </pre>
      </div>

      <div className="rounded-lg border p-4">
        <h3 className="text-sm font-semibold">Timeline</h3>
        <div className="mt-3 space-y-3">
          {run.events.length === 0 ? (
            <p className="text-sm text-muted-foreground">No events recorded.</p>
          ) : (
            run.events.map((event) => (
              <div key={event.id} className="rounded-md border p-3 text-sm">
                <div className="flex items-center justify-between">
                  <span className="font-medium">{event.type}</span>
                  <span className="text-xs text-muted-foreground">
                    {formatDate(event.createdAt)}
                  </span>
                </div>
                <pre className="mt-2 max-h-56 overflow-auto rounded-md bg-muted p-2 text-xs">
                  {JSON.stringify(event.payload ?? {}, null, 2)}
                </pre>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
