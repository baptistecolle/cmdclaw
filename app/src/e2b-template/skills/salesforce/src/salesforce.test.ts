import { describe, expect, test } from "vitest";
import { runSkillCli } from "../../_test-utils/run-skill-cli";

describe("salesforce CLI", () => {
  test("fails fast when auth env is missing", () => {
    const result = runSkillCli("src/e2b-template/skills/salesforce/src/salesforce.ts", [], {
      SALESFORCE_ACCESS_TOKEN: "",
      SALESFORCE_INSTANCE_URL: "",
    });

    expect(result.status).toBe(1);
    expect(result.stdout).toContain("AUTH_REQUIRED");
  });

  test("returns command list for unknown command", () => {
    const result = runSkillCli(
      "src/e2b-template/skills/salesforce/src/salesforce.ts",
      ["unknown"],
      {
        SALESFORCE_ACCESS_TOKEN: "test-token",
        SALESFORCE_INSTANCE_URL: "https://example.my.salesforce.com",
      },
    );

    expect(result.status).toBe(1);
    expect(result.stdout).toContain("availableCommands");
  });
});
