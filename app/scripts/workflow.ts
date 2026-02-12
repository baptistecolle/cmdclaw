import readline from "node:readline";
import { homedir } from "node:os";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createORPCClient } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";
import type { RouterClient } from "@orpc/server";
import type { AppRouter } from "../src/server/orpc";

type ChatConfig = {
  serverUrl: string;
  token: string;
};

const BAP_DIR = join(homedir(), ".bap");
const CONFIG_PATH = join(BAP_DIR, "chat-config.json");
const DEFAULT_SERVER_URL = "http://localhost:3000";

function loadConfig(): ChatConfig | null {
  try {
    if (!existsSync(CONFIG_PATH)) {return null;}
    const raw = readFileSync(CONFIG_PATH, "utf-8");
    return JSON.parse(raw) as ChatConfig;
  } catch {
    return null;
  }
}

function createClient(serverUrl: string, token: string): RouterClient<AppRouter> {
  const link = new RPCLink({
    url: `${serverUrl}/api/rpc`,
    headers: () => ({ Authorization: `Bearer ${token}` }),
  });
  return createORPCClient(link) as RouterClient<AppRouter>;
}

function createPrompt(): readline.Interface {
  return readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
}

function ask(rl: readline.Interface, query: string): Promise<string> {
  return new Promise((resolve) => rl.question(query, resolve));
}

// ── Helpers ──

function formatDate(d: Date | string | null | undefined): string {
  if (!d) {return "—";}
  const date = typeof d === "string" ? new Date(d) : d;
  return date.toLocaleString();
}

function statusBadge(status: string): string {
  const badges: Record<string, string> = {
    on: "[ON]",
    off: "[OFF]",
    running: "[RUNNING]",
    completed: "[DONE]",
    error: "[ERROR]",
    cancelled: "[CANCELLED]",
    awaiting_approval: "[AWAITING APPROVAL]",
    awaiting_auth: "[AWAITING AUTH]",
  };
  return badges[status] || `[${status.toUpperCase()}]`;
}

// ── Commands ──

async function listWorkflows(client: RouterClient<AppRouter>): Promise<void> {
  const workflows = await client.workflow.list();
  if (workflows.length === 0) {
    console.log("\nNo workflows found.\n");
    return;
  }
  console.log(`\n  Workflows (${workflows.length}):\n`);
  for (const wf of workflows) {
    const lastRun = wf.lastRunStatus
      ? ` | last run: ${statusBadge(wf.lastRunStatus)} ${formatDate(wf.lastRunAt)}`
      : "";
    console.log(`  ${statusBadge(wf.status)}  ${wf.name}`);
    console.log(`         id: ${wf.id} | trigger: ${wf.triggerType}${lastRun}`);
    console.log();
  }
}

async function getWorkflow(client: RouterClient<AppRouter>, id: string): Promise<void> {
  const wf = await client.workflow.get({ id });
  console.log(`\n  Workflow: ${wf.name}`);
  console.log(`  ID:      ${wf.id}`);
  console.log(`  Status:  ${statusBadge(wf.status)}`);
  console.log(`  Trigger: ${wf.triggerType}`);
  if (wf.schedule) {console.log(`  Schedule: ${JSON.stringify(wf.schedule)}`);}
  console.log(
    `  Integrations: ${wf.allowedIntegrations.length > 0 ? wf.allowedIntegrations.join(", ") : "none"}`,
  );
  if (wf.allowedCustomIntegrations.length > 0)
    {console.log(`  Custom Integrations: ${wf.allowedCustomIntegrations.join(", ")}`);}
  console.log(`  Created: ${formatDate(wf.createdAt)}`);
  console.log(`  Updated: ${formatDate(wf.updatedAt)}`);
  console.log(`\n  Prompt:\n    ${wf.prompt.replace(/\n/g, "\n    ")}`);
  if (wf.promptDo) {console.log(`\n  Do:\n    ${wf.promptDo.replace(/\n/g, "\n    ")}`);}
  if (wf.promptDont) {console.log(`\n  Don't:\n    ${wf.promptDont.replace(/\n/g, "\n    ")}`);}

  if (wf.runs.length > 0) {
    console.log(`\n  Recent runs (${wf.runs.length}):`);
    for (const run of wf.runs) {
      console.log(
        `    ${statusBadge(run.status)}  ${run.id}  started: ${formatDate(run.startedAt)}${run.errorMessage ? `  error: ${run.errorMessage}` : ""}`,
      );
    }
  }
  console.log();
}

