"use client";

import { Loader2, Plus, Pencil, Trash2, Play, CheckCircle2, XCircle } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { WORKFLOW_AVAILABLE_INTEGRATION_TYPES } from "@/lib/integration-icons";
import { cn } from "@/lib/utils";
import { getWorkflowRunStatusLabel } from "@/lib/workflow-status";
import {
  useWorkflowList,
  useCreateWorkflow,
  useUpdateWorkflow,
  useDeleteWorkflow,
  useTriggerWorkflow,
} from "@/orpc/hooks";

function formatDate(value?: Date | string | null) {
  if (!value) {
    return "—";
  }
  const date = typeof value === "string" ? new Date(value) : value;
  return date.toLocaleString();
}

function getWorkflowDisplayName(name?: string | null) {
  const trimmed = name?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : "New Workflow";
}

function WorkflowStatusSwitch({
  checked,
  workflowId,
  onToggle,
}: {
  checked: boolean;
  workflowId: string;
  onToggle: (id: string, status: "on" | "off") => Promise<void>;
}) {
  const handleCheckedChange = useCallback(
    (value: boolean) => {
      void onToggle(workflowId, value ? "on" : "off");
    },
    [onToggle, workflowId],
  );

  return <Switch checked={checked} onCheckedChange={handleCheckedChange} />;
}

function WorkflowRunButton({
  workflowId,
  disabled,
  onRun,
}: {
  workflowId: string;
  disabled: boolean;
  onRun: (id: string) => Promise<void>;
}) {
  const handleClick = useCallback(() => {
    void onRun(workflowId);
  }, [onRun, workflowId]);

  return (
    <Button variant="secondary" size="sm" onClick={handleClick} disabled={disabled}>
      <Play className="mr-2 h-4 w-4" />
      Run
    </Button>
  );
}

function WorkflowDeleteButton({
  workflowId,
  name,
  onRequestDelete,
}: {
  workflowId: string;
  name: string;
  onRequestDelete: (item: { id: string; name: string }) => void;
}) {
  const handleClick = useCallback(() => {
    onRequestDelete({ id: workflowId, name });
  }, [name, onRequestDelete, workflowId]);

  return (
    <Button variant="ghost" size="icon" onClick={handleClick}>
      <Trash2 className="h-4 w-4" />
    </Button>
  );
}

function WorkflowExpandButton({
  workflowId,
  expanded,
  hiddenCount,
  onSetExpanded,
}: {
  workflowId: string;
  expanded: boolean;
  hiddenCount: number;
  onSetExpanded: (id: string, expanded: boolean) => void;
}) {
  const handleExpand = useCallback(() => {
    onSetExpanded(workflowId, true);
  }, [onSetExpanded, workflowId]);

  const handleCollapse = useCallback(() => {
    onSetExpanded(workflowId, false);
  }, [onSetExpanded, workflowId]);

  if (hiddenCount > 0 && !expanded) {
    return (
      <Button variant="ghost" size="sm" className="h-8 px-2 text-xs" onClick={handleExpand}>
        Show {hiddenCount} more
      </Button>
    );
  }

  if (expanded) {
    return (
      <Button variant="ghost" size="sm" className="h-8 px-2 text-xs" onClick={handleCollapse}>
        Show less
      </Button>
    );
  }

  return null;
}

