import { describe, expect, test } from "vitest";
import { runSkillCli } from "../../_test-utils/run-skill-cli";

describe("notion CLI", () => {
  test("prints help text when auth env is missing", () => {
    const result = runSkillCli(
      "src/sandbox-templates/common/skills/notion/src/notion.ts",
      ["--help"],
      {
        NOTION_ACCESS_TOKEN: "",
      },
    );

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Commands");
  });

  test("prints help text when auth env is provided", () => {
    const result = runSkillCli(
      "src/sandbox-templates/common/skills/notion/src/notion.ts",
      ["--help"],
      {
        NOTION_ACCESS_TOKEN: "test-token",
      },
    );

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Notion CLI - Commands");
  });
});
