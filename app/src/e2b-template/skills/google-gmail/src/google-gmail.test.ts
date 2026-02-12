import { describe, expect, test } from "vitest";
import { runSkillCli } from "../../_test-utils/run-skill-cli";

describe("google-gmail CLI", () => {
  test("fails fast when auth env is missing", () => {
    const result = runSkillCli("src/e2b-template/skills/google-gmail/src/google-gmail.ts", ["--help"], {
      GMAIL_ACCESS_TOKEN: "",

    });

    expect(result.status).toBe(1);
    expect(result.combined).toContain("GMAIL_ACCESS_TOKEN");
  });

  test("prints help text when auth env is provided", () => {
    const result = runSkillCli("src/e2b-template/skills/google-gmail/src/google-gmail.ts", ["--help"], {
      GMAIL_ACCESS_TOKEN: "test-token",

    });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Google Gmail CLI - Commands");
  });
});
