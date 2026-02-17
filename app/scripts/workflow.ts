import type { RouterClient } from "@orpc/server";
import type { AppRouter } from "../src/server/orpc";
import { formatPersistedChatTranscript } from "../src/components/chat/chat-transcript";
import { DEFAULT_SERVER_URL, createRpcClient, loadConfig } from "./lib/cli-shared";

type ParsedArgs = {
  serverUrl?: string;
  command?: string;
  positionals: string[];
  // Generic command flags
  payload?: string;
  watch: boolean;
  watchIntervalSeconds: number;
  limit?: number;
  // Create flags
  name?: string;
  triggerType?: string;
  prompt?: string;
  promptDo?: string;
  promptDont?: string;
  integrations?: string[];
  customIntegrations?: string[];
  autoApprove?: boolean;
  scheduleType?: string;
  scheduleInterval?: number;
  scheduleTime?: string;
  scheduleDays?: number[];
  scheduleDayOfMonth?: number;
};

type WorkflowIntegrationType =
  | "gmail"
  | "google_calendar"
  | "google_docs"
  | "google_sheets"
  | "google_drive"
  | "notion"
  | "linear"
  | "github"
  | "airtable"
  | "slack"
  | "hubspot"
  | "linkedin"
  | "salesforce"
  | "reddit"
  | "twitter";

const integrationTypes = new Set<WorkflowIntegrationType>([
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
]);

type WorkflowSchedule =
  | { type: "interval"; intervalMinutes: number }
  | { type: "daily"; time: string; timezone?: string }
  | { type: "weekly"; time: string; daysOfWeek: number[]; timezone?: string }
  | { type: "monthly"; time: string; dayOfMonth: number; timezone?: string };

const TERMINAL_STATUSES = new Set(["completed", "cancelled", "error", "success", "failed"]);

function parseArgs(argv: string[]): ParsedArgs {
  const args: ParsedArgs = {
    positionals: [],
    watch: false,
    watchIntervalSeconds: 2,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];

    switch (arg) {
      case "--server":
      case "-s":
        args.serverUrl = argv[i + 1];
        i += 1;
        break;
      case "--payload":
      case "-P":
        args.payload = argv[i + 1];
        i += 1;
        break;
      case "--watch":
        args.watch = true;
        break;
      case "--watch-interval": {
        const parsed = Number(argv[i + 1]);
        if (!Number.isFinite(parsed) || parsed <= 0) {
          throw new Error("--watch-interval must be a positive number of seconds");
        }
        args.watchIntervalSeconds = parsed;
        i += 1;
        break;
      }
      case "--limit": {
        const parsed = Number(argv[i + 1]);
        if (!Number.isInteger(parsed) || parsed <= 0) {
          throw new Error("--limit must be a positive integer");
        }
        args.limit = parsed;
        i += 1;
        break;
      }
      case "--name":
      case "-n":
        args.name = argv[i + 1];
        i += 1;
        break;
      case "--trigger":
      case "-t":
        args.triggerType = argv[i + 1];
        i += 1;
        break;
      case "--prompt":
      case "-p":
        args.prompt = argv[i + 1];
        i += 1;
        break;
      case "--prompt-do":
        args.promptDo = argv[i + 1];
        i += 1;
        break;
      case "--prompt-dont":
        args.promptDont = argv[i + 1];
        i += 1;
        break;
      case "--integrations":
      case "-i":
        args.integrations = splitCsv(argv[i + 1]);
        i += 1;
        break;
      case "--custom-integrations":
        args.customIntegrations = splitCsv(argv[i + 1]);
        i += 1;
        break;
      case "--auto-approve":
        args.autoApprove = true;
        break;
      case "--no-auto-approve":
        args.autoApprove = false;
        break;
      case "--schedule-type":
        args.scheduleType = argv[i + 1];
        i += 1;
        break;
      case "--schedule-interval":
        args.scheduleInterval = Number(argv[i + 1]);
        i += 1;
        break;
      case "--schedule-time":
        args.scheduleTime = argv[i + 1];
        i += 1;
        break;
      case "--schedule-days":
        args.scheduleDays = splitCsv(argv[i + 1]).map(Number);
        i += 1;
        break;
      case "--schedule-day-of-month":
        args.scheduleDayOfMonth = Number(argv[i + 1]);
        i += 1;
        break;
      case "--help":
      case "-h":
        printHelp();
        process.exit(0);
      default:
        if (arg?.startsWith("-")) {
          throw new Error(`Unknown flag: ${arg}`);
        }

        if (!args.command) {
          args.command = arg;
        } else {
          args.positionals.push(arg);
        }
    }
  }

  return args;
}

function splitCsv(input: string | undefined): string[] {
  if (!input) {
    return [];
  }
  return input
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
}

