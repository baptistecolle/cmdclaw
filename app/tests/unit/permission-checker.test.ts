import { describe, expect, test } from "vitest";
import {
  checkToolPermissions,
  parseBashCommand,
} from "@/server/ai/permission-checker";

describe("parseBashCommand", () => {
  test("returns null for non-integration commands", () => {
    expect(parseBashCommand("echo hello")).toBeNull();
  });

  test("parses standard integration commands", () => {
    expect(parseBashCommand("slack send --channel general -t hi")).toEqual({
      integration: "slack",
      operation: "send",
      integrationName: "Slack",
      isWrite: true,
    });
  });

  test("parses hubspot nested resource/action operations", () => {
    expect(
      parseBashCommand("hubspot contacts create --email user@example.com"),
    ).toEqual({
      integration: "hubspot",
      operation: "contacts.create",
      integrationName: "HubSpot",
      isWrite: true,
    });
  });

  test("parses linkedin nested resource/action operations", () => {
    expect(parseBashCommand("linkedin chats list --limit 5")).toEqual({
      integration: "linkedin",
      operation: "chats.list",
      integrationName: "LinkedIn",
      isWrite: false,
    });
  });

  test("parses twitter and reddit operations", () => {
    expect(parseBashCommand("twitter post --text hello")).toEqual({
      integration: "twitter",
      operation: "post",
      integrationName: "X (Twitter)",
      isWrite: true,
    });

    expect(parseBashCommand("reddit feed --limit 5")).toEqual({
      integration: "reddit",
      operation: "feed",
      integrationName: "Reddit",
      isWrite: false,
    });
  });
});

describe("checkToolPermissions", () => {
  test("auto-allows non-bash tools", () => {
    expect(checkToolPermissions("web_search", {}, [])).toEqual({
      allowed: true,
      needsApproval: false,
      needsAuth: false,
    });
  });

  test("auto-allows non-integration bash commands", () => {
    expect(checkToolPermissions("bash", { command: "ls -la" }, [])).toEqual({
      allowed: true,
      needsApproval: false,
      needsAuth: false,
    });
  });

  test("requires auth when integration is missing", () => {
    expect(
      checkToolPermissions("bash", { command: "slack channels" }, []),
    ).toEqual({
      allowed: false,
      needsApproval: false,
      needsAuth: true,
      integration: "slack",
      integrationName: "Slack",
      reason: "Slack authentication required",
    });
  });

  test("requires approval for write commands with auth", () => {
    expect(
      checkToolPermissions("bash", { command: "slack send -c general -t hi" }, [
        "slack",
      ]),
    ).toEqual({
      allowed: false,
      needsApproval: true,
      needsAuth: false,
      integration: "slack",
      integrationName: "Slack",
    });
  });

  test("allows read commands with auth", () => {
    expect(
      checkToolPermissions("bash", { command: "github prs" }, ["github"]),
    ).toEqual({
      allowed: true,
      needsApproval: false,
      needsAuth: false,
    });
  });

  test("requires auth for twitter when integration token is missing", () => {
    expect(
      checkToolPermissions("bash", { command: "twitter timeline -l 5" }, []),
    ).toEqual({
      allowed: false,
      needsApproval: false,
      needsAuth: true,
      integration: "twitter",
      integrationName: "X (Twitter)",
      reason: "X (Twitter) authentication required",
    });
  });

  test("requires approval for reddit write operations with auth", () => {
    expect(
      checkToolPermissions(
        "bash",
        { command: "reddit comment --id t3_123 --text hi" },
        ["reddit"],
      ),
    ).toEqual({
      allowed: false,
      needsApproval: true,
      needsAuth: false,
      integration: "reddit",
      integrationName: "Reddit",
    });
  });

  test("allows reddit read operations when auth exists", () => {
    expect(
      checkToolPermissions("bash", { command: "reddit feed -l 10" }, [
        "reddit",
      ]),
    ).toEqual({
      allowed: true,
      needsApproval: false,
      needsAuth: false,
    });
  });
});
