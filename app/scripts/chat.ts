import type { RouterClient } from "@orpc/server";
import { spawn } from "node:child_process";
import { createReadStream, createWriteStream, existsSync, readFileSync } from "node:fs";
import { basename, resolve, extname } from "node:path";
import readline from "node:readline";
import type { AppRouter } from "../src/server/orpc";
import { resolveDefaultChatModel } from "../src/lib/chat-model-defaults";
import { createGenerationRuntime } from "../src/lib/generation-runtime";
import { runGenerationStream } from "../src/lib/generation-stream";
import { parseModelReference } from "../src/lib/model-reference";
import { listOpencodeFreeModels } from "../src/server/ai/opencode-models";
import {
  DEFAULT_SERVER_URL,
  ask,
  clearConfig,
  createPrompt,
  createRpcClient,
  loadConfig,
  saveConfig,
  type ChatConfig,
} from "./lib/cli-shared";
import {
  collectScriptedQuestionAnswers,
  parseQuestionApprovalInput,
  resolveQuestionSelection,
  type QuestionApprovalItem,
} from "./lib/question-approval";

type Args = {
  serverUrl?: string;
  conversationId?: string;
  message?: string;
  model?: string;
  token?: string;
  files: string[];
  autoApprove: boolean;
  validatePersistence: boolean;
  authOnly: boolean;
  resetAuth: boolean;
  listModels: boolean;
  questionAnswers: string[];
};

