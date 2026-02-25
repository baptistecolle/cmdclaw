import { describe, expect, test } from "vitest";
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

  test("parses linkedin nested and search operations", () => {
    const nested = parseCliCommand("linkedin posts create --text hello");
    expect(nested?.integration).toBe("linkedin");
    expect(nested?.operation).toBe("posts.create");
    expect(nested?.args.text).toBe("hello");

    const search = parseCliCommand("linkedin search --query founder");
    expect(search?.integration).toBe("linkedin");
    expect(search?.operation).toBe("search");
    expect(search?.args.query).toBe("founder");
  });

  test("parses all supported integration CLIs", () => {
    const cases: Array<{
      command: string;
      integration: string;
      operation: string;
    }> = [
      {
        command: "slack channels",
        integration: "slack",
        operation: "channels",
      },
      {
        command: "google-gmail list --limit 5",
        integration: "gmail",
        operation: "list",
      },
      {
        command: "google-calendar today",
        integration: "google_calendar",
        operation: "today",
      },
      {
        command: "google-docs get doc_123",
        integration: "google_docs",
        operation: "get",
      },
      {
        command: "google-sheets get sheet_123",
        integration: "google_sheets",
        operation: "get",
      },
      {
        command: "google-drive list",
        integration: "google_drive",
        operation: "list",
      },
      {
        command: "notion search --query roadmap",
        integration: "notion",
        operation: "search",
      },
      { command: "linear mine", integration: "linear", operation: "mine" },
      {
        command: "github prs --owner acme --repo app",
        integration: "github",
        operation: "prs",
      },
      {
        command: "airtable bases",
        integration: "airtable",
        operation: "bases",
      },
      {
        command: "hubspot owners",
        integration: "hubspot",
        operation: "owners",
      },
      {
        command: "salesforce objects",
        integration: "salesforce",
        operation: "objects",
      },
      {
        command: "reddit feed -l 10",
        integration: "reddit",
        operation: "feed",
      },
      {
        command: "twitter timeline -l 5",
        integration: "twitter",
        operation: "timeline",
      },
    ];

    for (const item of cases) {
      const parsed = parseCliCommand(item.command);
      expect(parsed?.integration).toBe(item.integration);
      expect(parsed?.operation).toBe(item.operation);
    }
  });

  test("rejects legacy short aliases", () => {
    expect(parseCliCommand("gcalendar list -l 1")).toBeNull();
    expect(parseCliCommand("gdocs list")).toBeNull();
    expect(parseCliCommand("gsheets list")).toBeNull();
    expect(parseCliCommand("gdrive list")).toBeNull();
  });

  test("parses boolean long and short flags", () => {
    const parsed = parseCliCommand("slack history -c C123 --inclusive -l 10");
    expect(parsed?.args.inclusive).toBe("true");
    expect(parsed?.args.c).toBe("C123");
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