async function createWorkflow(
  client: RouterClient<AppRouter>,
  opts: {
    name: string;
    triggerType: string;
    prompt: string;
    integrations?: WorkflowIntegrationType[];
    schedule?: WorkflowSchedule;
  },
): Promise<void> {
  const result = await client.workflow.create({
    name: opts.name,
    triggerType: opts.triggerType,
    prompt: opts.prompt,
    allowedIntegrations: opts.integrations ?? [],
    schedule: opts.schedule,
  });

  console.log(
    `\n  Created workflow: ${result.name} (${result.id}) ${statusBadge(result.status)}\n`,
  );
}

async function deleteWorkflow(client: RouterClient<AppRouter>, id: string): Promise<void> {
  await client.workflow.delete({ id });
  console.log(`\n  Deleted workflow ${id}\n`);
}

async function toggleWorkflow(
  client: RouterClient<AppRouter>,
  id: string,
  status: "on" | "off",
): Promise<void> {
  await client.workflow.update({ id, status });
  console.log(`\n  Workflow ${id} is now ${statusBadge(status)}\n`);
}

async function triggerWorkflow(
  client: RouterClient<AppRouter>,
  id: string,
  payloadStr?: string,
): Promise<void> {
  let payload: unknown = {};
  if (payloadStr) {
    try {
      payload = JSON.parse(payloadStr);
    } catch {
      console.error("Invalid JSON payload.");
      return;
    }
  }

  const result = await client.workflow.trigger({ id, payload });
  console.log(`\n  Triggered workflow ${result.workflowId}`);
  console.log(`  Run ID:         ${result.runId}`);
  console.log(`  Generation ID:  ${result.generationId}`);
  console.log(`  Conversation:   ${result.conversationId}\n`);
}

async function viewRun(client: RouterClient<AppRouter>, id: string): Promise<void> {
  const run = await client.workflow.getRun({ id });
  console.log(`\n  Run: ${run.id}`);
  console.log(`  Workflow: ${run.workflowId}`);
  console.log(`  Status:   ${statusBadge(run.status)}`);
  console.log(`  Started:  ${formatDate(run.startedAt)}`);
  console.log(`  Finished: ${formatDate(run.finishedAt)}`);
  if (run.generationId) {console.log(`  Generation: ${run.generationId}`);}
  if (run.errorMessage) {console.log(`  Error: ${run.errorMessage}`);}
  if (run.triggerPayload)
    {console.log(`  Trigger payload: ${JSON.stringify(run.triggerPayload, null, 2)}`);}

  if (run.events.length > 0) {
    console.log(`\n  Events (${run.events.length}):`);
    for (const evt of run.events) {
      console.log(`    [${evt.type}] ${formatDate(evt.createdAt)}  ${JSON.stringify(evt.payload)}`);
    }
  }
  console.log();
}

async function listRuns(client: RouterClient<AppRouter>, workflowId: string): Promise<void> {
  const runs = await client.workflow.listRuns({ workflowId });
  if (runs.length === 0) {
    console.log("\n  No runs found.\n");
    return;
  }
  console.log(`\n  Runs for workflow ${workflowId} (${runs.length}):\n`);
  for (const run of runs) {
    console.log(
      `  ${statusBadge(run.status)}  ${run.id}  started: ${formatDate(run.startedAt)}${run.errorMessage ? `  error: ${run.errorMessage}` : ""}`,
    );
  }
  console.log();
}

// ── Interactive loop ──

function printUsage(): void {
  console.log(`
  Workflow CLI Commands:

    list                          List all workflows
    get <id>                      Show workflow details and recent runs
    create                        Create a new workflow (interactive)
    delete <id>                   Delete a workflow
    enable <id>                   Turn workflow on
    disable <id>                  Turn workflow off
    trigger <id> [json-payload]   Trigger a workflow run
    runs <workflow-id>            List runs for a workflow
    run <run-id>                  View run details and events
    help                          Show this help
    exit                          Quit
`);
}

