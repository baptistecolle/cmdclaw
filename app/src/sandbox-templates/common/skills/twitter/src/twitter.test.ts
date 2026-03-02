import { describe, expect, test } from "vitest";
import { runSkillCli } from "../../_test-utils/run-skill-cli";

describe("twitter CLI", () => {
  test("prints help text when auth env is missing", () => {
    const result = runSkillCli(
      "src/sandbox-templates/common/skills/twitter/src/twitter.ts",
      ["--help"],
      {
        TWITTER_ACCESS_TOKEN: "",
      },
    );

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Commands");
  });

  test("prints help text when auth env is provided", () => {
    const result = runSkillCli(
      "src/sandbox-templates/common/skills/twitter/src/twitter.ts",
      ["--help"],
      {
        TWITTER_ACCESS_TOKEN: "test-token",
      },
    );

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Twitter (X) CLI - Commands");
    expect(result.stdout).toContain("dms [-l limit]");
    expect(result.stdout).toContain("dms-latest-answered [-l limit]");
    expect(result.stdout).toContain("dm-event <eventId>");
  });
});
