import { describe, expect, it } from "vitest";
import { isModelAccessibleForNewChat } from "./chat-model-access";

describe("isModelAccessibleForNewChat", () => {
  it("returns false for openai models when ChatGPT is disconnected", () => {
    expect(
      isModelAccessibleForNewChat({
        model: "openai/gpt-5.2-codex",
        isOpenAIConnected: false,
      }),
    ).toBe(false);
  });

  it("returns true for openai models when ChatGPT is connected", () => {
    expect(
      isModelAccessibleForNewChat({
        model: "openai/gpt-5.2-codex",
        isOpenAIConnected: true,
      }),
    ).toBe(true);
  });

  it("returns false for unknown openai model IDs", () => {
    expect(
      isModelAccessibleForNewChat({
        model: "openai/unknown",
        isOpenAIConnected: true,
      }),
    ).toBe(false);
  });

  it("validates opencode models against fetched model list when available", () => {
    expect(
      isModelAccessibleForNewChat({
        model: "opencode/glm-5-free",
        isOpenAIConnected: false,
        availableOpencodeFreeModelIDs: ["opencode/grok-code-fast-1"],
      }),
    ).toBe(false);
  });
});
