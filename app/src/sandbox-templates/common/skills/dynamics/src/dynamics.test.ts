import { describe, expect, test } from "vitest";
import { runSkillCli } from "../../_test-utils/run-skill-cli";

describe("dynamics CLI", () => {
  test("prints help text when auth env is missing", () => {
    const result = runSkillCli(
      "src/sandbox-templates/common/skills/dynamics/src/dynamics.ts",
      ["--help"],
      {
        DYNAMICS_ACCESS_TOKEN: "",
        DYNAMICS_INSTANCE_URL: "",
      },
    );

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Usage:");
  });

  test("fails fast when auth env is missing", () => {
    const result = runSkillCli("src/sandbox-templates/common/skills/dynamics/src/dynamics.ts", [], {
      DYNAMICS_ACCESS_TOKEN: "",
      DYNAMICS_INSTANCE_URL: "",
    });

    expect(result.status).toBe(1);
    expect(result.stdout).toContain("AUTH_REQUIRED");
  });

  test("returns usage for invalid command", () => {
    const result = runSkillCli(
      "src/sandbox-templates/common/skills/dynamics/src/dynamics.ts",
      ["invalid"],
      {
        DYNAMICS_ACCESS_TOKEN: "token",
        DYNAMICS_INSTANCE_URL: "https://example.crm.dynamics.com",
      },
    );

    expect(result.status).toBe(1);
    expect(result.stdout).toContain("Usage: dynamics");
  });
});
