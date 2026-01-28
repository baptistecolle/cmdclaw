"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import {
  useWorkflow,
  useUpdateWorkflow,
  useWorkflowRuns,
  useTriggerWorkflow,
} from "@/orpc/hooks";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";
import {
  INTEGRATION_DISPLAY_NAMES,
  INTEGRATION_ICONS,
  type IntegrationType,
} from "@/lib/integration-icons";
import { Loader2, Play, ArrowLeft } from "lucide-react";

const TRIGGERS = [
  { value: "gmail.new_email", label: "New Gmail email" },
  { value: "hubspot.new_contact", label: "New HubSpot contact" },
];

function formatDate(value?: Date | string | null) {
  if (!value) return "—";
  const date = typeof value === "string" ? new Date(value) : value;
  return date.toLocaleString();
}

export default function WorkflowEditorPage() {
  const params = useParams<{ id: string }>();
  const workflowId = params?.id;
  const { data: workflow, isLoading } = useWorkflow(workflowId);
  const { data: runs } = useWorkflowRuns(workflowId);
  const updateWorkflow = useUpdateWorkflow();
  const triggerWorkflow = useTriggerWorkflow();

  const [name, setName] = useState("");
  const [triggerType, setTriggerType] = useState(TRIGGERS[0].value);
  const [prompt, setPrompt] = useState("");
  const [promptDo, setPromptDo] = useState("");
  const [promptDont, setPromptDont] = useState("");
  const [allowedIntegrations, setAllowedIntegrations] = useState<IntegrationType[]>([]);
  const [status, setStatus] = useState<"on" | "off">("off");
  const [saving, setSaving] = useState(false);
  const [notification, setNotification] = useState<{
    type: "success" | "error";
    message: string;
  } | null>(null);

  useEffect(() => {
    if (!workflow) return;
    setName(workflow.name);
    setTriggerType(workflow.triggerType);
    setPrompt(workflow.prompt);
    setPromptDo(workflow.promptDo ?? "");
    setPromptDont(workflow.promptDont ?? "");
    setAllowedIntegrations((workflow.allowedIntegrations ?? []) as IntegrationType[]);
    setStatus(workflow.status);
  }, [workflow]);

  useEffect(() => {
    if (!notification) return;
    const timer = setTimeout(() => setNotification(null), 4000);
    return () => clearTimeout(timer);
  }, [notification]);

  const integrationEntries = useMemo(
    () =>
      (Object.keys(INTEGRATION_DISPLAY_NAMES) as IntegrationType[]).map((key) => ({
        key,
        name: INTEGRATION_DISPLAY_NAMES[key],
        Icon: INTEGRATION_ICONS[key],
      })),
    []
  );

  const toggleIntegration = (type: IntegrationType) => {
    setAllowedIntegrations((prev) =>
      prev.includes(type) ? prev.filter((t) => t !== type) : [...prev, type]
    );
  };

  const handleSave = async () => {
    if (!workflowId) return;
    setSaving(true);
    try {
      await updateWorkflow.mutateAsync({
        id: workflowId,
        name,
        status,
        triggerType,
        prompt,
        promptDo: promptDo || null,
        promptDont: promptDont || null,
        allowedIntegrations,
      });
      setNotification({ type: "success", message: "Workflow saved." });
    } catch (error) {
      console.error("Failed to update workflow:", error);
      setNotification({ type: "error", message: "Failed to save workflow." });
    } finally {
      setSaving(false);
    }
  };

  const handleRun = async () => {
    if (!workflowId) return;
    try {
      await triggerWorkflow.mutateAsync({ id: workflowId, payload: {} });
      setNotification({ type: "success", message: "Workflow run started." });
    } catch (error) {
      console.error("Failed to run workflow:", error);
      setNotification({ type: "error", message: "Failed to start run." });
    }
  };

  if (isLoading || !workflow) {
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
            <Link href="/workflows">
              <ArrowLeft className="h-4 w-4" />
            </Link>
          </Button>
          <div>
            <h2 className="text-xl font-semibold">{workflow.name}</h2>
            <p className="text-sm text-muted-foreground">
              Configure trigger, agent instructions, and allowed tools.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="secondary" onClick={handleRun} disabled={status !== "on"}>
            <Play className="mr-2 h-4 w-4" />
            Run now
          </Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            Save
          </Button>
        </div>
      </div>

      {notification && (
        <div
          className={cn(
            "rounded-lg border px-4 py-3 text-sm",
            notification.type === "success"
              ? "border-green-500/40 bg-green-500/10 text-green-700 dark:text-green-400"
              : "border-red-500/40 bg-red-500/10 text-red-700 dark:text-red-400"
          )}
        >
          {notification.message}
        </div>
      )}

      <div className="rounded-lg border p-6 space-y-6">
        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-2">
            <label className="text-sm font-medium">Name</label>
            <input
              className="h-9 w-full rounded-md border bg-transparent px-3 text-sm"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium">Trigger</label>
            <select
              className="h-9 w-full rounded-md border bg-transparent px-3 text-sm"
              value={triggerType}
              onChange={(e) => setTriggerType(e.target.value)}
            >
              {TRIGGERS.map((trigger) => (
                <option key={trigger.value} value={trigger.value}>
                  {trigger.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="space-y-2">
          <label className="text-sm font-medium">Agent instructions</label>
          <textarea
            className="min-h-[120px] w-full rounded-md border bg-transparent px-3 py-2 text-sm"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
          />
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-2">
            <label className="text-sm font-medium">Do</label>
            <textarea
              className="min-h-[90px] w-full rounded-md border bg-transparent px-3 py-2 text-sm"
              value={promptDo}
              onChange={(e) => setPromptDo(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium">Don't</label>
            <textarea
              className="min-h-[90px] w-full rounded-md border bg-transparent px-3 py-2 text-sm"
              value={promptDont}
              onChange={(e) => setPromptDont(e.target.value)}
            />
          </div>
        </div>

        <div className="space-y-3">
          <label className="text-sm font-medium">Allowed tools</label>
          <div className="grid gap-3 md:grid-cols-2">
            {integrationEntries.map(({ key, name: label, Icon }) => (
              <label
                key={key}
                className="flex items-center gap-3 rounded-md border p-3 text-sm"
              >
                <Checkbox
                  checked={allowedIntegrations.includes(key)}
                  onCheckedChange={() => toggleIntegration(key)}
                />
                <Icon className="h-4 w-4 text-muted-foreground" />
                <span>{label}</span>
              </label>
            ))}
          </div>
        </div>

        <div className="flex items-center gap-3">
          <Switch
            checked={status === "on"}
            onCheckedChange={(checked) => setStatus(checked ? "on" : "off")}
          />
          <span className="text-sm">
            {status === "on" ? "Workflow is on" : "Workflow is off"}
          </span>
        </div>
      </div>

      <div className="rounded-lg border p-6">
        <div className="mb-4 flex items-center justify-between">
          <div>
            <h3 className="text-sm font-semibold">Recent runs</h3>
            <p className="text-xs text-muted-foreground">
              Latest workflow runs and their status.
            </p>
          </div>
          <Button variant="ghost" size="sm" asChild>
            <Link href={`/workflows/${workflowId}`}>Refresh</Link>
          </Button>
        </div>
        {runs && runs.length > 0 ? (
          <div className="space-y-2">
            {runs.map((run) => (
              <Link
                key={run.id}
                href={`/workflows/runs/${run.id}`}
                className="flex items-center justify-between rounded-md border px-3 py-2 text-sm hover:bg-muted"
              >
                <span>{run.status}</span>
                <span className="text-xs text-muted-foreground">
                  {formatDate(run.startedAt)}
                </span>
              </Link>
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">No runs yet.</p>
        )}
      </div>
    </div>
  );
}
