import { describe, expect, test } from "vitest";
import {
  COMING_SOON_INTEGRATIONS,
  INTEGRATION_DISPLAY_NAMES,
  INTEGRATION_OPERATION_LABELS,
  WORKFLOW_AVAILABLE_INTEGRATION_TYPES,
  getCustomIntegrationDisplayInfo,
  getIntegrationActions,
  getIntegrationColor,
  getIntegrationDisplayName,
  getIntegrationIcon,
  getIntegrationLogo,
  isComingSoonIntegration,
  getOperationLabel,
} from "@/lib/integration-icons";

describe("integration-icons", () => {
  test("provides icon metadata for every supported integration", () => {
    for (const integration of Object.keys(INTEGRATION_DISPLAY_NAMES)) {
      expect(getIntegrationIcon(integration)).not.toBeNull();
      expect(getIntegrationDisplayName(integration)).toBe(
        INTEGRATION_DISPLAY_NAMES[integration as keyof typeof INTEGRATION_DISPLAY_NAMES],
      );
      expect(getIntegrationColor(integration)).toMatch(/^text-/);
      expect(getIntegrationLogo(integration)).toMatch(/^\/integrations\/.*\.svg$/);
    }
  });

  test("returns sane fallbacks for unknown integrations", () => {
    expect(getIntegrationIcon("unknown")).toBeNull();
    expect(getIntegrationDisplayName("unknown")).toBe("unknown");
    expect(getIntegrationColor("unknown")).toBe("text-muted-foreground");
    expect(getIntegrationLogo("unknown")).toBeNull();
    expect(getIntegrationActions("unknown")).toEqual([]);
  });

  test("formats known and unknown operation labels", () => {
    expect(getOperationLabel("slack", "channels")).toBe("Listing channels");
    expect(getOperationLabel("unknown", "create-issue")).toBe("Create Issue");
  });

  test("normalizes action labels for UI display", () => {
    const slackActions = getIntegrationActions("slack");
    expect(slackActions.find((item) => item.key === "channels")?.label).toBe("List channels");
    expect(slackActions.find((item) => item.key === "send")?.label).toBe("Send message");

    const linkedinActions = getIntegrationActions("linkedin");
    expect(linkedinActions.find((item) => item.key === "posts.comment")?.label).toBe(
      "Comment on post",
    );
    expect(linkedinActions.find((item) => item.key === "posts.react")?.label).toBe("React to post");
    expect(linkedinActions.find((item) => item.key === "messages.start")?.label).toBe(
      "Start conversation",
    );
  });

  test("exports operation labels for every integration", () => {
    for (const [integration, operations] of Object.entries(INTEGRATION_OPERATION_LABELS)) {
      expect(Object.keys(operations).length).toBeGreaterThan(0);
      for (const [operation, label] of Object.entries(operations)) {
        expect(typeof operation).toBe("string");
        expect(typeof label).toBe("string");
        expect(label.length).toBeGreaterThan(0);
      }
      expect(getIntegrationActions(integration).length).toBe(Object.keys(operations).length);
    }
  });

  test("returns custom integration defaults", () => {
    expect(getCustomIntegrationDisplayInfo("My CRM", "https://example.com/logo.svg")).toEqual({
      displayName: "My CRM",
      color: "text-indigo-500",
      iconUrl: "https://example.com/logo.svg",
    });

    expect(getCustomIntegrationDisplayInfo("My CRM")).toEqual({
      displayName: "My CRM",
      color: "text-indigo-500",
      iconUrl: null,
    });
  });

  test("exposes workflow-safe integrations from coming-soon flags", () => {
    for (const integration of WORKFLOW_AVAILABLE_INTEGRATION_TYPES) {
      expect(isComingSoonIntegration(integration)).toBe(false);
    }

    for (const integration of COMING_SOON_INTEGRATIONS) {
      expect(WORKFLOW_AVAILABLE_INTEGRATION_TYPES).not.toContain(integration);
    }
  });
});
