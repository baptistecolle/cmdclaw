import { describe, expect, test } from "vitest";
import { runSkillCli } from "../../_test-utils/run-skill-cli";

describe("outlook-calendar CLI", () => {
  test("prints help text when auth env is missing", () => {
    const result = runSkillCli(
      "src/sandbox-templates/common/skills/outlook-calendar/src/outlook-calendar.ts",
      ["--help"],
      {
        OUTLOOK_CALENDAR_ACCESS_TOKEN: "",
      },
    );

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Commands");
  });

  test("prints help text when auth env is provided", () => {
    const result = runSkillCli(
      "src/sandbox-templates/common/skills/outlook-calendar/src/outlook-calendar.ts",
      ["--help"],
      {
        OUTLOOK_CALENDAR_ACCESS_TOKEN: "test-token",
      },
    );

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Outlook Calendar CLI - Commands");
    expect(result.stdout).toContain("list");
    expect(result.stdout).toContain("today");
  });
});
