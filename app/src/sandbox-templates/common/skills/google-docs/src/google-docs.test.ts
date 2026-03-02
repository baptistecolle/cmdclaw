import { describe, expect, test } from "vitest";
import { runSkillCli } from "../../_test-utils/run-skill-cli";

describe("google-docs CLI", () => {
  test("prints help text when auth env is missing", () => {
    const result = runSkillCli(
      "src/sandbox-templates/common/skills/google-docs/src/google-docs.ts",
      ["--help"],
      {
        GOOGLE_DOCS_ACCESS_TOKEN: "",
      },
    );

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Commands");
  });

  test("prints help text when auth env is provided", () => {
    const result = runSkillCli(
      "src/sandbox-templates/common/skills/google-docs/src/google-docs.ts",
      ["--help"],
      {
        GOOGLE_DOCS_ACCESS_TOKEN: "test-token",
      },
    );

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Google Docs CLI - Commands");
  });
});
