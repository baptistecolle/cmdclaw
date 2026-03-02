import { describe, expect, test } from "vitest";
import { runSkillCli } from "../../_test-utils/run-skill-cli";

describe("outlook-mail CLI", () => {
  test("prints help text when auth env is missing", () => {
    const result = runSkillCli(
      "src/sandbox-templates/common/skills/outlook-mail/src/outlook-mail.ts",
      ["--help"],
      {
        OUTLOOK_ACCESS_TOKEN: "",
      },
    );

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Commands");
  });

  test("prints help text when auth env is provided", () => {
    const result = runSkillCli(
      "src/sandbox-templates/common/skills/outlook-mail/src/outlook-mail.ts",
      ["--help"],
      {
        OUTLOOK_ACCESS_TOKEN: "test-token",
      },
    );

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Outlook Mail CLI - Commands");
    expect(result.stdout).toContain("list");
    expect(result.stdout).toContain("unread");
  });

  test("fails for invalid limit value", () => {
    const result = runSkillCli(
      "src/sandbox-templates/common/skills/outlook-mail/src/outlook-mail.ts",
      ["list", "--limit", "0"],
      {
        OUTLOOK_ACCESS_TOKEN: "test-token",
      },
    );

    expect(result.status).toBe(1);
    expect(result.combined).toContain("Invalid --limit");
  });
});
