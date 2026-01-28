"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import {
  useWorkflow,
  useUpdateWorkflow,
  useWorkflowRuns,
  useTriggerWorkflow,
  type WorkflowSchedule,
} from "@/orpc/hooks";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";
import {
  INTEGRATION_DISPLAY_NAMES,
  INTEGRATION_LOGOS,
  type IntegrationType,
} from "@/lib/integration-icons";
import { Loader2, Play, ArrowLeft, ChevronDown, ChevronUp } from "lucide-react";

const TRIGGERS = [
  { value: "schedule", label: "Run on a schedule" },
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
  const [allowedIntegrations, setAllowedIntegrations] = useState<IntegrationType[]>([]);
  const [status, setStatus] = useState<"on" | "off">("off");
  const [saving, setSaving] = useState(false);
  const [showAllIntegrations, setShowAllIntegrations] = useState(false);
  const [notification, setNotification] = useState<{
    type: "success" | "error";
    message: string;
  } | null>(null);

  // Schedule state (only used when triggerType is "schedule")
  const [scheduleType, setScheduleType] = useState<"interval" | "daily" | "weekly" | "monthly">("daily");
  const [intervalMinutes, setIntervalMinutes] = useState(60);
  const [scheduleTime, setScheduleTime] = useState("09:00");
  const [scheduleDaysOfWeek, setScheduleDaysOfWeek] = useState<number[]>([1, 2, 3, 4, 5]); // Mon-Fri
  const [scheduleDayOfMonth, setScheduleDayOfMonth] = useState(1);

  useEffect(() => {
    if (!workflow) return;
    setName(workflow.name);
    setTriggerType(workflow.triggerType);
    setPrompt(workflow.prompt);
    setAllowedIntegrations((workflow.allowedIntegrations ?? []) as IntegrationType[]);
    setStatus(workflow.status);

    // Initialize schedule state (when trigger is "schedule")
    const schedule = workflow.schedule as WorkflowSchedule | null;
    if (schedule) {
      setScheduleType(schedule.type);
      if (schedule.type === "interval") {
        setIntervalMinutes(schedule.intervalMinutes);
      } else if (schedule.type === "daily") {
        setScheduleTime(schedule.time);
      } else if (schedule.type === "weekly") {
        setScheduleTime(schedule.time);
        setScheduleDaysOfWeek(schedule.daysOfWeek);
      } else if (schedule.type === "monthly") {
        setScheduleTime(schedule.time);
        setScheduleDayOfMonth(schedule.dayOfMonth);
      }
    }
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
        logo: INTEGRATION_LOGOS[key],
      })),
    []
  );

  const toggleIntegration = (type: IntegrationType) => {
    setAllowedIntegrations((prev) =>
      prev.includes(type) ? prev.filter((t) => t !== type) : [...prev, type]
    );
  };

  const buildSchedule = (): WorkflowSchedule | null => {
    if (triggerType !== "schedule") return null;

    switch (scheduleType) {
      case "interval":
        return { type: "interval", intervalMinutes };
      case "daily":
        return { type: "daily", time: scheduleTime, timezone: "UTC" };
      case "weekly":
        return { type: "weekly", time: scheduleTime, daysOfWeek: scheduleDaysOfWeek, timezone: "UTC" };
      case "monthly":
        return { type: "monthly", time: scheduleTime, dayOfMonth: scheduleDayOfMonth, timezone: "UTC" };
      default:
        return null;
    }
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
        allowedIntegrations,
        schedule: buildSchedule(),
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

        {triggerType === "schedule" && (
          <div className="rounded-md border p-4 space-y-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">Frequency</label>
              <select
                className="h-9 w-full rounded-md border bg-transparent px-3 text-sm"
                value={scheduleType}
                onChange={(e) => setScheduleType(e.target.value as typeof scheduleType)}
              >
                <option value="interval">Every X minutes/hours</option>
                <option value="daily">Daily</option>
                <option value="weekly">Weekly</option>
                <option value="monthly">Monthly</option>
              </select>
            </div>

            {scheduleType === "interval" && (
              <div className="space-y-2">
                <label className="text-sm font-medium">Run every</label>
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    min={1}
                    max={10080}
                    className="h-9 w-24 rounded-md border bg-transparent px-3 text-sm"
                    value={intervalMinutes}
                    onChange={(e) => setIntervalMinutes(Math.max(1, parseInt(e.target.value) || 1))}
                  />
                  <select
                    className="h-9 rounded-md border bg-transparent px-3 text-sm"
                    value={intervalMinutes >= 60 && intervalMinutes % 60 === 0 ? "hours" : "minutes"}
                    onChange={(e) => {
                      if (e.target.value === "hours") {
                        setIntervalMinutes(Math.max(1, Math.round(intervalMinutes / 60)) * 60);
                      }
                    }}
                  >
                    <option value="minutes">minutes</option>
                    <option value="hours">hours</option>
                  </select>
                </div>
              </div>
            )}

            {(scheduleType === "daily" || scheduleType === "weekly" || scheduleType === "monthly") && (
              <div className="space-y-2">
                <label className="text-sm font-medium">Time (UTC)</label>
                <input
                  type="time"
                  className="h-9 w-32 rounded-md border bg-transparent px-3 text-sm"
                  value={scheduleTime}
                  onChange={(e) => setScheduleTime(e.target.value)}
                />
              </div>
            )}

            {scheduleType === "weekly" && (
              <div className="space-y-2">
                <label className="text-sm font-medium">Days of the week</label>
                <div className="flex flex-wrap gap-2">
                  {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((day, index) => (
                    <button
                      key={day}
                      type="button"
                      className={cn(
                        "h-9 w-12 rounded-md border text-sm font-medium transition-colors",
                        scheduleDaysOfWeek.includes(index)
                          ? "bg-primary text-primary-foreground border-primary"
                          : "bg-transparent hover:bg-muted"
                      )}
                      onClick={() => {
                        setScheduleDaysOfWeek((prev) =>
                          prev.includes(index)
                            ? prev.filter((d) => d !== index)
                            : [...prev, index].sort()
                        );
                      }}
                    >
                      {day}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {scheduleType === "monthly" && (
              <div className="space-y-2">
                <label className="text-sm font-medium">Day of the month</label>
                <select
                  className="h-9 w-24 rounded-md border bg-transparent px-3 text-sm"
                  value={scheduleDayOfMonth}
                  onChange={(e) => setScheduleDayOfMonth(parseInt(e.target.value))}
                >
                  {Array.from({ length: 31 }, (_, i) => i + 1).map((day) => (
                    <option key={day} value={day}>
                      {day}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>
        )}

        <div className="space-y-2">
          <label className="text-sm font-medium">Agent instructions</label>
          <textarea
            className="min-h-[120px] w-full rounded-md border bg-transparent px-3 py-2 text-sm"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
          />
        </div>

        <div className="space-y-3">
          <label className="text-sm font-medium">Allowed tools</label>
          <div className="grid gap-3 md:grid-cols-2">
            {(showAllIntegrations ? integrationEntries : integrationEntries.slice(0, 4)).map(({ key, name: label, logo }) => (
              <label
                key={key}
                className="flex items-center gap-3 rounded-md border p-3 text-sm"
              >
                <Checkbox
                  checked={allowedIntegrations.includes(key)}
                  onCheckedChange={() => toggleIntegration(key)}
                />
                <img src={logo} alt={label} className="h-4 w-4" />
                <span>{label}</span>
              </label>
            ))}
          </div>
          {integrationEntries.length > 4 && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setShowAllIntegrations(!showAllIntegrations)}
              className="text-muted-foreground"
            >
              {showAllIntegrations ? (
                <>
                  <ChevronUp className="mr-1 h-4 w-4" />
                  Show less
                </>
              ) : (
                <>
                  <ChevronDown className="mr-1 h-4 w-4" />
                  Show more ({integrationEntries.length - 4} more)
                </>
              )}
            </Button>
          )}
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
