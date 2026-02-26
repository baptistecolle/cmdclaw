"use client";

import { formatDistanceToNowStrict } from "date-fns";
import {
  Loader2,
  Play,
  ArrowLeft,
  ChevronDown,
  ChevronUp,
  Square,
  ChevronLeft,
  ChevronRight,
  Circle,
} from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import Image from "next/image";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChatArea } from "@/components/chat/chat-area";
import { ChatCopyButton } from "@/components/chat/chat-copy-button";
import { ChatShareControls } from "@/components/chat/chat-share-controls";
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
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { EMAIL_FORWARDED_TRIGGER_TYPE } from "@/lib/email-forwarding";
import {
  INTEGRATION_DISPLAY_NAMES,
  INTEGRATION_LOGOS,
  WORKFLOW_AVAILABLE_INTEGRATION_TYPES,
  isComingSoonIntegration,
  type IntegrationType,
} from "@/lib/integration-icons";
import { cn } from "@/lib/utils";
import { getWorkflowRunStatusLabel } from "@/lib/workflow-status";
import {
  useCreateWorkflowForwardingAlias,
  useDisableWorkflowForwardingAlias,
  useRotateWorkflowForwardingAlias,
  useWorkflow,
  useWorkflowForwardingAlias,
  useUpdateWorkflow,
  useWorkflowRuns,
  useWorkflowRun,
  useCancelGeneration,
  useSubmitApproval,
  useTriggerWorkflow,
  type WorkflowSchedule,
} from "@/orpc/hooks";

const TRIGGERS = [
  { value: "manual", label: "Manual only" },
  { value: "schedule", label: "Run on a schedule" },
  { value: EMAIL_FORWARDED_TRIGGER_TYPE, label: "Email forwarded to CmdClaw" },
  { value: "gmail.new_email", label: "New Gmail email" },
  ...(isComingSoonIntegration("twitter")
    ? []
    : ([{ value: "twitter.new_dm", label: "New X (Twitter) DM" }] as const)),
];

const scheduleMotionInitial = { opacity: 0, y: -8, height: 0 } as const;
const scheduleMotionAnimate = { opacity: 1, y: 0, height: "auto" } as const;
const scheduleMotionExit = { opacity: 0, y: -8, height: 0 } as const;
const scheduleMotionTransition = { duration: 0.22, ease: "easeOut" } as const;
const scheduleMotionStyle = { overflow: "hidden" } as const;
const testPanelDockCollapsed = { width: "3.5rem" } as const;
const testPanelDockExpanded = { width: "44rem" } as const;
const testPanelDockTransition = { duration: 0.28, ease: "easeOut" } as const;
const mobileTestPanelInitial = { opacity: 0, y: 24 } as const;
const mobileTestPanelAnimate = { opacity: 1, y: 0 } as const;
const mobileTestPanelExit = { opacity: 0, y: 16 } as const;
const mobileTestPanelTransition = { duration: 0.2, ease: "easeOut" } as const;
const ACTIVE_TEST_RUN_STATUSES = new Set(["running", "awaiting_approval", "awaiting_auth"]);

type PendingApprovalSummary = {
  toolUseId: string;
  integration: string;
  operation: string;
  command?: string;
};

function getPendingApprovalSummaryFromRun(run: {
  status: string;
  events: Array<{ type: string; payload: unknown }>;
}): PendingApprovalSummary | null {
  if (run.status !== "awaiting_approval") {
    return null;
  }

  for (let i = run.events.length - 1; i >= 0; i -= 1) {
    const event = run.events[i];
    if (
      !event ||
      event.type !== "pending_approval" ||
      !event.payload ||
      typeof event.payload !== "object"
    ) {
      continue;
    }

    const payload = event.payload as Record<string, unknown>;
    const toolUseId = typeof payload.toolUseId === "string" ? payload.toolUseId : null;
    const integration = typeof payload.integration === "string" ? payload.integration : null;
    const operation = typeof payload.operation === "string" ? payload.operation : null;
    const command = typeof payload.command === "string" ? payload.command : undefined;

    if (!toolUseId || !integration || !operation) {
      continue;
    }

    return {
      toolUseId,
      integration,
      operation,
      command,
    };
  }

  return null;
}

function formatRelativeTime(value?: Date | string | null) {
  if (!value) {
    return "just now";
  }

  const date = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) {
    return "just now";
  }

  const rawDistance = formatDistanceToNowStrict(date, { roundingMethod: "floor" });
  const [amount, unit] = rawDistance.split(" ");
  if (!amount || !unit || amount === "0") {
    return "just now";
  }

  const shortUnit = unit.startsWith("second")
    ? "s"
    : unit.startsWith("minute")
      ? "m"
      : unit.startsWith("hour")
        ? "h"
        : unit.startsWith("day")
          ? "d"
          : unit.startsWith("month")
            ? "mo"
            : unit.startsWith("year")
              ? "y"
              : unit;

  return `${amount}${shortUnit} ago`;
}

function IntegrationToggleSwitch({
  integrationType,
  checked,
  onToggle,
}: {
  integrationType: IntegrationType;
  checked: boolean;
  onToggle: (type: IntegrationType) => void;
}) {
  const handleCheckedChange = useCallback(() => {
    onToggle(integrationType);
  }, [integrationType, onToggle]);

  return <Switch checked={checked} onCheckedChange={handleCheckedChange} />;
}

