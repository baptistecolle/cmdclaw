export type MessageTiming = {
  endToEndDurationMs?: number;
  sandboxStartupDurationMs?: number;
  sandboxStartupMode?: "created" | "reused" | "unknown";
  generationDurationMs?: number;
  phaseDurationsMs?: {
    sandboxConnectOrCreateMs?: number;
    opencodeReadyMs?: number;
    sessionReadyMs?: number;
    agentInitMs?: number;
    prePromptSetupMs?: number;
    agentReadyToPromptMs?: number;
    waitForFirstEventMs?: number;
    modelStreamMs?: number;
    postProcessingMs?: number;
  };
  phaseTimestamps?: Array<{
    phase: string;
    at: string;
    elapsedMs: number;
  }>;
};

export type TimingMetric = {
  key:
    | "end_to_end"
    | "sandbox_connect_or_create"
    | "opencode_ready"
    | "session_ready"
    | "generation"
    | "agent_init"
    | "pre_prompt"
    | "first_event_wait"
    | "model_stream"
    | "post_processing";
  label: string;
  value: string;
};

export function formatDuration(ms: number): string {
  if (ms < 1000) {
    return `${ms}ms`;
  }
  return `${(ms / 1000).toFixed(1)}s`;
}

export function getTimingMetrics(timing?: MessageTiming): TimingMetric[] {
  if (!timing) {
    return [];
  }

  const metrics: TimingMetric[] = [];

  if (timing.endToEndDurationMs !== undefined) {
    metrics.push({
      key: "end_to_end",
      label: "End-to-end",
      value: formatDuration(timing.endToEndDurationMs),
    });
  }

  const sandboxConnectOrCreateMs =
    timing.phaseDurationsMs?.sandboxConnectOrCreateMs ?? timing.sandboxStartupDurationMs;
  if (sandboxConnectOrCreateMs !== undefined) {
    metrics.push({
      key: "sandbox_connect_or_create",
      label: `Sandbox connect/create${timing.sandboxStartupMode === "reused" ? " (reused)" : ""}`,
      value: formatDuration(sandboxConnectOrCreateMs),
    });
  }

  if (timing.phaseDurationsMs?.opencodeReadyMs !== undefined) {
    metrics.push({
      key: "opencode_ready",
      label: "OpenCode ready",
      value: formatDuration(timing.phaseDurationsMs.opencodeReadyMs),
    });
  }

  if (timing.phaseDurationsMs?.sessionReadyMs !== undefined) {
    metrics.push({
      key: "session_ready",
      label: "Session ready",
      value: formatDuration(timing.phaseDurationsMs.sessionReadyMs),
    });
  }

  if (timing.generationDurationMs !== undefined) {
    metrics.push({
      key: "generation",
      label: "Generation",
      value: formatDuration(timing.generationDurationMs),
    });
  }

  if (timing.phaseDurationsMs?.agentInitMs !== undefined) {
    metrics.push({
      key: "agent_init",
      label: "Agent init",
      value: formatDuration(timing.phaseDurationsMs.agentInitMs),
    });
  }

  if (timing.phaseDurationsMs?.prePromptSetupMs !== undefined) {
    metrics.push({
      key: "pre_prompt",
      label: "Pre-prompt",
      value: formatDuration(timing.phaseDurationsMs.prePromptSetupMs),
    });
  }

  if (timing.phaseDurationsMs?.waitForFirstEventMs !== undefined) {
    metrics.push({
      key: "first_event_wait",
      label: "First event wait",
      value: formatDuration(timing.phaseDurationsMs.waitForFirstEventMs),
    });
  }

  if (timing.phaseDurationsMs?.modelStreamMs !== undefined) {
    metrics.push({
      key: "model_stream",
      label: "Model stream",
      value: formatDuration(timing.phaseDurationsMs.modelStreamMs),
    });
  }

  if (timing.phaseDurationsMs?.postProcessingMs !== undefined) {
    metrics.push({
      key: "post_processing",
      label: "Post-processing",
      value: formatDuration(timing.phaseDurationsMs.postProcessingMs),
    });
  }

  return metrics;
}
