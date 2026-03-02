import { describe, expect, test } from "vitest";
import { runSkillCli } from "../../_test-utils/run-skill-cli";

describe("google-sheets CLI", () => {
  test("prints help text when auth env is missing", () => {
    const result = runSkillCli(
      "src/sandbox-templates/common/skills/google-sheets/src/google-sheets.ts",
      ["--help"],
      {
        GOOGLE_SHEETS_ACCESS_TOKEN: "",
      },
    );

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Google Sheets CLI - Commands");
  });

  test("prints help text when auth env is provided", () => {
    const result = runSkillCli(
      "src/sandbox-templates/common/skills/google-sheets/src/google-sheets.ts",
      ["--help"],
      {
        GOOGLE_SHEETS_ACCESS_TOKEN: "test-token",
      },
    );

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Google Sheets CLI - Commands");
  });
});
