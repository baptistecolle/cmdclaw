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
import { Loader2, Plus, Pencil, Trash2, Play, CheckCircle2, XCircle } from "lucide-react";

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

  useEffect(() => {
    if (!notification) return;
    const timer = setTimeout(() => setNotification(null), 5000);
    return () => clearTimeout(timer);
  }, [notification]);

  const handleCreate = async () => {
    setIsCreating(true);
    try {
      const result = await createWorkflow.mutateAsync({
        name: "New Workflow",
        triggerType: "gmail.new_email",
        prompt: "Describe what the agent should do when this trigger fires.",
        allowedIntegrations: [],
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

  const handleDelete = async (id: string, name: string) => {
    if (!confirm(`Delete workflow "${name}"?`)) return;
    try {
      await deleteWorkflow.mutateAsync(id);
      setNotification({
        type: "success",
        message: `Workflow "${name}" deleted.`,
      });
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
              : "border-red-500/50 bg-red-500/10 text-red-700 dark:text-red-400"
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
        <div className="space-y-4">
          {workflowList.map((wf) => (
            <div
              key={wf.id}
              className="flex flex-col gap-3 rounded-lg border p-4 md:flex-row md:items-center md:justify-between"
            >
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="font-medium">{wf.name}</h3>
                  <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                    {wf.triggerType}
                  </span>
                </div>
                <div className="mt-2 text-xs text-muted-foreground">
                  Last run: {wf.lastRunStatus ?? "—"} · {formatDate(wf.lastRunAt)}
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <div className="flex items-center gap-2">
                  <Switch
                    checked={wf.status === "on"}
                    onCheckedChange={(checked) =>
                      handleToggle(wf.id, checked ? "on" : "off")
                    }
                  />
                  <span className="text-sm">{wf.status === "on" ? "On" : "Off"}</span>
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
                  onClick={() => handleDelete(wf.id, wf.name)}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
