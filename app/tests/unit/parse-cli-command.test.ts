import { describe, expect, test } from "bun:test";
import { getFlagLabel, parseCliCommand } from "@/lib/parse-cli-command";

describe("parseCliCommand", () => {
  test("returns null for unknown CLI", () => {
    expect(parseCliCommand("echo hello")).toBeNull();
  });

  test("parses quoted arguments and long/short flags", () => {
    const parsed = parseCliCommand("slack send -c general --text='hello world' --thread=12345");

    expect(parsed).toEqual({
      integration: "slack",
      operation: "send",
      args: {
        c: "general",
        text: "hello world",
        thread: "12345",
      },
      positionalArgs: [],
      rawCommand: "slack send -c general --text='hello world' --thread=12345",
    });
  });

  test("parses hubspot nested operations", () => {
    const parsed = parseCliCommand("hubspot contacts update --id 42 --email user@example.com");
    expect(parsed?.integration).toBe("hubspot");
    expect(parsed?.operation).toBe("contacts.update");
    expect(parsed?.args.id).toBe("42");
  });

  test("keeps positional arguments", () => {
    const parsed = parseCliCommand("github search bug --state open -l 10");
    expect(parsed?.positionalArgs).toEqual(["bug"]);
    expect(parsed?.args.state).toBe("open");
    expect(parsed?.args.l).toBe("10");
  });
});

describe("getFlagLabel", () => {
  test("returns known labels", () => {
    expect(getFlagLabel("subject")).toBe("Subject");
    expect(getFlagLabel("t")).toBe("Text");
  });

  test("falls back to title-cased unknown flags", () => {
    expect(getFlagLabel("unknownFlag")).toBe("UnknownFlag");
  });
});
