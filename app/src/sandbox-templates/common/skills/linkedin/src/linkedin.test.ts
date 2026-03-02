import { describe, expect, test } from "vitest";
import { runSkillCli } from "../../_test-utils/run-skill-cli";

describe("linkedin CLI", () => {
  test("prints help text when auth env is missing", () => {
    const result = runSkillCli(
      "src/sandbox-templates/common/skills/linkedin/src/linkedin.ts",
      ["--help"],
      {
        UNIPILE_API_KEY: "",
        UNIPILE_DSN: "",
        LINKEDIN_ACCOUNT_ID: "",
      },
    );

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Commands");
  });

  test("prints help text when auth env is provided", () => {
    const result = runSkillCli(
      "src/sandbox-templates/common/skills/linkedin/src/linkedin.ts",
      ["--help"],
      {
        UNIPILE_API_KEY: "test-token",
        UNIPILE_DSN: "https://api1.unipile.com:13111",
        LINKEDIN_ACCOUNT_ID: "linkedin-account",
      },
    );

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("LinkedIn CLI (via Unipile) - Commands");
  });
});
