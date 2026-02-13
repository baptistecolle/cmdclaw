"use client";

import { ChevronDown, ChevronRight, Check, X, Loader2, ShieldAlert, Code } from "lucide-react";
import Image from "next/image";
import { useState, useMemo, useCallback, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { getIntegrationLogo, getIntegrationDisplayName } from "@/lib/integration-icons";
import { parseCliCommand } from "@/lib/parse-cli-command";
import { cn } from "@/lib/utils";
import type { PreviewProps } from "./previews";
import { GenericPreview } from "./previews";
import { AirtablePreview } from "./previews/airtable-preview";
import { CalendarPreview } from "./previews/calendar-preview";
import { DocsPreview } from "./previews/docs-preview";
import { DrivePreview } from "./previews/drive-preview";
import { GithubPreview } from "./previews/github-preview";
import { GmailPreview } from "./previews/gmail-preview";
import { HubspotPreview } from "./previews/hubspot-preview";
import { LinearPreview } from "./previews/linear-preview";
import { NotionPreview } from "./previews/notion-preview";
import { SheetsPreview } from "./previews/sheets-preview";
import { SlackPreview } from "./previews/slack-preview";

export interface ToolApprovalCardProps {
  toolUseId: string;
  toolName: string;
  toolInput: unknown;
  integration: string;
  operation: string;
  command?: string;
  onApprove: (questionAnswers?: string[][]) => void;
  onDeny: () => void;
  status: "pending" | "approved" | "denied";
  isLoading?: boolean;
  readonly?: boolean;
}

type QuestionOption = {
  label: string;
  description?: string;
};

type QuestionPrompt = {
  header: string;
  question: string;
  options: QuestionOption[];
  multiple?: boolean;
  custom?: boolean;
};

type QuestionRequestPayload = {
  questions: QuestionPrompt[];
};

function parseQuestionRequestPayload(input: unknown): QuestionRequestPayload | null {
  if (typeof input !== "object" || input === null) {
    return null;
  }

  const rawQuestions = (input as { questions?: unknown }).questions;
  if (!Array.isArray(rawQuestions) || rawQuestions.length === 0) {
    return null;
  }

  const questions: QuestionPrompt[] = [];
  for (const rawQuestion of rawQuestions) {
    if (typeof rawQuestion !== "object" || rawQuestion === null) {
      return null;
    }
    const question = rawQuestion as {
      header?: unknown;
      question?: unknown;
      options?: unknown;
      multiple?: unknown;
      custom?: unknown;
    };

    if (typeof question.header !== "string" || typeof question.question !== "string") {
      return null;
    }

    const rawOptions = Array.isArray(question.options) ? question.options : [];
    const options: QuestionOption[] = [];
    for (const rawOption of rawOptions) {
      if (typeof rawOption !== "object" || rawOption === null) {
        continue;
      }
      const option = rawOption as { label?: unknown; description?: unknown };
      if (typeof option.label !== "string" || option.label.length === 0) {
        continue;
      }
      options.push({
        label: option.label,
        description: typeof option.description === "string" ? option.description : undefined,
      });
    }

    questions.push({
      header: question.header,
      question: question.question,
      options,
      multiple: typeof question.multiple === "boolean" ? question.multiple : undefined,
      custom: typeof question.custom === "boolean" ? question.custom : undefined,
    });
  }

  return questions.length > 0 ? { questions } : null;
}

function renderPreview(integration: string, previewProps: PreviewProps) {
  switch (integration) {
    case "slack":
      return <SlackPreview {...previewProps} />;
    case "gmail":
      return <GmailPreview {...previewProps} />;
    case "google_calendar":
      return <CalendarPreview {...previewProps} />;
    case "google_docs":
      return <DocsPreview {...previewProps} />;
    case "google_sheets":
      return <SheetsPreview {...previewProps} />;
    case "google_drive":
      return <DrivePreview {...previewProps} />;
    case "notion":
      return <NotionPreview {...previewProps} />;
    case "linear":
      return <LinearPreview {...previewProps} />;
    case "github":
      return <GithubPreview {...previewProps} />;
    case "airtable":
      return <AirtablePreview {...previewProps} />;
    case "hubspot":
      return <HubspotPreview {...previewProps} />;
    default:
      return <GenericPreview {...previewProps} />;
  }
}

export function ToolApprovalCard({
  toolName,
  toolInput,
  integration,
  operation,
  command,
  onApprove,
  onDeny,
  status,
  isLoading,
  readonly = false,
}: ToolApprovalCardProps) {
  // Start collapsed for readonly (saved) approvals, expanded for pending
  const [expanded, setExpanded] = useState(!readonly);
  const [showRawCommand, setShowRawCommand] = useState(false);

  const logo = getIntegrationLogo(integration);
  const displayName = getIntegrationDisplayName(integration);
  const isQuestionRequest =
    (operation === "question" || toolName.toLowerCase() === "question") &&
    integration.toLowerCase() === "bap";
  const questionPayload = useMemo(
    () => (isQuestionRequest ? parseQuestionRequestPayload(toolInput) : null),
    [isQuestionRequest, toolInput],
  );
  const [selectedOptions, setSelectedOptions] = useState<Record<number, string[]>>(() => {
    if (!questionPayload) {
      return {};
    }
    return questionPayload.questions.reduce<Record<number, string[]>>((acc, question, index) => {
      const firstOption = question.options[0]?.label;
      if (firstOption) {
        acc[index] = [firstOption];
      }
      return acc;
    }, {});
  });
  const [typedAnswers, setTypedAnswers] = useState<Record<number, string>>({});
  const [typedMode, setTypedMode] = useState<Record<number, boolean>>(() => {
    if (!questionPayload) {
      return {};
    }
    return questionPayload.questions.reduce<Record<number, boolean>>((acc, question, index) => {
      acc[index] = question.options.length === 0;
      return acc;
    }, {});
  });

  useEffect(() => {
    if (!questionPayload) {
      return;
    }

    setSelectedOptions((prev) => {
      const next: Record<number, string[]> = {};
      for (let index = 0; index < questionPayload.questions.length; index += 1) {
        const existing = prev[index];
        if (Array.isArray(existing) && existing.length > 0) {
          next[index] = existing;
          continue;
        }

        const firstOption = questionPayload.questions[index]?.options[0]?.label;
        if (firstOption) {
          next[index] = [firstOption];
        }
      }
      return next;
    });

    setTypedMode((prev) => {
      const next: Record<number, boolean> = {};
      for (let index = 0; index < questionPayload.questions.length; index += 1) {
        const existing = prev[index];
        if (typeof existing === "boolean") {
          next[index] = existing;
          continue;
        }

        next[index] = questionPayload.questions[index]?.options.length === 0;
      }
      return next;
    });

    setTypedAnswers((prev) => {
      const next: Record<number, string> = {};
      for (let index = 0; index < questionPayload.questions.length; index += 1) {
        const existing = prev[index];
        if (typeof existing === "string") {
          next[index] = existing;
        }
      }
      return next;
    });
  }, [questionPayload]);

  // Parse the command to extract structured data
  const parsedCommand = useMemo(() => {
    if (!command) {
      return null;
    }
    return parseCliCommand(command);
  }, [command]);

  // Build preview props
  const previewProps = useMemo(() => {
    if (!parsedCommand) {
      return null;
    }
    return {
      integration: parsedCommand.integration,
      operation: parsedCommand.operation,
      args: parsedCommand.args,
      positionalArgs: parsedCommand.positionalArgs,
      command: parsedCommand.rawCommand,
    };
  }, [parsedCommand]);
  const handleToggleExpanded = useCallback(() => {
    setExpanded((prev) => !prev);
  }, []);
  const handleToggleRawCommand = useCallback((event: React.MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    setShowRawCommand((prev) => !prev);
  }, []);
  const handleDenyClick = useCallback(
    (event: React.MouseEvent<HTMLButtonElement>) => {
      event.stopPropagation();
      onDeny();
    },
    [onDeny],
  );
  const handleApproveClick = useCallback(
    (event: React.MouseEvent<HTMLButtonElement>) => {
      event.stopPropagation();
      if (!questionPayload) {
        onApprove();
        return;
      }

      const answers = questionPayload.questions.map((question, index) => {
        if (typedMode[index]) {
          const answer = typedAnswers[index]?.trim();
          if (answer) {
            return [answer];
          }
        }

        const selected = selectedOptions[index]
          ?.map((value) => value.trim())
          .filter((value) => value.length > 0);
        if (selected && selected.length > 0) {
          return selected;
        }

        const fallbackOption = question.options[0]?.label;
        if (fallbackOption) {
          return [fallbackOption];
        }

        return [];
      });

      onApprove(answers);
    },
    [onApprove, questionPayload, selectedOptions, typedAnswers, typedMode],
  );
  const canSubmitQuestion = useMemo(() => {
    if (!questionPayload) {
      return true;
    }

    return questionPayload.questions.every((question, index) => {
      if (typedMode[index]) {
        const answer = typedAnswers[index]?.trim();
        if (answer && answer.length > 0) {
          return true;
        }
      }
      const selected = selectedOptions[index];
      return (Array.isArray(selected) && selected.length > 0) || question.options.length > 0;
    });
  }, [questionPayload, selectedOptions, typedAnswers, typedMode]);
  const handleSelectOption = useCallback((event: React.MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    const { questionIndex, optionLabel } = event.currentTarget.dataset;
    if (!questionIndex || !optionLabel) {
      return;
    }
    const index = Number(questionIndex);
    if (Number.isNaN(index)) {
      return;
    }
    setSelectedOptions((prev) => {
      const question = questionPayload?.questions[index];
      if (!question) {
        return prev;
      }

      const previous = prev[index] ?? [];
      if (question.multiple) {
        const hasOption = previous.includes(optionLabel);
        const nextOptions = hasOption
          ? previous.filter((value) => value !== optionLabel)
          : [...previous, optionLabel];
        return { ...prev, [index]: nextOptions };
      }

      return { ...prev, [index]: [optionLabel] };
    });
    setTypedMode((prev) => ({ ...prev, [index]: false }));
  }, [questionPayload]);
  const handleEnableTypedMode = useCallback((event: React.MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    const { questionIndex } = event.currentTarget.dataset;
    if (!questionIndex) {
      return;
    }
    const index = Number(questionIndex);
    if (Number.isNaN(index)) {
      return;
    }
    setTypedMode((prev) => ({ ...prev, [index]: true }));
  }, []);
  const handleTypedAnswerChange = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const { questionIndex } = event.currentTarget.dataset;
    const value = event.currentTarget.value;
    if (!questionIndex) {
      return;
    }
    const index = Number(questionIndex);
    if (Number.isNaN(index)) {
      return;
    }
    setTypedAnswers((prev) => ({ ...prev, [index]: value }));
  }, []);
  const handleStopPropagation = useCallback((event: React.MouseEvent<HTMLInputElement>) => {
    event.stopPropagation();
  }, []);

  return (
    <div
      className={cn(
        "rounded-lg border bg-card text-card-foreground",
        status === "pending" && "border-amber-500/50 bg-amber-50/10",
        status === "approved" && "border-green-500/50",
        status === "denied" && "border-red-500/50",
      )}
    >
      <button
        onClick={handleToggleExpanded}
        className="hover:bg-muted/50 flex w-full items-center gap-2 px-3 py-2 text-left text-sm"
      >
        {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        {logo ? (
          <Image src={logo} alt={displayName} width={16} height={16} className="h-4 w-4" />
        ) : (
          <ShieldAlert className="h-4 w-4 text-amber-500" />
        )}
        <span className="font-medium">{displayName}</span>
        <span className="text-muted-foreground">wants to</span>
        <span className="bg-muted rounded px-1.5 py-0.5 font-mono text-xs">{operation}</span>

        <div className="flex-1" />

        {status === "pending" && (
          <span className="flex items-center gap-1 text-xs text-amber-500">
            <Loader2 className="h-3 w-3 animate-spin" />
            Waiting for approval
          </span>
        )}
        {status === "approved" && (
          <span className="flex items-center gap-1 text-xs text-green-500">
            <Check className="h-3 w-3" />
            Approved
          </span>
        )}
        {status === "denied" && (
          <span className="flex items-center gap-1 text-xs text-red-500">
            <X className="h-3 w-3" />
            Denied
          </span>
        )}
      </button>

      {expanded && (
        <div className="border-t px-3 py-3">
          {/* Formatted Preview */}
          {previewProps && <div className="mb-3">{renderPreview(integration, previewProps)}</div>}

          {/* Collapsible Raw Command Section */}
          {command && (
            <div className="mb-3">
              <button
                onClick={handleToggleRawCommand}
                className="text-muted-foreground hover:text-foreground flex items-center gap-1.5 text-xs transition-colors"
              >
                <Code className="h-3 w-3" />
                {showRawCommand ? "Hide" : "Show"} raw command
                {showRawCommand ? (
                  <ChevronDown className="h-3 w-3" />
                ) : (
                  <ChevronRight className="h-3 w-3" />
                )}
              </button>

              {showRawCommand && (
                <pre className="bg-muted mt-2 overflow-x-auto rounded p-2 font-mono text-xs">
                  {command}
                </pre>
              )}
            </div>
          )}

          {status === "pending" && questionPayload && (
            <div className="mb-3 space-y-4">
              {questionPayload.questions.map((question, index) => {
                const canTypeOwnAnswer = question.custom !== false;
                const useTypedAnswer = !!typedMode[index];

                return (
                  <div key={`${question.header}-${question.question}`} className="space-y-2">
                    <div>
                      <p className="text-sm font-medium">{question.header}</p>
                      <p className="text-muted-foreground text-sm">{question.question}</p>
                    </div>

                    {question.options.length > 0 && (
                      <div className="space-y-2">
                        {question.options.map((option) => {
                          const selected = selectedOptions[index] ?? [];
                          const isSelected = !useTypedAnswer && selected.includes(option.label);
                          return (
                            <button
                              key={option.label}
                              type="button"
                              data-question-index={String(index)}
                              data-option-label={option.label}
                              data-testid={`question-option-${index}-${option.label}`}
                              className={cn(
                                "hover:border-primary/70 w-full rounded-md border p-2 text-left text-sm transition-colors",
                                isSelected ? "border-primary bg-primary/5" : "border-border",
                              )}
                              onClick={handleSelectOption}
                            >
                              <div className="font-medium">{option.label}</div>
                              {option.description && (
                                <div className="text-muted-foreground mt-0.5 text-xs">
                                  {option.description}
                                </div>
                              )}
                            </button>
                          );
                        })}
                      </div>
                    )}

                    {canTypeOwnAnswer && (
                      <div className="space-y-2">
                        <button
                          type="button"
                          data-question-index={String(index)}
                          data-testid={`question-typed-toggle-${index}`}
                          className={cn(
                            "hover:border-primary/70 w-full rounded-md border p-2 text-left text-sm transition-colors",
                            useTypedAnswer ? "border-primary bg-primary/5" : "border-border",
                          )}
                          onClick={handleEnableTypedMode}
                        >
                          <div className="font-medium">Type your own answer</div>
                        </button>
                        {useTypedAnswer && (
                          <Input
                            data-question-index={String(index)}
                            data-testid={`question-typed-input-${index}`}
                            value={typedAnswers[index] ?? ""}
                            onChange={handleTypedAnswerChange}
                            placeholder="Type your answer"
                            onClick={handleStopPropagation}
                          />
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {status === "pending" && !questionPayload && (
            <div className="flex justify-end gap-2">
              <Button variant="outline" size="sm" onClick={handleDenyClick} disabled={isLoading}>
                {isLoading ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <X className="h-4 w-4" />
                )}
                Deny
              </Button>
              <Button size="sm" onClick={handleApproveClick} disabled={isLoading}>
                {isLoading ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Check className="h-4 w-4" />
                )}
                Approve
              </Button>
            </div>
          )}

          {status === "pending" && questionPayload && (
            <div className="flex justify-end">
              <Button
                size="sm"
                onClick={handleApproveClick}
                disabled={isLoading || !canSubmitQuestion}
                data-testid="question-submit-answer"
              >
                {isLoading ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Check className="h-4 w-4" />
                )}
                Submit answer
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