const DEFAULT_CLIENT_ID = "bap-cli";
const AUTH_INTEGRATION_TYPES = [
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

type AuthIntegrationType = (typeof AUTH_INTEGRATION_TYPES)[number];

function parseArgs(argv: string[]): Args {
  const args: Args = {
    files: [],
    autoApprove: false,
    validatePersistence: true,
    authOnly: false,
    resetAuth: false,
    listModels: false,
    questionAnswers: [],
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    switch (arg) {
      case "--server":
      case "-s":
        args.serverUrl = argv[i + 1];
        i += 1;
        break;
      case "--conversation":
      case "-c":
        args.conversationId = argv[i + 1];
        i += 1;
        break;
      case "--message":
      case "-m":
        args.message = argv[i + 1];
        i += 1;
        break;
      case "--model":
      case "-M":
        args.model = argv[i + 1];
        i += 1;
        break;
      case "--list-models":
        args.listModels = true;
        break;
      case "--auto-approve":
        args.autoApprove = true;
        break;
      case "--no-validate":
        args.validatePersistence = false;
        break;
      case "--auth":
        args.authOnly = true;
        break;
      case "--reset-auth":
        args.resetAuth = true;
        break;
      case "--token":
        args.token = argv[i + 1];
        i += 1;
        break;
      case "--file":
      case "-f":
        args.files.push(argv[i + 1]!);
        i += 1;
        break;
      case "--help":
      case "-h":
        printHelp();
        process.exit(0);
      case "--question-answer":
      case "-q":
        args.questionAnswers.push(argv[i + 1] || "");
        i += 1;
        break;
      default:
        if (arg?.startsWith("-")) {
          console.error(`Unknown flag: ${arg}`);
          printHelp();
          process.exit(1);
        }
        break;
    }
  }

  return args;
}

function printHelp(): void {
  console.log("\nUsage: bun run chat [options]\n");
  console.log("Options:");
  console.log("  -s, --server <url>        Server URL (default http://localhost:3000)");
  console.log("  -c, --conversation <id>   Continue an existing conversation");
  console.log("  -m, --message <text>      Send one message and exit");
  console.log(
    "  -M, --model <provider/model> Model reference (default prefers ChatGPT when connected)",
  );
  console.log("  --list-models             List free model ids and exit");
  console.log("  --auto-approve            Auto-approve tool calls");
  console.log("  --no-validate             Skip persisted message validation");
  console.log("  -q, --question-answer <v> Pre-answer OpenCode question prompts (repeatable)");
  console.log("  --auth                    Run auth flow and exit");
  console.log("  --token <token>           Use provided auth token directly");
  console.log("  --reset-auth              Clear saved token and re-auth");
  console.log("  -f, --file <path>         Attach file (can be used multiple times)");
  console.log("  -h, --help                Show help\n");
  console.log("Interactive commands:");
  console.log("  /file <path>              Attach file before sending");
  console.log("  /model                    Show current model");
  console.log("  /model <provider/model>   Switch model for next prompts");
  console.log("  /models                   List free model ids\n");
}

function formatToolResult(result: unknown): string {
  if (typeof result === "string") {
    return result;
  }
  try {
    return JSON.stringify(result);
  } catch {
    return String(result);
  }
}

function formatDurationMs(ms: number): string {
  if (ms < 1000) {
    return `${Math.round(ms)}ms`;
  }
  return `${(ms / 1000).toFixed(2)}s`;
}

function formatClockTime(ms: number): string {
  const date = new Date(ms);
  return date.toISOString().replace("T", " ").replace("Z", " UTC");
}

function isAuthIntegrationType(integration: string): integration is AuthIntegrationType {
  return (AUTH_INTEGRATION_TYPES as readonly string[]).includes(integration);
}

function openUrlInBrowser(url: string): boolean {
  try {
    const commandByPlatform: Record<string, { cmd: string; args: string[] }> = {
      darwin: { cmd: "open", args: [url] },
      linux: { cmd: "xdg-open", args: [url] },
      win32: { cmd: "cmd", args: ["/c", "start", "", url] },
    };
    const command = commandByPlatform[process.platform];
    if (!command) {
      return false;
    }
    const child = spawn(command.cmd, command.args, {
      detached: true,
      stdio: "ignore",
    });
    child.unref();
    return true;
  } catch {
    return false;
  }
}

async function authenticate(serverUrl: string): Promise<ChatConfig | null> {
  console.log(`\nAuthenticating with ${serverUrl}\n`);

  let deviceCode: string;
  let userCode: string;
  let verificationUri: string;
  let interval = 5;
  let expiresIn = 1800;

  try {
    const res = await fetch(`${serverUrl}/api/auth/device/code`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        client_id: process.env.BAP_CLI_CLIENT_ID || DEFAULT_CLIENT_ID,
      }),
    });

    if (!res.ok) {
      console.error(`Failed to request device code: ${res.status}`);
      return null;
    }

    const data = await res.json();
    deviceCode = data.device_code;
    userCode = data.user_code;
    verificationUri = data.verification_uri_complete || data.verification_uri;
    interval = data.interval || 5;
    expiresIn = data.expires_in || 1800;
  } catch (err) {
    console.error("Could not connect to server:", err);
    return null;
  }

  console.log("Visit the following URL and enter the code:\n");
  console.log(`  ${verificationUri}\n`);
  console.log(`  Code: ${userCode}\n`);
  console.log("Waiting for approval...\n");

  let pollingInterval = interval * 1000;
  const deadline = Date.now() + expiresIn * 1000;

  const pollForToken = async (): Promise<ChatConfig | null> => {
    if (Date.now() >= deadline) {
      console.error("Code expired. Please try again.");
      return null;
    }

    await sleep(pollingInterval);

    try {
      const res = await fetch(`${serverUrl}/api/auth/device/token`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          grant_type: "urn:ietf:params:oauth:grant-type:device_code",
          device_code: deviceCode,
          client_id: process.env.BAP_CLI_CLIENT_ID || DEFAULT_CLIENT_ID,
        }),
      });

      const data = await res.json();

      if (data.access_token) {
        const config: ChatConfig = {
          serverUrl,
          token: data.access_token,
        };
        saveConfig(config);
        console.log("Authenticated successfully.\n");
        return config;
      }

      if (data.error) {
        switch (data.error) {
          case "authorization_pending":
            break;
          case "slow_down":
            pollingInterval += 5000;
            break;
          case "expired_token":
            console.error("Code expired. Please try again.");
            return null;
          case "access_denied":
            console.error("Authentication denied.");
            return null;
          default:
            console.error(`Unexpected error: ${data.error}`);
            break;
        }
      }
    } catch {
      // retry
    }

    return pollForToken();
  };

  return pollForToken();
}

