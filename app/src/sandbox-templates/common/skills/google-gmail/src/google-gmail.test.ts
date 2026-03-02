import { describe, expect, test } from "vitest";
import { runSkillCli } from "../../_test-utils/run-skill-cli";

describe("google-gmail CLI", () => {
  test("prints help text when auth env is missing", () => {
    const result = runSkillCli(
      "src/sandbox-templates/common/skills/google-gmail/src/google-gmail.ts",
      ["--help"],
      {
        GMAIL_ACCESS_TOKEN: "",
      },
    );

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Commands");
  });

  test("prints help text when auth env is provided", () => {
    const result = runSkillCli(
      "src/sandbox-templates/common/skills/google-gmail/src/google-gmail.ts",
      ["--help"],
      {
        GMAIL_ACCESS_TOKEN: "test-token",
      },
    );

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Google Gmail CLI - Commands");
    expect(result.stdout).toContain("latest");
    expect(result.stdout).toContain("--scope inbox|all|strict-all");
    expect(result.stdout).toContain("draft --to <email> --subject <subject> --body <body>");
  });

  test("fails for unsupported scope value", () => {
    const result = runSkillCli(
      "src/sandbox-templates/common/skills/google-gmail/src/google-gmail.ts",
      ["list", "--scope", "archive-only"],
      {
        GMAIL_ACCESS_TOKEN: "test-token",
      },
    );

    expect(result.status).toBe(1);
    expect(result.combined).toContain("Invalid --scope");
  });
});
