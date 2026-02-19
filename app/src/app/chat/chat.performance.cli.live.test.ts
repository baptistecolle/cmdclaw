import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, test } from "vitest";
import {
  assertExitOk,
  ensureCliAuth,
  extractConversationId,
  liveEnabled,
  responseTimeoutMs,
  resolveLiveModel,
  runChatMessage,
} from "../../../tests/e2e-cli/live-fixtures";

let liveModel = "";

type ParsedTiming = {
  generationMs: number;
  agentInitMs: number;
  sandboxConnectOrCreateMs: number;
  sandboxMode: "created" | "reused" | "unknown";
};

function parseDurationToMs(raw: string): number {
  const trimmed = raw.trim();
  if (trimmed.endsWith("ms")) {
    return Number.parseFloat(trimmed.slice(0, -2));
  }
  if (trimmed.endsWith("s")) {
    return Number.parseFloat(trimmed.slice(0, -1)) * 1000;
  }
  throw new Error(`Unsupported duration format: ${raw}`);
}

function requireDuration(output: string, pattern: RegExp, label: string): number {
  const matched = output.match(pattern);
  if (!matched?.[1]) {
    throw new Error(`Missing ${label} timing in output.\n${output}`);
  }
  return parseDurationToMs(matched[1]);
}

function parseTiming(output: string): ParsedTiming {
  const generationMs = requireDuration(
    output,
    /end_to_end_total:\s+([0-9.]+(?:ms|s))/,
    "end_to_end_total",
  );
  const agentInitMs = requireDuration(output, /agent_init:\s+([0-9.]+(?:ms|s))/, "agent_init");
  const sandboxMatch = output.match(
    /sandbox_connect_or_create(?:\s+\((created|reused|unknown)\))?:\s+([0-9.]+(?:ms|s))/,
  );
  if (!sandboxMatch?.[2]) {
    throw new Error(`Missing sandbox_connect_or_create timing in output.\n${output}`);
  }
  const sandboxConnectOrCreateMs = parseDurationToMs(sandboxMatch[2]);

  const sandboxMode = (sandboxMatch[1] as ParsedTiming["sandboxMode"] | undefined) ?? "unknown";

  return {
    generationMs,
    agentInitMs,
    sandboxConnectOrCreateMs,
    sandboxMode,
  };
}

function median(values: number[]): number {
  const sorted = [...values].toSorted((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return (sorted[middle - 1] + sorted[middle]) / 2;
  }
  return sorted[middle] ?? 0;
}

describe.runIf(liveEnabled)("@live CLI chat performance", () => {
  beforeAll(async () => {
    await ensureCliAuth();
    liveModel = await resolveLiveModel();
  });

  test(
    "reuses sandbox and speeds up follow-up messages",
    { timeout: Math.max(responseTimeoutMs * 5 + 60_000, 420_000) },
    async () => {
      const prompt = process.env.E2E_CHAT_PERF_PROMPT ?? "Reply with exactly: PERF_OK";
      const followupRuns = Number(process.env.E2E_CHAT_PERF_FOLLOWUP_RUNS ?? "3");
      const maxExpectedSlowFollowupRatio = Number(
        process.env.E2E_CHAT_PERF_MAX_FOLLOWUP_RATIO ?? "0.9",
      );

      const seed = `perf-${Date.now().toString(36)}-${randomUUID().slice(0, 8)}`;
      const first = await runChatMessage({
        message: `${prompt}\nSeed=${seed}`,
        model: liveModel,
        timeoutMs: responseTimeoutMs,
      });
      assertExitOk(first, "chat performance first message");

      const conversationId = extractConversationId(first.stdout);
      const firstTiming = parseTiming(first.stdout);
      expect(firstTiming.sandboxMode).toBe("created");

      const runFollowups = async (index: number, acc: ParsedTiming[]): Promise<ParsedTiming[]> => {
        if (index >= followupRuns) {
          return acc;
        }
        const followup = await runChatMessage({
          conversation: conversationId,
          message: `${prompt}\nFollowupRun=${index + 1}`,
          model: liveModel,
          timeoutMs: responseTimeoutMs,
        });
        assertExitOk(followup, `chat performance followup #${index + 1}`);
        expect(extractConversationId(followup.stdout)).toBe(conversationId);
        return runFollowups(index + 1, [...acc, parseTiming(followup.stdout)]);
      };

      const followupTimings = await runFollowups(0, []);

      const reusedRuns = followupTimings.filter((timing) => timing.sandboxMode === "reused").length;
      expect(reusedRuns).toBeGreaterThanOrEqual(Math.ceil(followupRuns / 2));

      const followupGenerationMedian = median(followupTimings.map((timing) => timing.generationMs));
      const followupAgentInitMedian = median(followupTimings.map((timing) => timing.agentInitMs));
      const followupSandboxMedian = median(
        followupTimings.map((timing) => timing.sandboxConnectOrCreateMs),
      );

      expect(followupGenerationMedian).toBeLessThan(firstTiming.generationMs);
      expect(followupGenerationMedian).toBeLessThan(
        firstTiming.generationMs * maxExpectedSlowFollowupRatio,
      );
      expect(followupAgentInitMedian).toBeLessThan(firstTiming.agentInitMs);
      expect(followupSandboxMedian).toBeLessThan(firstTiming.sandboxConnectOrCreateMs);
    },
  );
});