export default function WorkflowsPage() {
  const router = useRouter();
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
  const [expandedRunsByWorkflow, setExpandedRunsByWorkflow] = useState<Record<string, boolean>>({});

  useEffect(() => {
    if (!notification) {
      return;
    }
    const timer = setTimeout(() => setNotification(null), 5000);
    return () => clearTimeout(timer);
  }, [notification]);

  const handleCreate = useCallback(async () => {
    setIsCreating(true);
    try {
      const result = await createWorkflow.mutateAsync({
        name: "",
        triggerType: "manual",
        prompt: "",
        allowedIntegrations: WORKFLOW_AVAILABLE_INTEGRATION_TYPES,
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
  }, [createWorkflow]);

  const handleToggle = useCallback(
    async (id: string, status: "on" | "off") => {
      try {
        await updateWorkflow.mutateAsync({ id, status });
        refetch();
      } catch (error) {
        console.error("Failed to toggle workflow:", error);
      }
    },
    [refetch, updateWorkflow],
  );

  const handleDelete = useCallback(async () => {
    if (!workflowToDelete) {
      return;
    }
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
  }, [deleteWorkflow, refetch, workflowToDelete]);

  const handleRun = useCallback(
    async (id: string) => {
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
    },
    [refetch, triggerWorkflow],
  );

  const handleSetWorkflowToDelete = useCallback((item: { id: string; name: string } | null) => {
    setWorkflowToDelete(item);
  }, []);

  const handleSetExpandedRuns = useCallback((id: string, expanded: boolean) => {
    setExpandedRunsByWorkflow((prev) => ({
      ...prev,
      [id]: expanded,
    }));
  }, []);

  const handleCardClick = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      const workflowId = event.currentTarget.dataset.workflowId;
      if (!workflowId) {
        return;
      }

      const target = event.target;
      if (target instanceof HTMLElement) {
        const interactiveElement = target.closest(
          "a,button,input,textarea,select,label,[role='button'],[role='switch']",
        );
        if (interactiveElement) {
          return;
        }
      }

      router.push(`/workflows/${workflowId}`);
    },
    [router],
  );

  const handleModalOverlayClick = useCallback(() => {
    setWorkflowToDelete(null);
  }, []);

  const handleModalContentClick = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    event.stopPropagation();
  }, []);

  useEffect(() => {
    if (!workflowToDelete) {
      return;
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (deleteWorkflow.isPending) {
        return;
      }
      if (event.key !== "Enter" && event.key !== "NumpadEnter") {
        return;
      }
      event.preventDefault();
      void handleDelete();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [deleteWorkflow.isPending, handleDelete, workflowToDelete]);

  const workflowList = Array.isArray(workflows) ? workflows : [];
  return (
    <div>
      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <h2 className="text-xl font-semibold">Workflows</h2>
          <p className="text-muted-foreground mt-1 text-sm sm:max-w-prose">
            Automate agent runs based on external triggers.
          </p>
        </div>
        <Button onClick={handleCreate} disabled={isCreating} className="self-start">
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
          <p className="text-muted-foreground mt-1 text-sm">
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
              className="border-border/30 bg-background/70 hover:bg-muted/20 cursor-pointer rounded-md border px-5 py-6 shadow-[0_1px_2px_rgba(0,0,0,0.03)] transition-colors"
              data-workflow-id={wf.id}
              onClick={handleCardClick}
            >
              {(() => {
                const recentRuns = Array.isArray(wf.recentRuns) ? wf.recentRuns : [];
                const isExpanded = !!expandedRunsByWorkflow[wf.id];
                const visibleRuns = isExpanded ? recentRuns : recentRuns.slice(0, 1);
                const hiddenCount = Math.max(0, recentRuns.length - visibleRuns.length);

                return (
                  <>
                    <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                      <div>
                        <div className="flex flex-wrap items-center gap-2">
                          <h3 className="font-medium">{getWorkflowDisplayName(wf.name)}</h3>
                          <span className="bg-muted/60 text-muted-foreground rounded-full px-2 py-0.5 text-xs">
                            {wf.triggerType}
                          </span>
                        </div>
                        <div className="text-muted-foreground mt-1.5 text-xs">
                          Last run:{" "}
                          {wf.lastRunStatus ? getWorkflowRunStatusLabel(wf.lastRunStatus) : "—"} ·{" "}
                          {formatDate(wf.lastRunAt)}
                        </div>
                      </div>

                      <div className="flex flex-wrap items-center gap-2">
                        <div className="bg-muted/50 flex items-center gap-2 rounded-full px-2.5 py-1">
                          <WorkflowStatusSwitch
                            checked={wf.status === "on"}
                            workflowId={wf.id}
                            onToggle={handleToggle}
                          />
                          <span className="text-sm">{wf.status === "on" ? "On" : "Off"}</span>
                        </div>
                        <WorkflowRunButton
                          workflowId={wf.id}
                          disabled={wf.status !== "on"}
                          onRun={handleRun}
                        />
                        <Button variant="ghost" size="icon" asChild>
                          <Link href={`/workflows/${wf.id}`}>
                            <Pencil className="h-4 w-4" />
                          </Link>
                        </Button>
                        <WorkflowDeleteButton
                          workflowId={wf.id}
                          name={getWorkflowDisplayName(wf.name)}
                          onRequestDelete={handleSetWorkflowToDelete}
                        />
                      </div>
                    </div>

                    <div className="mt-4 space-y-2">
                      <div className="text-muted-foreground/80 text-[10px] font-medium tracking-[0.14em] uppercase">
                        Recent runs
                      </div>
                      {recentRuns.length > 0 ? (
                        <div className="space-y-2">
                          {visibleRuns.map((run) => (
                            <Link
                              key={run.id}
                              href={`/workflows/runs/${run.id}`}
                              className="text-muted-foreground hover:bg-muted/45 hover:text-foreground flex items-center justify-between rounded-md px-2 py-1 text-sm transition-colors"
                            >
                              <div className="flex items-center gap-2">
                                <span className="text-muted-foreground text-xs capitalize">
                                  {run.source}
                                </span>
                                <span>{getWorkflowRunStatusLabel(run.status)}</span>
                              </div>
                              <span className="text-muted-foreground text-xs">
                                {formatDate(run.startedAt)}
                              </span>
                            </Link>
                          ))}
                          <WorkflowExpandButton
                            workflowId={wf.id}
                            expanded={isExpanded && recentRuns.length > 1}
                            hiddenCount={hiddenCount}
                            onSetExpanded={handleSetExpandedRuns}
                          />
                        </div>
                      ) : (
                        <div className="text-muted-foreground text-sm">No runs yet.</div>
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
          onClick={handleModalOverlayClick}
        >
          <div
            className="bg-background w-full max-w-md rounded-lg border p-6 shadow-xl"
            onClick={handleModalContentClick}
          >
            <h3 className="text-lg font-semibold">Delete workflow?</h3>
            <p className="text-muted-foreground mt-2 text-sm">
              This will permanently delete &quot;{workflowToDelete.name}&quot; and cannot be undone.
            </p>
            <div className="mt-6 flex items-center justify-end gap-2">
              <Button
                variant="ghost"
                onClick={handleModalOverlayClick}
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