function formatDate(value: Date | string | null | undefined): string {
  if (!value) {
    return "-";
  }
  const date = typeof value === "string" ? new Date(value) : value;
  return date.toLocaleString();
}

function statusBadge(status: string): string {
  const badges: Record<string, string> = {
    on: "[ON]",
    off: "[OFF]",
    running: "[RUNNING]",
    completed: "[DONE]",
    success: "[DONE]",
    failed: "[FAILED]",
    error: "[ERROR]",
    cancelled: "[CANCELLED]",
    awaiting_approval: "[AWAITING APPROVAL]",
    awaiting_auth: "[AWAITING AUTH]",
  };
  return badges[status] ?? `[${status.toUpperCase()}]`;
}

function isWorkflowIntegrationType(value: string): value is WorkflowIntegrationType {
  return integrationTypes.has(value as WorkflowIntegrationType);
}

function parsePayload(payload: string | undefined): unknown {
  if (!payload) {
    return {};
  }

  try {
    return JSON.parse(payload);
  } catch {
    throw new Error("Invalid JSON for --payload");
  }
}

function buildSchedule(args: ParsedArgs): WorkflowSchedule | undefined {
  if (!args.scheduleType) {
    return undefined;
  }

  switch (args.scheduleType) {
    case "interval": {
      const intervalMinutes = args.scheduleInterval ?? 60;
      if (!Number.isInteger(intervalMinutes) || intervalMinutes <= 0) {
        throw new Error("--schedule-interval must be a positive integer (minutes)");
      }
      return { type: "interval", intervalMinutes };
    }
    case "daily":
      return { type: "daily", time: args.scheduleTime ?? "09:00" };
    case "weekly": {
      const days = args.scheduleDays ?? [1];
      if (!days.every((day) => Number.isInteger(day) && day >= 0 && day <= 6)) {
        throw new Error("--schedule-days must be comma-separated integers between 0 and 6");
      }
      return { type: "weekly", time: args.scheduleTime ?? "09:00", daysOfWeek: days };
    }
    case "monthly": {
      const dayOfMonth = args.scheduleDayOfMonth ?? 1;
      if (!Number.isInteger(dayOfMonth) || dayOfMonth < 1 || dayOfMonth > 31) {
        throw new Error("--schedule-day-of-month must be an integer between 1 and 31");
      }
      return {
        type: "monthly",
        time: args.scheduleTime ?? "09:00",
        dayOfMonth,
      };
    }
    default:
      throw new Error("--schedule-type must be one of: interval, daily, weekly, monthly");
  }
}

function printHelp(): void {
  console.log("\nUsage: bun run workflow [options] <command>\n");
  console.log("Options:");
  console.log("  -s, --server <url>                Server URL (default http://localhost:3000)");
  console.log("  -h, --help                        Show help");
  console.log("\nCommands:");
  console.log("  list                              List workflows");
  console.log("  create                            Create workflow (flags below)");
  console.log("  run <workflow-id>                 Trigger a workflow run");
  console.log("  logs <run-id>                     Show run events and transcript");
  console.log("  approve <run-id> <tool-use-id> <approve|deny>  Submit pending approval");
  console.log("\nAliases:");
  console.log("  trigger <workflow-id>             Alias of run");
  console.log("  show-run <run-id>                 Alias of logs");
  console.log("  runs <workflow-id>                List recent runs for a workflow");
  console.log("\nRun flags:");
  console.log("  -P, --payload <json>              JSON payload for run/trigger");
  console.log("  --watch                           Poll until run reaches terminal status");
  console.log("  --watch-interval <seconds>        Polling interval for --watch (default 2)");
  console.log("\nLogs/Runs flags:");
  console.log(
    "  --limit <n>                       Limit run list size for runs command (default 20)",
  );
  console.log("  --watch                           Poll run logs until terminal status");
  console.log("\nCreate flags:");
  console.log("  -n, --name <name>                 Workflow name (required)");
  console.log("  -t, --trigger <type>              Trigger type (required)");
  console.log("  -p, --prompt <instructions>       Agent instructions (required)");
  console.log("  --prompt-do <text>                Optional DO guidance");
  console.log("  --prompt-dont <text>              Optional DON'T guidance");
  console.log("  -i, --integrations <csv>          Allowed integrations");
  console.log("  --custom-integrations <csv>       Allowed custom integration names");
  console.log("  --auto-approve                    Enable auto-approval");
  console.log("  --no-auto-approve                 Disable auto-approval");
  console.log("  --schedule-type <type>            interval | daily | weekly | monthly");
  console.log("  --schedule-interval <minutes>     Used by interval schedules");
  console.log("  --schedule-time <HH:MM>           Used by daily/weekly/monthly schedules");
  console.log("  --schedule-days <0,1,..6>         Used by weekly schedules");
  console.log("  --schedule-day-of-month <1-31>    Used by monthly schedules\n");
}

