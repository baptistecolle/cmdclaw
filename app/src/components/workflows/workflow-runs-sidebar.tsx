"use client";

import Link from "next/link";
import { useMemo } from "react";
import { usePathname } from "next/navigation";
import { useWorkflowList } from "@/orpc/hooks";
import { cn } from "@/lib/utils";
import { getWorkflowRunStatusLabel } from "@/lib/workflow-status";

function formatDate(value?: Date | string | null) {
  if (!value) return "—";
  const date = typeof value === "string" ? new Date(value) : value;
  return date.toLocaleString();
}

type WorkflowListItem = {
  id: string;
  name: string;
  recentRuns?: Array<{
    id: string;
    status: string;
    startedAt?: Date | string | null;
    source?: string;
  }>;
};

export function WorkflowRunsSidebar() {
  const pathname = usePathname();
  const { data, isLoading } = useWorkflowList();

  const workflows = useMemo(() => {
    const list = Array.isArray(data) ? (data as WorkflowListItem[]) : [];
    return list.filter((wf) => Array.isArray(wf.recentRuns) && wf.recentRuns.length > 0);
  }, [data]);

  return (
    <aside className="flex h-full w-80 shrink-0 flex-col border-r bg-muted/20">
      <div className="border-b px-4 py-3">
        <h2 className="text-sm font-semibold">Workflow runs</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Grouped by workflow
        </p>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-2 py-3">
        {isLoading ? (
          <div className="px-2 py-4 text-sm text-muted-foreground">Loading runs...</div>
        ) : workflows.length === 0 ? (
          <div className="px-2 py-4 text-sm text-muted-foreground">No runs yet.</div>
        ) : (
          <div className="space-y-3">
            {workflows.map((wf) => (
              <section key={wf.id} className="space-y-1">
                <Link
                  href={`/workflows/${wf.id}`}
                  className="block rounded-md px-2 py-1.5 text-sm font-medium hover:bg-muted"
                >
                  {wf.name}
                </Link>

                <div className="space-y-1 pl-2">
                  {(wf.recentRuns ?? []).map((run) => {
                    const href = `/workflows/runs/${run.id}`;
                    const isActive = pathname === href;
                    return (
                      <Link
                        key={run.id}
                        href={href}
                        className={cn(
                          "block rounded-md px-2 py-1.5 text-xs transition-colors",
                          isActive
                            ? "bg-muted"
                            : "hover:bg-muted/70"
                        )}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-medium">{getWorkflowRunStatusLabel(run.status)}</span>
                          <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
                            {run.source ?? "run"}
                          </span>
                        </div>
                        <div className="mt-1 text-[11px] text-muted-foreground">
                          {formatDate(run.startedAt)}
                        </div>
                      </Link>
                    );
                  })}
                </div>
              </section>
            ))}
          </div>
        )}
      </div>
    </aside>
  );
}