async function interactiveLoop(client: RouterClient<AppRouter>): Promise<void> {
  const rl = createPrompt();

  rl.on("SIGINT", () => {
    console.log("\nBye.");
    rl.close();
    process.exit(0);
  });

  printUsage();

  while (true) {
    const line = (await ask(rl, "workflow> ")).trim();
    if (!line) {continue;}

    const [cmd, ...rest] = line.split(/\s+/);
    const arg1 = rest[0];
    const arg2 = rest.slice(1).join(" ");

    try {
      switch (cmd) {
        case "list":
        case "ls":
          await listWorkflows(client);
          break;
        case "get":
        case "show":
          if (!arg1) {
            console.log("Usage: get <id>");
            break;
          }
          await getWorkflow(client, arg1);
          break;
        case "create":
        case "new":
          console.log(
            "  Use non-interactive mode: bun run workflow create --name '...' --trigger '...' --prompt '...'",
          );
          break;
        case "delete":
        case "rm":
          if (!arg1) {
            console.log("Usage: delete <id>");
            break;
          }
          await deleteWorkflow(client, arg1);
          break;
        case "enable":
        case "on":
          if (!arg1) {
            console.log("Usage: enable <id>");
            break;
          }
          await toggleWorkflow(client, arg1, "on");
          break;
        case "disable":
        case "off":
          if (!arg1) {
            console.log("Usage: disable <id>");
            break;
          }
          await toggleWorkflow(client, arg1, "off");
          break;
        case "trigger":
        case "fire":
          if (!arg1) {
            console.log("Usage: trigger <id> [json-payload]");
            break;
          }
          await triggerWorkflow(client, arg1, arg2 || undefined);
          break;
        case "runs":
          if (!arg1) {
            console.log("Usage: runs <workflow-id>");
            break;
          }
          await listRuns(client, arg1);
          break;
        case "run":
          if (!arg1) {
            console.log("Usage: run <run-id>");
            break;
          }
          await viewRun(client, arg1);
          break;
        case "help":
        case "?":
          printUsage();
          break;
        case "exit":
        case "quit":
        case "q":
          console.log("Bye.");
          rl.close();
          return;
        default:
          console.log(`Unknown command: ${cmd}. Type 'help' for commands.`);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`  Error: ${message}`);
    }
  }
}

// ── Non-interactive mode ──

type ParsedArgs = {
  serverUrl?: string;
  command?: string;
  args: string[];
  // create flags
  name?: string;
  triggerType?: string;
  prompt?: string;
  integrations?: string[];
  scheduleType?: string;
  scheduleInterval?: number;
  scheduleTime?: string;
  scheduleDays?: number[];
  scheduleDayOfMonth?: number;
};

const integrationTypes = [
  "gmail",
  "google_calendar",
  "google_docs",
  "google_sheets",
  "google_drive",
  "notion",
  "linear",
  "github",
  "airtable",
  "slack",
  "hubspot",
  "linkedin",
  "salesforce",
  "reddit",
  "twitter",
] as const;
type WorkflowIntegrationType = (typeof integrationTypes)[number];

type WorkflowSchedule =
  | { type: "interval"; intervalMinutes: number }
  | { type: "daily"; time: string; timezone?: string }
  | { type: "weekly"; time: string; daysOfWeek: number[]; timezone?: string }
  | { type: "monthly"; time: string; dayOfMonth: number; timezone?: string };

function isWorkflowIntegrationType(value: string): value is WorkflowIntegrationType {
  return (integrationTypes as readonly string[]).includes(value);
}

function parseArgs(argv: string[]): ParsedArgs {
  const result: ParsedArgs = { args: [] };

  let i = 0;
  while (i < argv.length) {
    const arg = argv[i];
    if (arg === "--server" || arg === "-s") {
      result.serverUrl = argv[i + 1];
      i += 2;
    } else if (arg === "--name" || arg === "-n") {
      result.name = argv[i + 1];
      i += 2;
    } else if (arg === "--trigger" || arg === "-t") {
      result.triggerType = argv[i + 1];
      i += 2;
    } else if (arg === "--prompt" || arg === "-p") {
      result.prompt = argv[i + 1];
      i += 2;
    } else if (arg === "--integrations" || arg === "-i") {
      result.integrations = argv[i + 1]!.split(",").map((s) => s.trim());
      i += 2;
    } else if (arg === "--schedule-type") {
      result.scheduleType = argv[i + 1];
      i += 2;
    } else if (arg === "--schedule-interval") {
      result.scheduleInterval = parseInt(argv[i + 1]!, 10);
      i += 2;
    } else if (arg === "--schedule-time") {
      result.scheduleTime = argv[i + 1];
      i += 2;
    } else if (arg === "--schedule-days") {
      result.scheduleDays = argv[i + 1]!.split(",").map(Number);
      i += 2;
    } else if (arg === "--schedule-day-of-month") {
      result.scheduleDayOfMonth = parseInt(argv[i + 1]!, 10);
      i += 2;
    } else if (arg === "--help" || arg === "-h") {
      printCliHelp();
      process.exit(0);
    } else {
      if (!result.command) {
        result.command = arg!;
      } else {
        result.args.push(arg!);
      }
      i += 1;
    }
  }

  return result;
}

