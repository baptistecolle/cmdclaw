import { describe, expect, test } from "vitest";
import { runSkillCli } from "../../_test-utils/run-skill-cli";

describe("google-drive CLI", () => {
  test("fails fast when auth env is missing", () => {
    const result = runSkillCli(
      "src/sandbox-templates/common/skills/google-drive/src/google-drive.ts",
      ["--help"],
      {
        GOOGLE_DRIVE_ACCESS_TOKEN: "",
      },
    );

    expect(result.status).toBe(1);
    expect(result.combined).toContain("GOOGLE_DRIVE_ACCESS_TOKEN");
  });

  test("prints help text when auth env is provided", () => {
    const result = runSkillCli(
      "src/sandbox-templates/common/skills/google-drive/src/google-drive.ts",
      ["--help"],
      {
        GOOGLE_DRIVE_ACCESS_TOKEN: "test-token",
      },
    );

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Google Drive CLI - Commands");
  });
});