async function listWorkflows(client: RouterClient<AppRouter>): Promise<void> {
  const workflows = await client.workflow.list();

  if (workflows.length === 0) {
    console.log("No workflows found.");
    return;
  }

  console.log(`Workflows (${workflows.length}):\n`);
  for (const wf of workflows) {
    const lastRun = wf.lastRunStatus
      ? ` | last run: ${statusBadge(wf.lastRunStatus)} ${formatDate(wf.lastRunAt)}`
      : "";

    console.log(`${statusBadge(wf.status)} ${wf.name}`);
    console.log(`  id: ${wf.id}`);
    console.log(`  trigger: ${wf.triggerType}${lastRun}`);
    if (wf.schedule) {
      console.log(`  schedule: ${JSON.stringify(wf.schedule)}`);
    }
    console.log("");
  }
}

async function createWorkflow(client: RouterClient<AppRouter>, args: ParsedArgs): Promise<void> {
  if (!args.name || !args.triggerType || !args.prompt) {
    throw new Error("create requires --name, --trigger, and --prompt");
  }

  const rawIntegrations = args.integrations ?? [];
  const allowedIntegrations = rawIntegrations.filter(isWorkflowIntegrationType);
  const invalidIntegrations = rawIntegrations.filter((item) => !isWorkflowIntegrationType(item));

  if (invalidIntegrations.length > 0) {
    console.log(`Ignoring unknown integrations: ${invalidIntegrations.join(", ")}`);
  }

  const created = await client.workflow.create({
    name: args.name,
    triggerType: args.triggerType,
    prompt: args.prompt,
    promptDo: args.promptDo,
    promptDont: args.promptDont,
    autoApprove: args.autoApprove,
    allowedIntegrations,
    allowedCustomIntegrations: args.customIntegrations ?? [],
    schedule: buildSchedule(args),
  });

  console.log(`Created workflow ${created.name}`);
  console.log(`  id: ${created.id}`);
  console.log(`  status: ${statusBadge(created.status)}`);
}

async function runWorkflow(client: RouterClient<AppRouter>, args: ParsedArgs): Promise<void> {
  const workflowId = args.positionals[0];
  if (!workflowId) {
    throw new Error("Usage: bun run workflow run <workflow-id> [--payload <json>] [--watch]");
  }

  const payload = parsePayload(args.payload);
  const result = await client.workflow.trigger({ id: workflowId, payload });

  console.log(`Triggered workflow ${result.workflowId}`);
  console.log(`  run id: ${result.runId}`);
  console.log(`  generation id: ${result.generationId}`);
  console.log(`  conversation id: ${result.conversationId}`);

  if (args.watch) {
    console.log("\nWatching logs... (Ctrl+C to stop)\n");
    await printRunLogs(client, result.runId, true, args.watchIntervalSeconds);
  }
}

async function listRuns(client: RouterClient<AppRouter>, args: ParsedArgs): Promise<void> {
  const workflowId = args.positionals[0];
  if (!workflowId) {
    throw new Error("Usage: bun run workflow runs <workflow-id> [--limit <n>]");
  }

  const runs = await client.workflow.listRuns({
    workflowId,
    limit: args.limit ?? 20,
  });

  if (runs.length === 0) {
    console.log(`No runs found for workflow ${workflowId}.`);
    return;
  }

  console.log(`Runs for ${workflowId} (${runs.length}):\n`);
  for (const run of runs) {
    console.log(`${statusBadge(run.status)} ${run.id}`);
    console.log(`  started: ${formatDate(run.startedAt)}`);
    if (run.finishedAt) {
      console.log(`  finished: ${formatDate(run.finishedAt)}`);
    }
    if (run.errorMessage) {
      console.log(`  error: ${run.errorMessage}`);
    }
    console.log("");
  }
}