function buildSchedule(parsed: ParsedArgs): WorkflowSchedule | undefined {
  if (!parsed.scheduleType) {return undefined;}
  switch (parsed.scheduleType) {
    case "interval":
      return {
        type: "interval",
        intervalMinutes: parsed.scheduleInterval ?? 60,
      };
    case "daily":
      return { type: "daily", time: parsed.scheduleTime ?? "09:00" };
    case "weekly":
      return {
        type: "weekly",
        time: parsed.scheduleTime ?? "09:00",
        daysOfWeek: parsed.scheduleDays ?? [1],
      };
    case "monthly":
      return {
        type: "monthly",
        time: parsed.scheduleTime ?? "09:00",
        dayOfMonth: parsed.scheduleDayOfMonth ?? 1,
      };
    default:
      return undefined;
  }
}

function printCliHelp(): void {
  console.log(`
Usage: bun run workflow [options] [command] [args]

Options:
  -s, --server <url>              Server URL (default http://localhost:3000)
  -h, --help                      Show help

Commands:
  list                            List workflows
  get <id>                        Show workflow details
  create                          Create workflow (requires flags below)
  delete <id>                     Delete workflow
  enable <id>                     Turn on
  disable <id>                    Turn off
  trigger <id> [json-payload]     Trigger a run
  runs <workflow-id>              List runs
  run <run-id>                    View run details

Create flags:
  -n, --name <name>               Workflow name (required)
  -t, --trigger <type>            Trigger type (required): gmail.new_email, schedule
  -p, --prompt <instructions>     Agent instructions (required)
  -i, --integrations <list>       Comma-separated integrations: gmail,github,slack,...
  --schedule-type <type>          Schedule type: interval, daily, weekly, monthly
  --schedule-interval <minutes>   Interval in minutes (for interval schedule)
  --schedule-time <HH:MM>         Time (for daily/weekly/monthly)
  --schedule-days <0,1,...>       Days of week 0=Sun..6=Sat (for weekly)
  --schedule-day-of-month <1-31>  Day of month (for monthly)

Interactive mode:
  Run without a command to enter interactive mode.
`);
}

async function main(): Promise<void> {
  const parsed = parseArgs(process.argv.slice(2));

  const config = loadConfig();
  if (!config || !config.token) {
    console.error("Not authenticated. Run 'bun run chat --auth' first.");
    process.exit(1);
  }

  const serverUrl =
    parsed.serverUrl || config.serverUrl || process.env.BAP_SERVER_URL || DEFAULT_SERVER_URL;
  const client = createClient(serverUrl, config.token);

  // Non-interactive: run single command
  if (parsed.command) {
    try {
      switch (parsed.command) {
        case "list":
        case "ls":
          await listWorkflows(client);
          break;
        case "get":
        case "show":
          await getWorkflow(client, parsed.args[0]!);
          break;
        case "delete":
        case "rm":
          await deleteWorkflow(client, parsed.args[0]!);
          break;
        case "enable":
        case "on":
          await toggleWorkflow(client, parsed.args[0]!, "on");
          break;
        case "disable":
        case "off":
          await toggleWorkflow(client, parsed.args[0]!, "off");
          break;
        case "trigger":
        case "fire":
          await triggerWorkflow(client, parsed.args[0]!, parsed.args[1]);
          break;
        case "runs":
          await listRuns(client, parsed.args[0]!);
          break;
        case "run":
          await viewRun(client, parsed.args[0]!);
          break;
        case "create":
        case "new": {
          if (!parsed.name || !parsed.triggerType || !parsed.prompt) {
            console.error("Error: create requires --name, --trigger, and --prompt flags.");
            console.error(
              "Example: bun run workflow create --name 'My Workflow' --trigger schedule --prompt 'Do something'",
            );
            process.exit(1);
          }
          await createWorkflow(client, {
            name: parsed.name,
            triggerType: parsed.triggerType,
            prompt: parsed.prompt,
            integrations: parsed.integrations?.filter(isWorkflowIntegrationType),
            schedule: buildSchedule(parsed),
          });
          break;
        }
        default:
          console.error(`Unknown command: ${parsed.command}`);
          process.exit(1);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`Error: ${message}`);
      process.exit(1);
    }
    return;
  }

  // Interactive mode
  await interactiveLoop(client);
}

void main();