async function collectQuestionApprovalAnswers(
  rl: readline.Interface,
  questions: QuestionApprovalItem[],
): Promise<string[][]> {
  const collectOne = async (index: number): Promise<string[][]> => {
    if (index >= questions.length) {
      return [];
    }

    const question = questions[index]!;
    process.stdout.write(`\n[question] ${question.header}\n`);
    process.stdout.write(`${question.question}\n`);

    question.options.forEach((option, optionIndex) => {
      const suffix = option.description ? ` - ${option.description}` : "";
      process.stdout.write(`  ${optionIndex + 1}. ${option.label}${suffix}\n`);
    });

    if (question.custom) {
      process.stdout.write("  t. Type your own answer\n");
    }

    const prompt =
      question.options.length > 0
        ? question.multiple
          ? "Select option(s) comma-separated (default 1): "
          : "Select an option (default 1): "
        : "Answer: ";
    const rawSelection = (await ask(rl, prompt)).trim();

    let selectedAnswers: string[];
    if (question.custom && rawSelection.toLowerCase() === "t") {
      const typedPrompt = question.multiple
        ? "Type your answer(s) (comma-separated): "
        : "Type your answer: ";
      const typedAnswer = await ask(rl, typedPrompt);
      selectedAnswers = resolveQuestionSelection(question, typedAnswer);
    } else {
      selectedAnswers = resolveQuestionSelection(question, rawSelection);
    }

    const remaining = await collectOne(index + 1);
    return [selectedAnswers, ...remaining];
  };

  return collectOne(0);
}

function isReadlineOpen(rl: readline.Interface | null): rl is readline.Interface {
  if (!rl) {
    return false;
  }
  return !(rl as readline.Interface & { closed?: boolean }).closed;
}

function createApprovalPrompt(rl: readline.Interface | null): {
  rl: readline.Interface;
  close: () => void;
} | null {
  if (isReadlineOpen(rl) && process.stdin.isTTY && process.stdout.isTTY) {
    return {
      rl,
      close: () => {},
    };
  }

  if (!process.stdout.isTTY) {
    return null;
  }

  try {
    const input = createReadStream("/dev/tty");
    const output = createWriteStream("/dev/tty");
    const ttyRl = readline.createInterface({ input, output });
    return {
      rl: ttyRl,
      close: () => {
        ttyRl.close();
        input.close();
        output.end();
      },
    };
  } catch {
    return null;
  }
}

async function runChatLoop(
  client: RouterClient<AppRouter>,
  rl: readline.Interface,
  options: Args,
): Promise<void> {
  let conversationId = options.conversationId;

  let pendingFiles: { name: string; mimeType: string; dataUrl: string }[] = [];

  // Attach files passed via --file on the first message
  for (const f of options.files) {
    try {
      pendingFiles.push(fileToAttachment(f));
      console.log(`Attached: ${basename(f)}`);
    } catch (e) {
      console.error(e instanceof Error ? e.message : String(e));
    }
  }

  const runStep = async (): Promise<void> => {
    let rawInput: string;
    try {
      rawInput = await ask(rl, conversationId ? "followup> " : "chat> ");
    } catch (error) {
      const isClosedReadline =
        error instanceof Error &&
        "code" in error &&
        (error as Error & { code?: string }).code === "ERR_USE_AFTER_CLOSE";
      if (isClosedReadline) {
        console.log("Bye.");
        return;
      }
      throw error;
    }

    const input = rawInput.trim();
    if (!input) {
      console.log("Bye.");
      return;
    }

    // /file <path> command to attach a file before sending
    if (input.startsWith("/file ")) {
      const filePath = input.slice(6).trim();
      try {
        pendingFiles.push(fileToAttachment(filePath));
        console.log(`Attached: ${basename(filePath)} (${pendingFiles.length} file(s) pending)`);
      } catch (e) {
        console.error(e instanceof Error ? e.message : String(e));
      }
      return runStep();
    }

    if (input === "/model") {
      console.log(`Current model: ${options.model ?? "auto"}`);
      return runStep();
    }

    if (input.startsWith("/model ")) {
      const model = input.slice(7).trim();
      if (!model) {
        console.log("Usage: /model <provider/model>");
        return runStep();
      }
      try {
        parseModelReference(model);
      } catch (error) {
        console.log(error instanceof Error ? error.message : String(error));
        return runStep();
      }
      options.model = model;
      console.log(`Switched model to: ${options.model}`);
      return runStep();
    }

    if (input === "/models") {
      await printFreeModels();
      return runStep();
    }

    const attachments = pendingFiles.length ? pendingFiles : undefined;
    pendingFiles = [];

    const result = await runGeneration(client, rl, input, conversationId, options, attachments);
    if (!result) {
      return;
    }

    conversationId = result.conversationId;

    return runStep();
  };

  await runStep();
}

