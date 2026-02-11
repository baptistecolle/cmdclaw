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
import { Input } from "@/components/ui/input";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { getWorkflowRunStatusLabel } from "@/lib/workflow-status";
import {
  INTEGRATION_DISPLAY_NAMES,
  INTEGRATION_LOGOS,
  type IntegrationType,
} from "@/lib/integration-icons";
import { Loader2, Play, ArrowLeft, ChevronDown, ChevronUp } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";

const TRIGGERS = [
  { value: "schedule", label: "Run on a schedule" },
  { value: "gmail.new_email", label: "New Gmail email" },
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
  const [autoApprove, setAutoApprove] = useState(true);
  const [showDisableAutoApproveDialog, setShowDisableAutoApproveDialog] = useState(false);
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
  const localTimezone = useMemo(
    () => Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
    []
  );

  useEffect(() => {
    if (!workflow) return;
    setName(workflow.name);
    setTriggerType(workflow.triggerType);
    setPrompt(workflow.prompt);
    setAllowedIntegrations((workflow.allowedIntegrations ?? []) as IntegrationType[]);
    setStatus(workflow.status);
    setAutoApprove(workflow.autoApprove ?? true);

    // Initialize schedule state (when trigger is "schedule")
    const schedule = workflow.schedule as WorkflowSchedule | null;
    if (schedule) {
      setScheduleType(schedule.type);
      if (schedule.type === "interval") {
        setIntervalMinutes(Math.max(60, schedule.intervalMinutes));
      } else if (schedule.type === "daily") {
        setScheduleTime(schedule.time.slice(0, 5));
      } else if (schedule.type === "weekly") {
        setScheduleTime(schedule.time.slice(0, 5));
        setScheduleDaysOfWeek(schedule.daysOfWeek);
      } else if (schedule.type === "monthly") {
        setScheduleTime(schedule.time.slice(0, 5));
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
        return { type: "interval", intervalMinutes: Math.max(60, Math.round(intervalMinutes / 60) * 60) };
      case "daily":
        return { type: "daily", time: scheduleTime.slice(0, 5), timezone: localTimezone };
      case "weekly":
        return {
          type: "weekly",
          time: scheduleTime.slice(0, 5),
          daysOfWeek: scheduleDaysOfWeek,
          timezone: localTimezone,
        };
      case "monthly":
        return {
          type: "monthly",
          time: scheduleTime.slice(0, 5),
          dayOfMonth: scheduleDayOfMonth,
          timezone: localTimezone,
        };
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
        autoApprove,
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
    <div className="min-h-[calc(100vh-8rem)] space-y-5 pb-8">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
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
          <div className="flex flex-wrap items-center justify-end gap-3">
            <div className="flex items-center gap-2 rounded-full bg-muted/50 px-3 py-1.5">
            <span className="text-sm text-muted-foreground">
              {status === "on" ? "Workflow is on" : "Workflow is off"}
            </span>
            <Switch
              checked={status === "on"}
              onCheckedChange={(checked) => setStatus(checked ? "on" : "off")}
            />
          </div>
          <div className="flex items-center gap-2 rounded-full bg-muted/50 px-3 py-1.5">
            <span className="text-sm text-muted-foreground">
              {autoApprove ? "Auto-approve on" : "Auto-approve off"}
            </span>
            <Switch
              checked={autoApprove}
              onCheckedChange={(checked) => {
                if (checked) {
                  setAutoApprove(true);
                  return;
                }
                setShowDisableAutoApproveDialog(true);
              }}
            />
          </div>
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

      <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
        <section className="rounded-xl bg-card/20 p-5 md:p-6">
          <div className="space-y-8">
            <div className="space-y-4">
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <label className="text-sm font-medium">Name</label>
                  <input
                    className="h-10 w-full rounded-md border bg-transparent px-3 text-sm"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium">Trigger</label>
                  <Select value={triggerType} onValueChange={setTriggerType}>
                    <SelectTrigger className="h-10 w-full bg-transparent">
                      <SelectValue placeholder="Select a trigger" />
                    </SelectTrigger>
                    <SelectContent>
                      {TRIGGERS.map((trigger) => (
                        <SelectItem key={trigger.value} value={trigger.value}>
                          {trigger.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <AnimatePresence initial={false} mode="wait">
                {triggerType === "schedule" && (
                  <motion.div
                    key="schedule-settings"
                    className="space-y-4"
                    initial={{ opacity: 0, y: -8, height: 0 }}
                    animate={{ opacity: 1, y: 0, height: "auto" }}
                    exit={{ opacity: 0, y: -8, height: 0 }}
                    transition={{ duration: 0.22, ease: "easeOut" }}
                    style={{ overflow: "hidden" }}
                  >
                    <div className="space-y-2">
                      <label className="text-sm font-medium">Frequency</label>
                      <Select
                        value={scheduleType}
                        onValueChange={(value) => setScheduleType(value as typeof scheduleType)}
                      >
                        <SelectTrigger className="h-10 w-full bg-background">
                          <SelectValue placeholder="Select frequency" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="interval">Every X hours</SelectItem>
                          <SelectItem value="daily">Daily</SelectItem>
                          <SelectItem value="weekly">Weekly</SelectItem>
                          <SelectItem value="monthly">Monthly</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>

                    {scheduleType === "interval" && (
                      <div className="space-y-2">
                        <label className="text-sm font-medium">Run every</label>
                        <div className="flex items-center gap-2">
                          <input
                            type="number"
                            min={1}
                            max={168}
                            className="h-10 w-24 rounded-md border bg-background px-3 text-sm"
                            value={Math.max(1, Math.round(intervalMinutes / 60))}
                            onChange={(e) => {
                              const hours = Math.max(1, parseInt(e.target.value) || 1);
                              setIntervalMinutes(hours * 60);
                            }}
                          />
                          <span className="text-sm text-muted-foreground">hours</span>
                        </div>
                      </div>
                    )}

                    {(scheduleType === "daily" || scheduleType === "weekly" || scheduleType === "monthly") && (
                      <div className="space-y-2">
                        <label className="text-sm font-medium">Time ({localTimezone})</label>
                        <Input
                          type="time"
                          step={60}
                          value={scheduleTime}
                          onChange={(e) => setScheduleTime(e.target.value.slice(0, 5))}
                          className="h-10 w-36 bg-background appearance-none [&::-webkit-calendar-picker-indicator]:hidden [&::-webkit-calendar-picker-indicator]:appearance-none"
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
                                  ? "border-primary bg-primary text-primary-foreground"
                                  : "bg-background hover:bg-muted"
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
                        <Select
                          value={String(scheduleDayOfMonth)}
                          onValueChange={(value) => setScheduleDayOfMonth(parseInt(value, 10))}
                        >
                          <SelectTrigger className="h-10 w-24 bg-background">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {Array.from({ length: 31 }, (_, i) => i + 1).map((day) => (
                              <SelectItem key={day} value={String(day)}>
                                {day}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    )}
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">Agent instructions</label>
              <textarea
                className="min-h-[180px] w-full rounded-md border bg-transparent px-3 py-2 text-sm"
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
              />
            </div>

            <div className="space-y-3">
              <label className="text-sm font-medium">Allowed tools</label>
              <div className="grid gap-3 md:grid-cols-2">
                {(showAllIntegrations ? integrationEntries : integrationEntries.slice(0, 4)).map(
                  ({ key, name: label, logo }) => (
                    <label
                      key={key}
                      className={cn(
                        "flex items-center gap-3 rounded-md p-3 text-sm transition-colors",
                        allowedIntegrations.includes(key)
                          ? "bg-primary/10"
                          : "bg-muted/30 hover:bg-muted/50"
                      )}
                    >
                      <Checkbox
                        checked={allowedIntegrations.includes(key)}
                        onCheckedChange={() => toggleIntegration(key)}
                      />
                      <img src={logo} alt={label} className="h-4 w-4" />
                      <span>{label}</span>
                    </label>
                  )
                )}
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

          </div>
        </section>

        <aside className="rounded-xl bg-card/20 p-5 md:p-6 xl:sticky xl:top-6">
          <div className="mb-4 flex items-center justify-between">
            <div>
              <h3 className="text-sm font-semibold">Recent runs</h3>
              <p className="text-xs text-muted-foreground">Latest workflow runs and their status.</p>
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
                  className="flex items-center justify-between rounded-md bg-muted/30 px-3 py-2 text-sm transition-colors hover:bg-muted/50"
                >
                  <span>{getWorkflowRunStatusLabel(run.status)}</span>
                  <span className="text-xs text-muted-foreground">{formatDate(run.startedAt)}</span>
                </Link>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">No runs yet.</p>
          )}
        </aside>
      </div>
      <AlertDialog
        open={showDisableAutoApproveDialog}
        onOpenChange={setShowDisableAutoApproveDialog}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Turn off auto-approve?</AlertDialogTitle>
            <AlertDialogDescription>
              If you turn this off, workflow runs can stop and wait for manual approval on write actions.
              The agent might stay stuck until someone approves in the UI.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep on</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setAutoApprove(false);
                setShowDisableAutoApproveDialog(false);
              }}
            >
              Turn off
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