export default function WorkflowEditorPage() {
  const params = useParams<{ id: string }>();
  const workflowId = params?.id;
  const { data: workflow, isLoading } = useWorkflow(workflowId);
  const { data: workflowForwardingAlias } = useWorkflowForwardingAlias(workflowId);
  const { data: runs, refetch: refetchRuns } = useWorkflowRuns(workflowId);
  const updateWorkflow = useUpdateWorkflow();
  const createForwardingAlias = useCreateWorkflowForwardingAlias();
  const disableForwardingAlias = useDisableWorkflowForwardingAlias();
  const rotateForwardingAlias = useRotateWorkflowForwardingAlias();
  const triggerWorkflow = useTriggerWorkflow();
  const cancelGeneration = useCancelGeneration();
  const submitApproval = useSubmitApproval();

  const [name, setName] = useState("");
  const [triggerType, setTriggerType] = useState(TRIGGERS[0].value);
  const [prompt, setPrompt] = useState("");
  const [allowedIntegrations, setAllowedIntegrations] = useState<IntegrationType[]>([]);
  const [restrictTools, setRestrictTools] = useState(false);
  const [status, setStatus] = useState<"on" | "off">("off");
  const [autoApprove, setAutoApprove] = useState(true);
  const [showDisableAutoApproveDialog, setShowDisableAutoApproveDialog] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isStartingRun, setIsStartingRun] = useState(false);
  const [showAllIntegrations, setShowAllIntegrations] = useState(false);
  const [notification, setNotification] = useState<{
    type: "success" | "error";
    message: string;
  } | null>(null);
  const [testRunId, setTestRunId] = useState<string | null>(null);
  const [isTestPanelExpanded, setIsTestPanelExpanded] = useState(false);
  const [copiedForwardingField, setCopiedForwardingField] = useState<"workflowAlias" | null>(null);
  const {
    data: selectedRun,
    isLoading: isSelectedRunLoading,
    refetch: refetchSelectedRun,
  } = useWorkflowRun(testRunId ?? undefined);
  const autoSaveTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const hasInitializedEditorRef = useRef(false);
  const initializedWorkflowIdRef = useRef<string | null>(null);
  const lastSavedPayloadRef = useRef<string | null>(null);

  // Schedule state (only used when triggerType is "schedule")
  const [scheduleType, setScheduleType] = useState<"interval" | "daily" | "weekly" | "monthly">(
    "daily",
  );
  const [intervalMinutes, setIntervalMinutes] = useState(60);
  const [scheduleTime, setScheduleTime] = useState("09:00");
  const [scheduleDaysOfWeek, setScheduleDaysOfWeek] = useState<number[]>([1, 2, 3, 4, 5]); // Mon-Fri
  const [scheduleDayOfMonth, setScheduleDayOfMonth] = useState(1);
  const localTimezone = useMemo(
    () => Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
    [],
  );
  const workflowForwardingAddress = workflowForwardingAlias?.forwardingAddress ?? null;
  const hasActiveForwardingAlias = Boolean(workflowForwardingAlias?.activeAlias);
  const isEmailTriggerPersisted = workflow?.triggerType === EMAIL_FORWARDED_TRIGGER_TYPE;
  const integrationEntries = useMemo(
    () =>
      WORKFLOW_AVAILABLE_INTEGRATION_TYPES.map((key) => ({
        key,
        name: INTEGRATION_DISPLAY_NAMES[key],
        logo: INTEGRATION_LOGOS[key],
      })),
    [],
  );
  const allIntegrationTypes = useMemo(
    () => integrationEntries.map((entry) => entry.key),
    [integrationEntries],
  );
  const activeRun = useMemo(
    () => runs?.find((run) => ACTIVE_TEST_RUN_STATUSES.has(run.status)) ?? null,
    [runs],
  );
  const {
    data: activeRunDetails,
    refetch: refetchActiveRunDetails,
    isLoading: isActiveRunDetailsLoading,
  } = useWorkflowRun(activeRun?.id);

  const buildSchedule = useCallback((): WorkflowSchedule | null => {
    if (triggerType !== "schedule") {
      return null;
    }

    switch (scheduleType) {
      case "interval":
        return {
          type: "interval",
          intervalMinutes: Math.max(60, Math.round(intervalMinutes / 60) * 60),
        };
      case "daily":
        return {
          type: "daily",
          time: scheduleTime.slice(0, 5),
          timezone: localTimezone,
        };
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
  }, [
    intervalMinutes,
    localTimezone,
    scheduleDayOfMonth,
    scheduleDaysOfWeek,
    scheduleTime,
    scheduleType,
    triggerType,
  ]);

  const getWorkflowUpdateInput = useCallback(() => {
    if (!workflowId) {
      return null;
    }
    return {
      id: workflowId,
      name,
      status,
      triggerType,
      prompt,
      autoApprove,
      allowedIntegrations: restrictTools ? allowedIntegrations : allIntegrationTypes,
      schedule: buildSchedule(),
    };
  }, [
    allIntegrationTypes,
    allowedIntegrations,
    autoApprove,
    buildSchedule,
    name,
    prompt,
    restrictTools,
    status,
    triggerType,
    workflowId,
  ]);

  const getWorkflowPayloadSignature = useCallback(
    (input: NonNullable<ReturnType<typeof getWorkflowUpdateInput>>) =>
      JSON.stringify({
        ...input,
        allowedIntegrations: [...input.allowedIntegrations].toSorted(),
        schedule:
          input.schedule?.type === "weekly"
            ? {
                ...input.schedule,
                daysOfWeek: [...input.schedule.daysOfWeek].toSorted(),
              }
            : input.schedule,
      }),
    [],
  );

  const persistWorkflow = useCallback(
    async (options?: { force?: boolean }) => {
      const input = getWorkflowUpdateInput();
      if (!input) {
        return false;
      }

      const signature = getWorkflowPayloadSignature(input);
      if (!options?.force && signature === lastSavedPayloadRef.current) {
        return true;
      }

      setIsSaving(true);
      try {
        await updateWorkflow.mutateAsync(input);
        lastSavedPayloadRef.current = signature;
        return true;
      } catch (error) {
        console.error("Failed to update workflow:", error);
        setNotification({ type: "error", message: "Failed to save workflow." });
        return false;
      } finally {
        setIsSaving(false);
      }
    },
    [getWorkflowPayloadSignature, getWorkflowUpdateInput, updateWorkflow],
  );

  useEffect(() => {
    if (!workflow) {
      return;
    }
    if (initializedWorkflowIdRef.current === workflow.id) {
      return;
    }

    const availableIntegrationTypes = WORKFLOW_AVAILABLE_INTEGRATION_TYPES;
    const workflowAllowedIntegrations = (
      (workflow.allowedIntegrations ?? []) as IntegrationType[]
    ).filter((type): type is IntegrationType => availableIntegrationTypes.includes(type));
    const hasRestriction =
      workflowAllowedIntegrations.length > 0 &&
      workflowAllowedIntegrations.length < availableIntegrationTypes.length;

    setName(workflow.name);
    setTriggerType(workflow.triggerType);
    setPrompt(workflow.prompt);
    setAllowedIntegrations(
      hasRestriction || workflowAllowedIntegrations.length === 0
        ? workflowAllowedIntegrations
        : availableIntegrationTypes,
    );
    setRestrictTools(hasRestriction || workflowAllowedIntegrations.length === 0);
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
    initializedWorkflowIdRef.current = workflow.id;
    hasInitializedEditorRef.current = true;

    const payloadFromWorkflow = {
      id: workflow.id,
      name: workflow.name,
      status: workflow.status,
      triggerType: workflow.triggerType,
      prompt: workflow.prompt,
      autoApprove: workflow.autoApprove ?? true,
      allowedIntegrations:
        hasRestriction || workflowAllowedIntegrations.length === 0
          ? workflowAllowedIntegrations
          : availableIntegrationTypes,
      schedule: schedule,
    } as const;
    lastSavedPayloadRef.current = getWorkflowPayloadSignature(payloadFromWorkflow);
  }, [getWorkflowPayloadSignature, workflow]);

  useEffect(() => {
    if (!notification) {
      return;
    }
    const timer = setTimeout(() => setNotification(null), 4000);
    return () => clearTimeout(timer);
  }, [notification]);

  const handleStatusChange = useCallback((checked: boolean) => {
    setStatus(checked ? "on" : "off");
  }, []);

  const handleAutoApproveChange = useCallback((checked: boolean) => {
    if (checked) {
      setAutoApprove(true);
      return;
    }
    setShowDisableAutoApproveDialog(true);
  }, []);

  const handleNameChange = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    setName(event.target.value);
  }, []);

  const handleScheduleTypeChange = useCallback((value: string) => {
    setScheduleType(value as "interval" | "daily" | "weekly" | "monthly");
  }, []);

  const handleIntervalHoursChange = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const hours = Math.max(1, parseInt(event.target.value) || 1);
    setIntervalMinutes(hours * 60);
  }, []);

  const handleScheduleTimeChange = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    setScheduleTime(event.target.value.slice(0, 5));
  }, []);

  const handleToggleWeekDay = useCallback((event: React.MouseEvent<HTMLButtonElement>) => {
    const dayIndex = parseInt(event.currentTarget.dataset.dayIndex || "", 10);
    if (Number.isNaN(dayIndex)) {
      return;
    }
    setScheduleDaysOfWeek((prev) =>
      prev.includes(dayIndex) ? prev.filter((d) => d !== dayIndex) : [...prev, dayIndex].toSorted(),
    );
  }, []);

  const handleScheduleDayOfMonthChange = useCallback((value: string) => {
    setScheduleDayOfMonth(parseInt(value, 10));
  }, []);

  const handlePromptChange = useCallback((event: React.ChangeEvent<HTMLTextAreaElement>) => {
    setPrompt(event.target.value);
  }, []);

  const handleRestrictToolsChange = useCallback(
    (checked: boolean) => {
      if (checked) {
        setRestrictTools(false);
        setAllowedIntegrations(allIntegrationTypes);
        return;
      }
      setRestrictTools(true);
    },
    [allIntegrationTypes],
  );

  const handleSelectAllIntegrations = useCallback(() => {
    setAllowedIntegrations(allIntegrationTypes);
  }, [allIntegrationTypes]);

  const handleClearIntegrations = useCallback(() => {
    setAllowedIntegrations([]);
  }, []);

  const handleToggleShowAllIntegrations = useCallback(() => {
    setShowAllIntegrations((prev) => !prev);
  }, []);

  const handleToggleIntegrationChecked = useCallback((type: IntegrationType) => {
    setAllowedIntegrations((prev) =>
      prev.includes(type) ? prev.filter((t) => t !== type) : [...prev, type],
    );
  }, []);

  const handleDisableAutoApprove = useCallback(() => {
    setAutoApprove(false);
    setShowDisableAutoApproveDialog(false);
  }, []);

  const handleSelectTestRun = useCallback((runId: string) => {
    setTestRunId(runId);
  }, []);

  const handleToggleTestPanel = useCallback(() => {
    setIsTestPanelExpanded((prev) => !prev);
  }, []);

  const handleCopyForwardingAddress = useCallback(async (value: string, field: "workflowAlias") => {
    try {
      await navigator.clipboard.writeText(value);
      setCopiedForwardingField(field);
      setTimeout(() => setCopiedForwardingField(null), 1500);
    } catch (error) {
      console.error("Failed to copy forwarding address:", error);
    }
  }, []);
  const handleCopyWorkflowAlias = useCallback(() => {
    if (!workflowForwardingAddress) {
      return;
    }
    void handleCopyForwardingAddress(workflowForwardingAddress, "workflowAlias");
  }, [handleCopyForwardingAddress, workflowForwardingAddress]);

  const handleCreateWorkflowAlias = useCallback(async () => {
    if (!workflowId) {
      return;
    }

    try {
      await createForwardingAlias.mutateAsync(workflowId);
      setNotification({ type: "success", message: "Forwarding address created." });
    } catch (error) {
      console.error("Failed to create forwarding alias:", error);
      setNotification({ type: "error", message: "Failed to create forwarding address." });
    }
  }, [createForwardingAlias, workflowId]);

  const handleRotateWorkflowAlias = useCallback(async () => {
    if (!workflowId) {
      return;
    }

    try {
      await rotateForwardingAlias.mutateAsync(workflowId);
      setNotification({ type: "success", message: "Forwarding address rotated." });
    } catch (error) {
      console.error("Failed to rotate forwarding alias:", error);
      setNotification({ type: "error", message: "Failed to rotate forwarding address." });
    }
  }, [rotateForwardingAlias, workflowId]);

  const handleDisableWorkflowAlias = useCallback(async () => {
    if (!workflowId) {
      return;
    }

    try {
      await disableForwardingAlias.mutateAsync(workflowId);
      setNotification({ type: "success", message: "Forwarding address disabled." });
    } catch (error) {
      console.error("Failed to disable forwarding alias:", error);
      setNotification({ type: "error", message: "Failed to disable forwarding address." });
    }
  }, [disableForwardingAlias, workflowId]);

  const cancelTargetRunId = activeRun?.id ?? testRunId ?? null;
  const { data: cancelTargetRun } = useWorkflowRun(cancelTargetRunId ?? undefined);

  const isTestingLocked = Boolean(activeRun);
  const canCancelRun = Boolean(
    cancelTargetRun?.generationId && ACTIVE_TEST_RUN_STATUSES.has(cancelTargetRun.status),
  );
  const pendingApprovalSummary = selectedRun ? getPendingApprovalSummaryFromRun(selectedRun) : null;
  const hasAgentInstructions = prompt.trim().length > 0;

  useEffect(() => {
    if (!hasInitializedEditorRef.current) {
      return;
    }
    if (!workflowId) {
      return;
    }
    if (autoSaveTimeoutRef.current) {
      clearTimeout(autoSaveTimeoutRef.current);
    }

    autoSaveTimeoutRef.current = setTimeout(() => {
      void persistWorkflow();
    }, 1000);

    return () => {
      if (autoSaveTimeoutRef.current) {
        clearTimeout(autoSaveTimeoutRef.current);
      }
    };
  }, [
    allowedIntegrations,
    autoApprove,
    buildSchedule,
    name,
    persistWorkflow,
    prompt,
    restrictTools,
    scheduleDayOfMonth,
    scheduleDaysOfWeek,
    scheduleTime,
    scheduleType,
    status,
    triggerType,
    workflowId,
  ]);

  useEffect(() => {
    if (!runs || runs.length === 0) {
      setTestRunId(null);
      return;
    }

    if (testRunId) {
      const selectedRunStillExists = runs.some((run) => run.id === testRunId);
      if (selectedRunStillExists) {
        return;
      }

      // Keep the newly created run selected while runs list catches up.
      if (
        selectedRun?.id === testRunId ||
        isSelectedRunLoading ||
        isStartingRun ||
        triggerWorkflow.isPending
      ) {
        return;
      }
    }

    if (activeRun) {
      setTestRunId(activeRun.id);
      return;
    }

    setTestRunId(runs[0]!.id);
  }, [
    activeRun,
    isSelectedRunLoading,
    isStartingRun,
    runs,
    selectedRun,
    testRunId,
    triggerWorkflow.isPending,
  ]);

  useEffect(() => {
    if (!activeRun) {
      return;
    }

    const interval = setInterval(() => {
      void refetchRuns();
      if (testRunId) {
        void refetchSelectedRun();
      }
    }, 2000);

    return () => clearInterval(interval);
  }, [activeRun, refetchRuns, refetchSelectedRun, testRunId]);

  const handleRun = useCallback(async () => {
    if (!workflowId || isStartingRun) {
      return;
    }

    setIsStartingRun(true);
    try {
      if (autoSaveTimeoutRef.current) {
        clearTimeout(autoSaveTimeoutRef.current);
      }
      const saveSucceeded = await persistWorkflow({ force: true });
      if (!saveSucceeded) {
        setNotification({ type: "error", message: "Failed to save workflow before test run." });
        return;
      }

      if (activeRun) {
        const currentActiveRun =
          activeRunDetails?.id === activeRun.id
            ? activeRunDetails
            : (await refetchActiveRunDetails()).data;

        if (!currentActiveRun?.generationId) {
          setNotification({
            type: "error",
            message: "Could not cancel the previous active run.",
          });
          return;
        }

        const cancelResult = await cancelGeneration.mutateAsync(currentActiveRun.generationId);
        if (!cancelResult.success) {
          setNotification({
            type: "error",
            message: "Previous run could not be cancelled. Please try again.",
          });
          return;
        }
      }

      const result = await triggerWorkflow.mutateAsync({ id: workflowId, payload: {} });
      setTestRunId(result.runId);
      setIsTestPanelExpanded(true);
      setNotification({ type: "success", message: "Test run started." });
      void refetchRuns();
    } catch (error) {
      console.error("Failed to run workflow:", error);
      setNotification({ type: "error", message: "Failed to start run." });
    } finally {
      setIsStartingRun(false);
    }
  }, [
    activeRun,
    activeRunDetails,
    cancelGeneration,
    isStartingRun,
    persistWorkflow,
    refetchActiveRunDetails,
    refetchRuns,
    triggerWorkflow,
    workflowId,
  ]);

  const handleCancelRun = useCallback(async () => {
    if (!cancelTargetRun?.generationId) {
      setNotification({
        type: "error",
        message: "This run cannot be cancelled right now.",
      });
      return;
    }

    try {
      const result = await cancelGeneration.mutateAsync(cancelTargetRun.generationId);
      if (!result.success) {
        setNotification({
          type: "error",
          message: "Run could not be cancelled (it may already be finished).",
        });
        return;
      }

      setNotification({ type: "success", message: "Run cancelled." });
      await Promise.all([refetchRuns(), refetchSelectedRun()]);
    } catch (error) {
      console.error("Failed to cancel run:", error);
      setNotification({ type: "error", message: "Failed to cancel run." });
    }
  }, [cancelGeneration, cancelTargetRun?.generationId, refetchRuns, refetchSelectedRun]);

  const handleSubmitRunApproval = useCallback(
    async (decision: "approve" | "deny") => {
      if (!selectedRun?.generationId || !pendingApprovalSummary?.toolUseId) {
        setNotification({
          type: "error",
          message: "No pending approval found for this run.",
        });
        return;
      }

      try {
        const result = await submitApproval.mutateAsync({
          generationId: selectedRun.generationId,
          toolUseId: pendingApprovalSummary.toolUseId,
          decision,
        });

        if (!result.success) {
          setNotification({
            type: "error",
            message: "Approval was not applied. The request may have expired.",
          });
          return;
        }

        setNotification({
          type: "success",
          message: decision === "approve" ? "Action approved." : "Action denied.",
        });
        await Promise.all([refetchRuns(), refetchSelectedRun()]);
      } catch (error) {
        console.error("Failed to submit workflow approval:", error);
        setNotification({
          type: "error",
          message: "Failed to submit approval.",
        });
      }
    },
    [
      pendingApprovalSummary?.toolUseId,
      refetchRuns,
      refetchSelectedRun,
      selectedRun?.generationId,
      submitApproval,
    ],
  );
  const handleApproveRun = useCallback(() => {
    void handleSubmitRunApproval("approve");
  }, [handleSubmitRunApproval]);
  const handleDenyRun = useCallback(() => {
    void handleSubmitRunApproval("deny");
  }, [handleSubmitRunApproval]);

  if (isLoading || !workflow) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-6 w-6 animate-spin" />
      </div>
    );
  }

  const workflowDisplayName = workflow.name.trim().length > 0 ? workflow.name : "New Workflow";
  const selectedRunSummary =
    runs?.find((run) => run.id === testRunId) ??
    (selectedRun && selectedRun.id === testRunId
      ? { id: selectedRun.id, status: selectedRun.status, startedAt: selectedRun.startedAt }
      : null);
  const testRunPanelContent = (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <div className="border-b px-4 py-3">
        <div className="mb-2 flex items-start justify-between gap-2">
          <div>
            <h3 className="text-sm font-semibold">Test run</h3>
            <p className="text-muted-foreground text-xs">Live output for this workflow test.</p>
          </div>
          <div className="flex min-w-0 flex-wrap items-center justify-end gap-1">
            <Select
              value={testRunId ?? undefined}
              onValueChange={handleSelectTestRun}
              disabled={!runs || runs.length === 0}
            >
              <SelectTrigger className="h-8 max-w-[17rem] min-w-0 text-xs">
                <SelectValue
                  placeholder={
                    selectedRunSummary
                      ? `${formatRelativeTime(selectedRunSummary.startedAt)} • ${getWorkflowRunStatusLabel(selectedRunSummary.status)}`
                      : "Load a previous run"
                  }
                />
              </SelectTrigger>
              <SelectContent align="end" position="popper" className="max-w-[17rem]">
                {(runs ?? []).map((run) => (
                  <SelectItem key={run.id} value={run.id}>
                    <span className="truncate text-xs">
                      {formatRelativeTime(run.startedAt)} • {getWorkflowRunStatusLabel(run.status)}
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {selectedRun?.conversationId ? (
              <div className="flex items-center gap-2">
                <ChatCopyButton conversationId={selectedRun.conversationId} />
                <ChatShareControls conversationId={selectedRun.conversationId} />
              </div>
            ) : null}
            <Button
              variant="destructive"
              size="sm"
              onClick={handleCancelRun}
              disabled={!canCancelRun || cancelGeneration.isPending}
            >
              {cancelGeneration.isPending ? (
                <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
              ) : (
                <Square className="mr-2 h-3.5 w-3.5" />
              )}
              Cancel run
            </Button>
          </div>
        </div>
        {isTestingLocked ? (
          <p className="text-muted-foreground mt-2 text-xs">
            Starting a new test run will cancel the currently active one.
          </p>
        ) : null}
        {pendingApprovalSummary ? (
          <div className="mt-3 rounded-md border border-amber-500/40 bg-amber-500/10 p-3">
            <p className="text-sm font-medium">Approval required</p>
            <p className="text-muted-foreground mt-1 text-xs">
              {pendingApprovalSummary.integration} {pendingApprovalSummary.operation}
            </p>
            {pendingApprovalSummary.command ? (
              <code className="bg-background/80 mt-2 block overflow-x-auto rounded px-2 py-1 text-xs">
                {pendingApprovalSummary.command}
              </code>
            ) : null}
            <div className="mt-3 flex gap-2">
              <Button size="sm" onClick={handleApproveRun} disabled={submitApproval.isPending}>
                {submitApproval.isPending ? (
                  <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
                ) : null}
                Approve
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={handleDenyRun}
                disabled={submitApproval.isPending}
              >
                Deny
              </Button>
            </div>
          </div>
        ) : null}
      </div>

      <div className="bg-background flex min-h-0 flex-1 overflow-hidden">
        {isSelectedRunLoading ? (
          <div className="flex h-full items-center justify-center">
            <Loader2 className="h-5 w-5 animate-spin" />
          </div>
        ) : selectedRun?.conversationId ? (
          <ChatArea conversationId={selectedRun.conversationId} />
        ) : selectedRun ? (
          <div className="space-y-2 p-4">
            <p className="text-sm font-medium">Run details unavailable in chat view</p>
            <p className="text-muted-foreground text-sm">
              This run does not have a linked conversation.
            </p>
          </div>
        ) : (
          <div className="space-y-2 p-4">
            <p className="text-sm font-medium">No test run selected</p>
            <p className="text-muted-foreground text-sm">
              Click <span className="font-medium">Test now</span> to run this workflow.
            </p>
          </div>
        )}
      </div>
    </div>
  );

  return (
    <div className="relative h-full min-h-0 w-full min-w-0 overflow-hidden">
      <div
        className={cn(
          "h-full overflow-y-auto px-4 py-5 pb-24 transition-[padding-right] duration-300 sm:px-6 xl:pb-6",
          isTestPanelExpanded ? "xl:pr-[44rem]" : "xl:pr-14",
        )}
      >
        <div className="space-y-5 pb-6">
          <div className="space-y-3">
            <div className="flex items-start gap-3 sm:items-center">
              <Button variant="ghost" size="icon" asChild>
                <Link href="/workflows">
                  <ArrowLeft className="h-4 w-4" />
                </Link>
              </Button>
              <div className="min-w-0">
                <h2 className="text-xl font-semibold">{workflowDisplayName}</h2>
                <p className="text-muted-foreground text-sm">
                  Configure trigger, agent instructions, and allowed tools.
                </p>
              </div>
            </div>
            <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
              <div className="bg-muted/50 flex w-full items-center justify-between gap-2 rounded-full px-3 py-1.5 sm:w-auto sm:justify-start">
                <span className="text-muted-foreground text-sm">
                  {status === "on" ? "Workflow is on" : "Workflow is off"}
                </span>
                <Switch checked={status === "on"} onCheckedChange={handleStatusChange} />
              </div>
              <div className="bg-muted/50 flex w-full items-center justify-between gap-2 rounded-full px-3 py-1.5 sm:w-auto sm:justify-start">
                <span className="text-muted-foreground text-sm">
                  {autoApprove ? "Auto-approve on" : "Auto-approve off"}
                </span>
                <Switch checked={autoApprove} onCheckedChange={handleAutoApproveChange} />
              </div>
              <Button
                variant="secondary"
                className="w-full sm:w-auto"
                onClick={handleRun}
                disabled={
                  !hasAgentInstructions ||
                  (!activeRun && status !== "on") ||
                  triggerWorkflow.isPending ||
                  isStartingRun ||
                  isActiveRunDetailsLoading
                }
              >
                {triggerWorkflow.isPending || isStartingRun ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Play className="mr-2 h-4 w-4" />
                )}
                <span className="inline-flex items-center gap-1.5">
                  Test now
                  {isTestingLocked ? (
                    <span
                      className="h-2 w-2 animate-pulse rounded-full bg-emerald-500"
                      aria-label="Test run in progress"
                    />
                  ) : null}
                </span>
              </Button>
              <span
                className={cn(
                  "text-xs transition-opacity",
                  isSaving
                    ? "text-muted-foreground opacity-100"
                    : notification?.type === "error"
                      ? "text-red-600 opacity-100 dark:text-red-400"
                      : "text-muted-foreground opacity-0",
                )}
              >
                {isSaving ? "Saving..." : notification?.type === "error" ? "Save failed" : "Saved"}
              </span>
            </div>
          </div>

          {notification && (
            <div
              className={cn(
                "rounded-lg border px-4 py-3 text-sm",
                notification.type === "success"
                  ? "border-green-500/40 bg-green-500/10 text-green-700 dark:text-green-400"
                  : "border-red-500/40 bg-red-500/10 text-red-700 dark:text-red-400",
              )}
            >
              {notification.message}
            </div>
          )}

          <div className="flex flex-col gap-5">
            <section className="bg-card/20 w-full min-w-0 flex-1 rounded-xl p-5 md:p-6">
              <div className="space-y-8">
                <div className="space-y-4">
                  <div className="grid gap-4 md:grid-cols-2">
                    <div className="space-y-2">
                      <label className="text-sm font-medium">Name</label>
                      <input
                        className="h-10 w-full rounded-md border bg-transparent px-3 text-sm"
                        value={name}
                        onChange={handleNameChange}
                        placeholder="Leave blank to auto generate"
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
                        initial={scheduleMotionInitial}
                        animate={scheduleMotionAnimate}
                        exit={scheduleMotionExit}
                        transition={scheduleMotionTransition}
                        style={scheduleMotionStyle}
                      >
                        <div className="space-y-2">
                          <label className="text-sm font-medium">Frequency</label>
                          <Select value={scheduleType} onValueChange={handleScheduleTypeChange}>
                            <SelectTrigger className="bg-background h-10 w-full">
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
                                className="bg-background h-10 w-24 rounded-md border px-3 text-sm"
                                value={Math.max(1, Math.round(intervalMinutes / 60))}
                                onChange={handleIntervalHoursChange}
                              />
                              <span className="text-muted-foreground text-sm">hours</span>
                            </div>
                          </div>
                        )}

                        {(scheduleType === "daily" ||
                          scheduleType === "weekly" ||
                          scheduleType === "monthly") && (
                          <div className="space-y-2">
                            <label className="text-sm font-medium">Time ({localTimezone})</label>
                            <Input
                              type="time"
                              step={60}
                              value={scheduleTime}
                              onChange={handleScheduleTimeChange}
                              className="bg-background h-10 w-36 appearance-none [&::-webkit-calendar-picker-indicator]:hidden [&::-webkit-calendar-picker-indicator]:appearance-none"
                            />
                          </div>
                        )}

                        {scheduleType === "weekly" && (
                          <div className="space-y-2">
                            <label className="text-sm font-medium">Days of the week</label>
                            <div className="flex flex-wrap gap-2">
                              {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map(
                                (day, index) => (
                                  <button
                                    key={day}
                                    type="button"
                                    data-day-index={index}
                                    className={cn(
                                      "h-9 w-12 rounded-md border text-sm font-medium transition-colors",
                                      scheduleDaysOfWeek.includes(index)
                                        ? "border-primary bg-primary text-primary-foreground"
                                        : "bg-background hover:bg-muted",
                                    )}
                                    onClick={handleToggleWeekDay}
                                  >
                                    {day}
                                  </button>
                                ),
                              )}
                            </div>
                          </div>
                        )}

                        {scheduleType === "monthly" && (
                          <div className="space-y-2">
                            <label className="text-sm font-medium">Day of the month</label>
                            <Select
                              value={String(scheduleDayOfMonth)}
                              onValueChange={handleScheduleDayOfMonthChange}
                            >
                              <SelectTrigger className="bg-background h-10 w-24">
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

                  {triggerType === EMAIL_FORWARDED_TRIGGER_TYPE && (
                    <div className="bg-muted/20 mt-4 space-y-4 rounded-lg border p-4">
                      <div className="space-y-2">
                        <label className="text-sm font-medium">Workflow forwarding address</label>
                        {hasActiveForwardingAlias ? (
                          <div className="flex flex-col gap-2 sm:flex-row">
                            <Input
                              type="text"
                              value={workflowForwardingAddress ?? ""}
                              disabled
                              className="bg-background/60 font-mono text-xs"
                              placeholder="Set RESEND_RECEIVING_DOMAIN to enable forwarding aliases"
                            />
                            <div className="flex gap-2">
                              <Button
                                type="button"
                                variant="outline"
                                onClick={handleCopyWorkflowAlias}
                                disabled={!workflowForwardingAddress}
                              >
                                {copiedForwardingField === "workflowAlias" ? "Copied" : "Copy"}
                              </Button>
                              <Button
                                type="button"
                                variant="outline"
                                onClick={handleRotateWorkflowAlias}
                                disabled={rotateForwardingAlias.isPending}
                              >
                                Rotate
                              </Button>
                              <Button
                                type="button"
                                variant="outline"
                                onClick={handleDisableWorkflowAlias}
                                disabled={disableForwardingAlias.isPending}
                              >
                                Disable
                              </Button>
                            </div>
                          </div>
                        ) : (
                          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                            <Input
                              type="text"
                              value=""
                              disabled
                              className="bg-background/60 font-mono text-xs"
                              placeholder="No forwarding address yet"
                            />
                            <Button
                              type="button"
                              variant="outline"
                              onClick={handleCreateWorkflowAlias}
                              disabled={
                                createForwardingAlias.isPending ||
                                !workflowForwardingAlias?.receivingDomain ||
                                !isEmailTriggerPersisted
                              }
                            >
                              Create email
                            </Button>
                          </div>
                        )}
                      </div>

                      {/* Personal forwarding alias intentionally hidden for now. */}
                    </div>
                  )}
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-medium">Agent instructions</label>
                  <textarea
                    className="min-h-[180px] w-full rounded-md border bg-transparent px-3 py-2 text-sm"
                    value={prompt}
                    onChange={handlePromptChange}
                  />
                </div>

                <div className="space-y-3">
                  <div className="flex items-center justify-between gap-3">
                    <label className="text-sm font-medium">Allowed tools</label>
                    <div className="flex items-center gap-2">
                      <span className="text-muted-foreground text-sm">All tools allowed</span>
                      <Switch
                        checked={!restrictTools}
                        onCheckedChange={handleRestrictToolsChange}
                      />
                    </div>
                  </div>
                  {!restrictTools ? (
                    <p className="text-muted-foreground text-sm">All tools are allowed.</p>
                  ) : (
                    <>
                      <div className="flex items-center justify-between gap-3">
                        <p className="text-muted-foreground text-xs">
                          {allowedIntegrations.length}/{allIntegrationTypes.length} selected
                        </p>
                        <div className="flex items-center gap-2">
                          <Button
                            variant="outline"
                            size="sm"
                            className="h-8"
                            disabled={allowedIntegrations.length === allIntegrationTypes.length}
                            onClick={handleSelectAllIntegrations}
                          >
                            Select all
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            className="h-8"
                            disabled={allowedIntegrations.length === 0}
                            onClick={handleClearIntegrations}
                          >
                            Clear
                          </Button>
                        </div>
                      </div>
                      <div className="grid gap-3 md:grid-cols-2">
                        {(showAllIntegrations
                          ? integrationEntries
                          : integrationEntries.slice(0, 4)
                        ).map(({ key, name: label, logo }) => (
                          <label
                            key={key}
                            className={cn(
                              "flex items-center gap-3 rounded-md bg-muted/30 p-3 text-sm transition-colors hover:bg-muted/50",
                            )}
                          >
                            <IntegrationToggleSwitch
                              integrationType={key}
                              checked={allowedIntegrations.includes(key)}
                              onToggle={handleToggleIntegrationChecked}
                            />
                            <Image
                              src={logo}
                              alt={label}
                              width={16}
                              height={16}
                              className="h-4 w-4"
                            />
                            <span>{label}</span>
                          </label>
                        ))}
                      </div>
                      {integrationEntries.length > 4 && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={handleToggleShowAllIntegrations}
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
                    </>
                  )}
                </div>
              </div>
            </section>
          </div>
        </div>
      </div>

      <AnimatePresence>
        {isTestPanelExpanded ? (
          <motion.section
            initial={mobileTestPanelInitial}
            animate={mobileTestPanelAnimate}
            exit={mobileTestPanelExit}
            transition={mobileTestPanelTransition}
            className="bg-card/95 absolute inset-0 z-40 flex min-h-0 flex-col border-l backdrop-blur-sm xl:hidden"
          >
            <div className="border-b px-4 py-3">
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm font-semibold">Test run panel</p>
                <Button variant="ghost" size="sm" onClick={handleToggleTestPanel}>
                  Close
                </Button>
              </div>
            </div>
            {testRunPanelContent}
          </motion.section>
        ) : null}
      </AnimatePresence>

      <div className="bg-background/95 border-border/50 absolute inset-x-0 bottom-0 z-30 border-t backdrop-blur-sm xl:hidden">
        <button
          type="button"
          onClick={handleToggleTestPanel}
          className="flex w-full items-center justify-between px-4 py-3 text-left"
        >
          <div className="flex items-center gap-2">
            <Circle
              className={cn(
                "h-2.5 w-2.5 fill-current",
                isTestingLocked ? "text-emerald-500" : "text-muted-foreground/70",
              )}
            />
            <span className="text-sm font-medium">Test run</span>
          </div>
          <div className="text-muted-foreground flex items-center gap-2 text-xs">
            {isTestPanelExpanded ? (
              <ChevronDown className="h-4 w-4" />
            ) : (
              <ChevronUp className="h-4 w-4" />
            )}
          </div>
        </button>
      </div>

      <motion.aside
        initial={false}
        animate={isTestPanelExpanded ? testPanelDockExpanded : testPanelDockCollapsed}
        transition={testPanelDockTransition}
        className="bg-card/55 border-border/40 absolute inset-y-0 right-0 z-30 hidden overflow-hidden border-l backdrop-blur-sm xl:block"
      >
        <div className="flex h-full min-h-0">
          <div className="bg-background/60 border-border/40 flex w-14 shrink-0 flex-col items-center justify-between border-r py-3">
            <button
              type="button"
              onClick={handleToggleTestPanel}
              className="hover:bg-muted/80 rounded-md p-1.5 transition-colors"
              aria-label={isTestPanelExpanded ? "Collapse test sidebar" : "Expand test sidebar"}
            >
              {isTestPanelExpanded ? (
                <ChevronRight className="h-4 w-4" />
              ) : (
                <ChevronLeft className="h-4 w-4" />
              )}
            </button>
            <button
              type="button"
              onClick={handleToggleTestPanel}
              className="hover:bg-muted/80 flex w-full items-center justify-center rounded-md py-3 transition-colors"
              aria-label="Toggle test run panel"
            >
              <Circle
                className={cn(
                  "h-2.5 w-2.5 fill-current",
                  isTestingLocked ? "text-emerald-500" : "text-muted-foreground/70",
                )}
              />
            </button>
          </div>

          {isTestPanelExpanded ? testRunPanelContent : null}
        </div>
      </motion.aside>
      <AlertDialog
        open={showDisableAutoApproveDialog}
        onOpenChange={setShowDisableAutoApproveDialog}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Turn off auto-approve?</AlertDialogTitle>
            <AlertDialogDescription>
              If you turn this off, workflow runs can stop and wait for manual approval on write
              actions. The agent might stay stuck until someone approves in the UI.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep on</AlertDialogCancel>
            <AlertDialogAction onClick={handleDisableAutoApprove}>Turn off</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