async function runGeneration(
  client: RouterClient<AppRouter>,
  rl: readline.Interface | null,
  content: string,
  conversationId: string | undefined,
  options: Args,
  attachments?: { name: string; mimeType: string; dataUrl: string }[],
): Promise<{ generationId: string; conversationId: string } | null> {
  let outputStarted = false;
  const generationStartedAtMs = Date.now();
  const statusTimeline: Array<{ status: string; atMs: number; elapsedMs: number }> = [];
  const runtime = createGenerationRuntime();
  const streamedSandboxFileIds = new Set<string>();
  const authHandlingInProgress = new Set<string>();
  const resolvedServerUrl = options.serverUrl || process.env.BAP_SERVER_URL || DEFAULT_SERVER_URL;
  const normalizedServerUrl = resolvedServerUrl.replace(/\/$/, "");

  try {
    const result = await runGenerationStream({
      client,
      input: {
        conversationId,
        content,
        model: options.model,
        autoApprove: options.autoApprove,
        fileAttachments: attachments?.length ? attachments : undefined,
      },
      callbacks: {
        onText: (text) => {
          process.stdout.write(text);
          runtime.handleText(text);
          outputStarted = true;
        },
        onThinking: (thinking) => {
          runtime.handleThinking(thinking);
          process.stdout.write(`\n[thinking] ${thinking.content}\n`);
        },
        onToolUse: (toolUse) => {
          runtime.handleToolUse(toolUse);
          process.stdout.write(`\n[tool_use] ${toolUse.toolName}\n`);
          if (toolUse.integration) {
            process.stdout.write(`[tool_integration] ${toolUse.integration}\n`);
          }
          if (typeof toolUse.isWrite === "boolean") {
            process.stdout.write(`[tool_is_write] ${toolUse.isWrite}\n`);
          }
          process.stdout.write(`[tool_input] ${JSON.stringify(toolUse.toolInput)}\n`);
        },
        onToolResult: (toolName, result, toolUseId) => {
          runtime.handleToolResult(toolName, result, toolUseId);
          if (toolName === "question") {
            process.stdout.write(`\n[tool_result] ${toolName} ${JSON.stringify(result)}\n`);
          } else {
            process.stdout.write(`\n[tool_result] ${toolName}\n`);
            process.stdout.write(`[tool_result_data] ${formatToolResult(result)}\n`);
          }
        },
        onPendingApproval: async (approval) => {
          runtime.handlePendingApproval(approval);
          process.stdout.write(`\n[approval_needed] ${approval.toolName}\n`);
          process.stdout.write(
            `[approval_input] ${JSON.stringify({
              integration: approval.integration,
              operation: approval.operation,
              command: approval.command,
              toolInput: approval.toolInput,
            })}\n`,
          );

          const questionItems = parseQuestionApprovalInput(approval.toolInput);
          if (questionItems) {
            if (options.questionAnswers.length > 0) {
              const questionAnswers = collectScriptedQuestionAnswers(
                questionItems,
                options.questionAnswers,
              );
              await client.generation.submitApproval({
                generationId: approval.generationId,
                toolUseId: approval.toolUseId,
                decision: "approve",
                questionAnswers,
              });
              process.stdout.write(
                ` -> submitted scripted question answers: ${JSON.stringify(questionAnswers)}\n`,
              );
              return;
            }

            if (options.autoApprove) {
              await client.generation.submitApproval({
                generationId: approval.generationId,
                toolUseId: approval.toolUseId,
                decision: "approve",
              });
              process.stdout.write(" -> auto-approve question with defaults\n");
              return;
            }

            const approvalPrompt = createApprovalPrompt(rl);
            if (!approvalPrompt) {
              await client.generation.submitApproval({
                generationId: approval.generationId,
                toolUseId: approval.toolUseId,
                decision: "approve",
              });
              process.stdout.write(
                " -> no interactive prompt available, using question defaults\n",
              );
              return;
            }

            const questionAnswers = await (async () => {
              try {
                return await collectQuestionApprovalAnswers(approvalPrompt.rl, questionItems);
              } finally {
                approvalPrompt.close();
              }
            })();
            await client.generation.submitApproval({
              generationId: approval.generationId,
              toolUseId: approval.toolUseId,
              decision: "approve",
              questionAnswers,
            });
            return;
          }

          if (options.autoApprove) {
            process.stdout.write(" -> auto-approve\n");
            await client.generation.submitApproval({
              generationId: approval.generationId,
              toolUseId: approval.toolUseId,
              decision: "approve",
            });
            return;
          }

          const approvalPrompt = createApprovalPrompt(rl);
          if (!approvalPrompt) {
            const decision = "deny";
            process.stdout.write(` -> auto-${decision}\n`);
            await client.generation.submitApproval({
              generationId: approval.generationId,
              toolUseId: approval.toolUseId,
              decision,
            });
            return;
          }

          const decision = await (async () => {
            try {
              return (await ask(approvalPrompt.rl, "Approve? (y/n) ")).trim().toLowerCase();
            } finally {
              approvalPrompt.close();
            }
          })();
          await client.generation.submitApproval({
            generationId: approval.generationId,
            toolUseId: approval.toolUseId,
            decision: decision === "y" || decision === "yes" ? "approve" : "deny",
          });
        },
        onApprovalResult: (toolUseId, decision) => {
          runtime.handleApprovalResult(toolUseId, decision);
          process.stdout.write(`\n[approval_${decision}] ${toolUseId}\n`);
        },
        onAuthNeeded: async (auth) => {
          runtime.handleAuthNeeded(auth);
          process.stdout.write(`\n[auth_needed] ${auth.integrations.join(", ")}\n`);
          const authPrompt = createApprovalPrompt(rl);

          try {
            const handleAuthIntegration = async (index: number): Promise<void> => {
              if (index >= auth.integrations.length) {
                return;
              }

              const integration = auth.integrations[index]!;
              const dedupeKey = `${auth.generationId}:${integration}`;
              if (authHandlingInProgress.has(dedupeKey)) {
                return handleAuthIntegration(index + 1);
              }
              authHandlingInProgress.add(dedupeKey);

              if (!isAuthIntegrationType(integration)) {
                process.stdout.write(
                  `[auth_error] Unsupported integration for CLI auth flow: ${integration}\n`,
                );
                return handleAuthIntegration(index + 1);
              }

              const redirectUrl = `${normalizedServerUrl}/chat/${auth.conversationId}?auth_complete=${integration}&generation_id=${auth.generationId}`;
              const { authUrl } = await client.integration.getAuthUrl({
                type: integration,
                redirectUrl,
              });
              process.stdout.write(`[auth_url] ${integration}: ${authUrl}\n`);

              const opened = openUrlInBrowser(authUrl);
              process.stdout.write(
                opened
                  ? "[auth_action] Browser opened. Complete auth in the browser.\n"
                  : "[auth_action] Open the URL above and complete auth.\n",
              );

              if (authPrompt) {
                const confirmation = (
                  await ask(authPrompt.rl, "auth> press Enter when done (or type 'cancel'): ")
                )
                  .trim()
                  .toLowerCase();
                const allow =
                  confirmation !== "cancel" && confirmation !== "n" && confirmation !== "no";
                const submitted = await client.generation.submitAuthResult({
                  generationId: auth.generationId,
                  integration,
                  success: allow,
                });
                process.stdout.write(
                  `[auth_submit] integration=${integration} success=${submitted.success}\n`,
                );
              } else {
                process.stdout.write(
                  "[auth_action] Non-interactive mode: cannot submit auth result automatically.\n",
                );
              }
              return handleAuthIntegration(index + 1);
            };

            await handleAuthIntegration(0);
          } catch (error) {
            process.stdout.write(
              `[auth_error] ${error instanceof Error ? error.message : String(error)}\n`,
            );
          } finally {
            authPrompt?.close();
            for (const integration of auth.integrations) {
              authHandlingInProgress.delete(`${auth.generationId}:${integration}`);
            }
          }
        },
        onAuthProgress: (connected, remaining) => {
          runtime.handleAuthProgress(connected, remaining);
          process.stdout.write(
            `\n[auth_progress] connected=${connected} remaining=${remaining.join(", ")}\n`,
          );
        },
        onAuthResult: (success) => {
          runtime.handleAuthResult(success);
          process.stdout.write(`\n[auth_result] success=${success}\n`);
        },
        onSandboxFile: (file) => {
          streamedSandboxFileIds.add(file.fileId);
          process.stdout.write(`\n[file] ${file.filename} (${file.path})\n`);
        },
        onStatusChange: (status) => {
          const now = Date.now();
          const elapsedMs = Math.max(0, now - generationStartedAtMs);
          statusTimeline.push({ status, atMs: now, elapsedMs });
          process.stdout.write(
            `\n[status] ${status} @ ${formatClockTime(now)} (+${formatDurationMs(elapsedMs)})\n`,
          );
        },
        onDone: async (doneGenerationId, doneConversationId, messageId, _usage, artifacts) => {
          runtime.handleDone({
            generationId: doneGenerationId,
            conversationId: doneConversationId,
            messageId,
          });
          if (artifacts?.sandboxFiles?.length) {
            for (const file of artifacts.sandboxFiles) {
              if (streamedSandboxFileIds.has(file.fileId)) {
                continue;
              }
              process.stdout.write(`\n[file] ${file.filename} (${file.path}) [from_done]\n`);
            }
          }
          if (artifacts?.timing) {
            const timing = artifacts.timing;
            process.stdout.write("\n[timing] Summary\n");
            if (timing.generationDurationMs !== undefined) {
              process.stdout.write(
                `  end_to_end_total: ${formatDurationMs(timing.generationDurationMs)}\n`,
              );
            }
            if (timing.sandboxStartupDurationMs !== undefined) {
              process.stdout.write(
                `  sandbox_connect_or_create${
                  timing.sandboxStartupMode ? ` (${timing.sandboxStartupMode})` : ""
                }: ${formatDurationMs(timing.sandboxStartupDurationMs)}\n`,
              );
            }
            const phaseDurations = timing.phaseDurationsMs;
            if (phaseDurations) {
              const rows: Array<[string, number | undefined]> = [
                ["sandbox_connect_or_create", phaseDurations.sandboxConnectOrCreateMs],
                ["opencode_ready", phaseDurations.opencodeReadyMs],
                ["session_ready", phaseDurations.sessionReadyMs],
                ["agent_init", phaseDurations.agentInitMs],
                ["pre_prompt_setup", phaseDurations.prePromptSetupMs],
                ["agent_ready_to_prompt", phaseDurations.agentReadyToPromptMs],
                ["wait_for_first_event", phaseDurations.waitForFirstEventMs],
                ["model_stream", phaseDurations.modelStreamMs],
                ["post_processing", phaseDurations.postProcessingMs],
              ];
              for (const [label, value] of rows) {
                if (value === undefined) {
                  continue;
                }
                process.stdout.write(`  ${label}: ${formatDurationMs(value)}\n`);
              }
            }
            if (timing.phaseTimestamps?.length) {
              process.stdout.write("[timing] Phase timestamps\n");
              for (const entry of timing.phaseTimestamps) {
                process.stdout.write(
                  `  - ${entry.phase}: ${entry.at} (+${formatDurationMs(entry.elapsedMs)})\n`,
                );
              }
            }
          }
          if (statusTimeline.length > 0) {
            process.stdout.write("[timing] Status timeline\n");
            for (const entry of statusTimeline) {
              process.stdout.write(
                `  - ${entry.status}: ${formatClockTime(entry.atMs)} (+${formatDurationMs(entry.elapsedMs)})\n`,
              );
            }
          }
          if (outputStarted) {
            process.stdout.write("\n");
          }
          if (options.validatePersistence) {
            await validatePersistedAssistantMessage(
              client,
              doneConversationId,
              messageId,
              runtime.buildAssistantMessage(),
            );
          }
        },
        onError: (message) => {
          runtime.handleError();
          process.stdout.write(`\n[error] ${message}\n`);
        },
        onCancelled: () => {
          runtime.handleCancelled();
          process.stdout.write("\n[cancelled]\n");
        },
      },
    });

    if (!result) {
      throw new Error("Generation stream closed before a terminal event (done/error/cancelled)");
    }

    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`\nRequest failed: ${message}\n`);
    return null;
  }

  return null;
}