async function printRunLogs(
  client: RouterClient<AppRouter>,
  runId: string,
  watch: boolean,
  watchIntervalSeconds: number,
): Promise<void> {
  const seenEventIds = new Set<string>();
  let lastTranscript = "";
  let previousStatus = "";

  while (true) {
    // eslint-disable-next-line no-await-in-loop -- polling loop needs sequential fetches
    const run = await client.workflow.getRun({ id: runId });

    if (run.status !== previousStatus) {
      console.log(`Run ${run.id} ${statusBadge(run.status)}`);
      console.log(`  workflow: ${run.workflowId}`);
      console.log(`  started: ${formatDate(run.startedAt)}`);
      if (run.finishedAt) {
        console.log(`  finished: ${formatDate(run.finishedAt)}`);
      }
      if (run.errorMessage) {
        console.log(`  error: ${run.errorMessage}`);
      }
      previousStatus = run.status;
      console.log("");
    }

    const unseenEvents = run.events.filter((event) => !seenEventIds.has(event.id));
    if (unseenEvents.length > 0) {
      console.log(`Events (${unseenEvents.length} new):`);
      for (const event of unseenEvents) {
        seenEventIds.add(event.id);
        console.log(`- ${formatDate(event.createdAt)} [${event.type}]`);
        console.log(`  ${JSON.stringify(event.payload, null, 2).replace(/\n/g, "\n  ")}`);
      }
      console.log("");
    }

    if (run.conversationId) {
      try {
        // eslint-disable-next-line no-await-in-loop -- polling loop needs sequential fetches
        const conversation = await client.conversation.get({ id: run.conversationId });
        const transcript = formatConversationTranscript(conversation.messages);

        if (transcript && transcript !== lastTranscript) {
          const transcriptLabel = lastTranscript ? "Updated transcript:" : "Transcript:";
          console.log(transcriptLabel);
          console.log(transcript);
          console.log("");
          lastTranscript = transcript;
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error(`Failed to load conversation transcript: ${message}`);
      }
    }

    if (!watch || TERMINAL_STATUSES.has(run.status)) {
      return;
    }

    // eslint-disable-next-line no-await-in-loop -- polling loop waits between sequential fetches
    await sleep(watchIntervalSeconds * 1000);
  }
}

function formatConversationTranscript(
  messages: Array<{
    id: string;
    role: string;
    content: string;
    contentParts: unknown[] | null;
    attachments: Array<{ filename: string; mimeType: string }>;
    sandboxFiles: Array<{ path: string; filename: string; mimeType: string; fileId: string }>;
  }>,
): string {
  const transcriptMessages = messages.map((message) => ({
    ...message,
    contentParts: message.contentParts ?? undefined,
  })) as Parameters<typeof formatPersistedChatTranscript>[0];

  return formatPersistedChatTranscript(transcriptMessages);
}

async function logsWorkflowRun(client: RouterClient<AppRouter>, args: ParsedArgs): Promise<void> {
  const runId = args.positionals[0];
  if (!runId) {
    throw new Error("Usage: bun run workflow logs <run-id> [--watch]");
  }

  await printRunLogs(client, runId, args.watch, args.watchIntervalSeconds);
}

async function approveWorkflowRun(
  client: RouterClient<AppRouter>,
  args: ParsedArgs,
): Promise<void> {
  const runId = args.positionals[0];
  const toolUseId = args.positionals[1];
  const decisionRaw = args.positionals[2];

  if (!runId || !toolUseId || !decisionRaw) {
    throw new Error("Usage: bun run workflow approve <run-id> <tool-use-id> <approve|deny>");
  }

  if (decisionRaw !== "approve" && decisionRaw !== "deny") {
    throw new Error("Decision must be 'approve' or 'deny'");
  }
  const decision: "approve" | "deny" = decisionRaw;

  const run = await client.workflow.getRun({ id: runId });
  if (!run.generationId) {
    throw new Error(`Run ${runId} has no active generation for approval.`);
  }

  const result = await client.generation.submitApproval({
    generationId: run.generationId,
    toolUseId,
    decision,
  });

  if (!result.success) {
    throw new Error("Approval was not applied. Request may be stale or already resolved.");
  }

  console.log(`Submitted ${decision} for ${toolUseId} on run ${runId}.`);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main(): Promise<void> {
  let parsed: ParsedArgs;

  try {
    parsed = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    printHelp();
    process.exit(1);
  }

  if (!parsed.command) {
    printHelp();
    process.exit(1);
  }

  const config = loadConfig();
  if (!config?.token) {
    console.error("Not authenticated. Run 'bun run chat --auth' first.");
    process.exit(1);
  }

  const serverUrl =
    parsed.serverUrl || config.serverUrl || process.env.BAP_SERVER_URL || DEFAULT_SERVER_URL;
  const client = createRpcClient(serverUrl, config.token);

  try {
    switch (parsed.command) {
      case "list":
      case "ls":
        await listWorkflows(client);
        break;
      case "create":
      case "new":
        await createWorkflow(client, parsed);
        break;
      case "run":
      case "trigger":
      case "fire":
        await runWorkflow(client, parsed);
        break;
      case "logs":
      case "show-run":
        await logsWorkflowRun(client, parsed);
        break;
      case "approve":
        await approveWorkflowRun(client, parsed);
        break;
      case "runs":
        await listRuns(client, parsed);
        break;
      default:
        throw new Error(`Unknown command: ${parsed.command}`);
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

void main();
