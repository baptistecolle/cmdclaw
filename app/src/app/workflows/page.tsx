"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import {
  useWorkflowList,
  useCreateWorkflow,
  useUpdateWorkflow,
  useDeleteWorkflow,
  useTriggerWorkflow,
} from "@/orpc/hooks";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { getWorkflowRunStatusLabel } from "@/lib/workflow-status";
import {
  INTEGRATION_DISPLAY_NAMES,
  type IntegrationType,
} from "@/lib/integration-icons";
import {
  Loader2,
  Plus,
  Pencil,
  Trash2,
  Play,
  CheckCircle2,
  XCircle,
} from "lucide-react";

function formatDate(value?: Date | string | null) {
  if (!value) return "—";
  const date = typeof value === "string" ? new Date(value) : value;
  return date.toLocaleString();
}

export default function WorkflowsPage() {
  const { data: workflows, isLoading, refetch } = useWorkflowList();
  const createWorkflow = useCreateWorkflow();
  const updateWorkflow = useUpdateWorkflow();
  const deleteWorkflow = useDeleteWorkflow();
  const triggerWorkflow = useTriggerWorkflow();

  const [isCreating, setIsCreating] = useState(false);
  const [notification, setNotification] = useState<{
    type: "success" | "error";
    message: string;
  } | null>(null);
  const [workflowToDelete, setWorkflowToDelete] = useState<{
    id: string;
    name: string;
  } | null>(null);
  const [expandedRunsByWorkflow, setExpandedRunsByWorkflow] = useState<
    Record<string, boolean>
  >({});

  useEffect(() => {
    if (!notification) return;
    const timer = setTimeout(() => setNotification(null), 5000);
    return () => clearTimeout(timer);
  }, [notification]);

  const handleCreate = async () => {
    setIsCreating(true);
    try {
      const result = await createWorkflow.mutateAsync({
        name: "",
        triggerType: "schedule",
        prompt: "",
        allowedIntegrations: Object.keys(
          INTEGRATION_DISPLAY_NAMES,
        ) as IntegrationType[],
      });
      window.location.href = `/workflows/${result.id}`;
    } catch (error) {
      console.error("Failed to create workflow:", error);
      setNotification({
        type: "error",
        message: "Failed to create workflow. Please try again.",
      });
      setIsCreating(false);
    }
  };

  const handleToggle = async (id: string, status: "on" | "off") => {
    try {
      await updateWorkflow.mutateAsync({ id, status });
      refetch();
    } catch (error) {
      console.error("Failed to toggle workflow:", error);
    }
  };

  const handleDelete = async () => {
    if (!workflowToDelete) return;
    try {
      await deleteWorkflow.mutateAsync(workflowToDelete.id);
      setNotification({
        type: "success",
        message: `Workflow "${workflowToDelete.name}" deleted.`,
      });
      setWorkflowToDelete(null);
      refetch();
    } catch (error) {
      console.error("Failed to delete workflow:", error);
      setNotification({
        type: "error",
        message: "Failed to delete workflow.",
      });
    }
  };

  const handleRun = async (id: string) => {
    try {
      await triggerWorkflow.mutateAsync({ id, payload: {} });
      setNotification({
        type: "success",
        message: "Workflow run started.",
      });
      refetch();
    } catch (error) {
      console.error("Failed to run workflow:", error);
      setNotification({
        type: "error",
        message: "Failed to run workflow. Check rate limit or status.",
      });
    }
  };

  const workflowList = Array.isArray(workflows) ? workflows : [];
  const getWorkflowDisplayName = (name?: string | null) => {
    const trimmed = name?.trim();
    return trimmed && trimmed.length > 0 ? trimmed : "New Workflow";
  };

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold">Workflows</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Automate agent runs based on external triggers.
          </p>
        </div>
        <Button onClick={handleCreate} disabled={isCreating}>
          {isCreating ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <Plus className="mr-2 h-4 w-4" />
          )}
          New Workflow
        </Button>
      </div>

      {notification && (
        <div
          className={cn(
            "mb-6 flex items-center gap-2 rounded-lg border p-4",
            notification.type === "success"
              ? "border-green-500/50 bg-green-500/10 text-green-700 dark:text-green-400"
              : "border-red-500/50 bg-red-500/10 text-red-700 dark:text-red-400",
          )}
        >
          {notification.type === "success" ? (
            <CheckCircle2 className="h-5 w-5" />
          ) : (
            <XCircle className="h-5 w-5" />
          )}
          {notification.message}
        </div>
      )}

      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin" />
        </div>
      ) : workflowList.length === 0 ? (
        <div className="rounded-lg border border-dashed p-12 text-center">
          <h3 className="text-lg font-medium">No workflows yet</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            Create your first workflow to run agents automatically.
          </p>
          <Button className="mt-4" onClick={handleCreate} disabled={isCreating}>
            {isCreating ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Plus className="mr-2 h-4 w-4" />
            )}
            New Workflow
          </Button>
        </div>
      ) : (
        <div className="space-y-7">
          {workflowList.map((wf) => (
            <div
              key={wf.id}
              className="rounded-md border border-border/30 bg-background/70 px-5 py-6 shadow-[0_1px_2px_rgba(0,0,0,0.03)] transition-colors hover:bg-muted/20"
            >
              {(() => {
                const recentRuns = Array.isArray(wf.recentRuns)
                  ? wf.recentRuns
                  : [];
                const isExpanded = !!expandedRunsByWorkflow[wf.id];
                const visibleRuns = isExpanded
                  ? recentRuns
                  : recentRuns.slice(0, 1);
                const hiddenCount = Math.max(
                  0,
                  recentRuns.length - visibleRuns.length,
                );

                return (
                  <>
                    <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                      <div>
                        <div className="flex flex-wrap items-center gap-2">
                          <h3 className="font-medium">
                            {getWorkflowDisplayName(wf.name)}
                          </h3>
                          <span className="rounded-full bg-muted/60 px-2 py-0.5 text-xs text-muted-foreground">
                            {wf.triggerType}
                          </span>
                        </div>
                        <div className="mt-1.5 text-xs text-muted-foreground">
                          Last run:{" "}
                          {wf.lastRunStatus
                            ? getWorkflowRunStatusLabel(wf.lastRunStatus)
                            : "—"}{" "}
                          · {formatDate(wf.lastRunAt)}
                        </div>
                      </div>

                      <div className="flex flex-wrap items-center gap-2">
                        <div className="flex items-center gap-2 rounded-full bg-muted/50 px-2.5 py-1">
                          <Switch
                            checked={wf.status === "on"}
                            onCheckedChange={(checked) =>
                              handleToggle(wf.id, checked ? "on" : "off")
                            }
                          />
                          <span className="text-sm">
                            {wf.status === "on" ? "On" : "Off"}
                          </span>
                        </div>
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={() => handleRun(wf.id)}
                          disabled={wf.status !== "on"}
                        >
                          <Play className="mr-2 h-4 w-4" />
                          Run
                        </Button>
                        <Button variant="ghost" size="icon" asChild>
                          <Link href={`/workflows/${wf.id}`}>
                            <Pencil className="h-4 w-4" />
                          </Link>
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() =>
                            setWorkflowToDelete({
                              id: wf.id,
                              name: getWorkflowDisplayName(wf.name),
                            })
                          }
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>

                    <div className="mt-4 space-y-2">
                      <div className="text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground/80">
                        Recent runs
                      </div>
                      {recentRuns.length > 0 ? (
                        <div className="space-y-2">
                          {visibleRuns.map((run) => (
                            <Link
                              key={run.id}
                              href={`/workflows/runs/${run.id}`}
                              className="flex items-center justify-between rounded-md px-2 py-1 text-sm text-muted-foreground transition-colors hover:bg-muted/45 hover:text-foreground"
                            >
                              <div className="flex items-center gap-2">
                                <span className="text-xs capitalize text-muted-foreground">
                                  {run.source}
                                </span>
                                <span>
                                  {getWorkflowRunStatusLabel(run.status)}
                                </span>
                              </div>
                              <span className="text-xs text-muted-foreground">
                                {formatDate(run.startedAt)}
                              </span>
                            </Link>
                          ))}
                          {hiddenCount > 0 ? (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-8 px-2 text-xs"
                              onClick={() =>
                                setExpandedRunsByWorkflow((prev) => ({
                                  ...prev,
                                  [wf.id]: true,
                                }))
                              }
                            >
                              Show {hiddenCount} more
                            </Button>
                          ) : null}
                          {isExpanded && recentRuns.length > 1 ? (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-8 px-2 text-xs"
                              onClick={() =>
                                setExpandedRunsByWorkflow((prev) => ({
                                  ...prev,
                                  [wf.id]: false,
                                }))
                              }
                            >
                              Show less
                            </Button>
                          ) : null}
                        </div>
                      ) : (
                        <div className="text-sm text-muted-foreground">
                          No runs yet.
                        </div>
                      )}
                    </div>
                  </>
                );
              })()}
            </div>
          ))}
        </div>
      )}

      {workflowToDelete && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4"
          onClick={() => setWorkflowToDelete(null)}
        >
          <div
            className="w-full max-w-md rounded-lg border bg-background p-6 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-lg font-semibold">Delete workflow?</h3>
            <p className="mt-2 text-sm text-muted-foreground">
              This will permanently delete &quot;{workflowToDelete.name}&quot;
              and cannot be undone.
            </p>
            <div className="mt-6 flex items-center justify-end gap-2">
              <Button
                variant="ghost"
                onClick={() => setWorkflowToDelete(null)}
                disabled={deleteWorkflow.isPending}
              >
                Cancel
              </Button>
              <Button
                variant="destructive"
                onClick={handleDelete}
                disabled={deleteWorkflow.isPending}
              >
                {deleteWorkflow.isPending ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : null}
                Delete
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
