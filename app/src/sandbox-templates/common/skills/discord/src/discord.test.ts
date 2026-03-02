import { describe, expect, test } from "vitest";
import { runSkillCli } from "../../_test-utils/run-skill-cli";

describe("discord CLI", () => {
  test("prints help text when auth env is missing", () => {
    const result = runSkillCli(
      "src/sandbox-templates/common/skills/discord/src/discord.ts",
      ["--help"],
      {
        DISCORD_BOT_TOKEN: "",
      },
    );

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Commands");
  });

  test("prints help text when auth env is provided", () => {
    const result = runSkillCli(
      "src/sandbox-templates/common/skills/discord/src/discord.ts",
      ["--help"],
      {
        DISCORD_BOT_TOKEN: "test-token",
      },
    );

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Discord CLI (Bot Token) - Commands");
  });
});