function createSingleMessagePrompt(): readline.Interface | null {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    return null;
  }
  return createPrompt();
}

async function printAuthenticatedUser(client: RouterClient<AppRouter>): Promise<void> {
  try {
    const me = await client.user.me();
    console.log(`[auth] ${me.email} (${me.id})`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`[auth] failed to resolve current user: ${message}`);
  }
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const requestedServerUrl = args.serverUrl || process.env.BAP_SERVER_URL || DEFAULT_SERVER_URL;

  if (args.listModels) {
    await printFreeModels();
    process.exit(0);
  }

  if (args.resetAuth) {
    clearConfig(requestedServerUrl);
  }

  const loaded = loadConfig(requestedServerUrl);
  const serverUrl = requestedServerUrl;

  let config = loaded;
  if (args.token) {
    config = { serverUrl, token: args.token };
    saveConfig(config);
  } else if (
    !config ||
    !config.token ||
    config.serverUrl !== serverUrl ||
    args.authOnly ||
    args.resetAuth
  ) {
    config = await authenticate(serverUrl);
    if (!config) {
      process.exit(1);
    }
    if (args.authOnly) {
      process.exit(0);
    }
  }

  const client = createRpcClient(serverUrl, config.token);

  try {
    const overrideModel = args.model ?? process.env.BAP_CHAT_MODEL;
    if (overrideModel?.trim()) {
      const trimmedOverride = overrideModel.trim();
      parseModelReference(trimmedOverride);
      args.model = trimmedOverride;
    } else {
      const [authStatus, freeModels] = await Promise.all([
        client.providerAuth.status(),
        client.providerAuth.freeModels(),
      ]);
      args.model = resolveDefaultChatModel({
        isOpenAIConnected: "openai" in (authStatus.connected ?? {}),
        availableOpencodeFreeModelIDs: freeModels.models.map((model) => model.id),
      });
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
  console.log(`[model] ${args.model}`);

  await printAuthenticatedUser(client);

  if (args.message) {
    // Non-interactive: send a single message and exit
    const attachments = args.files.map((f) => fileToAttachment(f));
    const singleMessagePrompt = createSingleMessagePrompt();
    const result = await runGeneration(
      client,
      singleMessagePrompt,
      args.message,
      args.conversationId,
      args,
      attachments.length ? attachments : undefined,
    );
    singleMessagePrompt?.close();
    if (result) {
      console.log(`\n[conversation] ${result.conversationId}`);
    }
    process.exit(result ? 0 : 1);
  }

  const rl = createPrompt();

  rl.on("SIGINT", () => {
    console.log("\nBye.");
    rl.close();
    process.exit(0);
  });

  await runChatLoop(client, rl, args);
  rl.close();
}

async function printFreeModels(): Promise<void> {
  try {
    const models = await listOpencodeFreeModels();
    if (models.length === 0) {
      console.log("No free OpenCode models found.");
      return;
    }

    console.log(`Free OpenCode models (${models.length}):`);
    for (const model of models) {
      console.log(`- ${model.name} (${model.id})`);
    }
  } catch (error) {
    console.error(
      `Failed to fetch free models: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const MIME_MAP: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".pdf": "application/pdf",
  ".txt": "text/plain",
  ".json": "application/json",
  ".csv": "text/csv",
};

function fileToAttachment(filePath: string): {
  name: string;
  mimeType: string;
  dataUrl: string;
} {
  const resolved = resolve(filePath);
  if (!existsSync(resolved)) {
    throw new Error(`File not found: ${resolved}`);
  }
  const ext = extname(resolved).toLowerCase();
  const mimeType = MIME_MAP[ext] || "application/octet-stream";
  const data = readFileSync(resolved);
  const base64 = data.toString("base64");
  return {
    name: basename(resolved),
    mimeType,
    dataUrl: `data:${mimeType};base64,${base64}`,
  };
}

function normalizeText(input: string): string {
  return input.replace(/\s+/g, " ").trim();
}

async function validatePersistedAssistantMessage(
  client: RouterClient<AppRouter>,
  conversationId: string,
  messageId: string,
  expected: { content: string; parts: Array<{ type: string }> },
): Promise<void> {
  const conv = await client.conversation.get({ id: conversationId });
  const savedMessage = conv.messages.find((m) => m.id === messageId);

  if (!savedMessage) {
    throw new Error(
      `Validation failed: assistant message ${messageId} was not saved in conversation ${conversationId}`,
    );
  }
  if (savedMessage.role !== "assistant") {
    throw new Error(
      `Validation failed: message ${messageId} saved with role ${savedMessage.role}, expected assistant`,
    );
  }

  const persistedParts = Array.isArray(savedMessage.contentParts) ? savedMessage.contentParts : [];
  if (expected.parts.length > 0 && persistedParts.length === 0) {
    throw new Error(
      "Validation failed: stream produced activity/text but saved message has no contentParts",
    );
  }

  const normalizedStream = normalizeText(expected.content);
  if (normalizedStream.length === 0) {
    return;
  }

  const normalizedPersisted = normalizeText(savedMessage.content ?? "");
  if (!normalizedPersisted.includes(normalizedStream)) {
    throw new Error(
      "Validation failed: streamed assistant text does not match saved message content",
    );
  }
}

void main();
