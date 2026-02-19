export type MessageTiming = {
  sandboxStartupDurationMs?: number;
  sandboxStartupMode?: "created" | "reused" | "unknown";
  generationDurationMs?: number;
  phaseDurationsMs?: {
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
    | "sandbox_prep"
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

  if (timing.sandboxStartupDurationMs !== undefined) {
    metrics.push({
      key: "sandbox_prep",
      label: `Sandbox prep${timing.sandboxStartupMode === "reused" ? " (reused)" : ""}`,
      value: formatDuration(timing.sandboxStartupDurationMs),
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
