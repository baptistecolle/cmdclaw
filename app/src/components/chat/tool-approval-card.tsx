"use client";

import { ChevronDown, ChevronRight, Check, X, Loader2, ShieldAlert, Code } from "lucide-react";
import Image from "next/image";
import { useState, useMemo, useCallback } from "react";
import { Button } from "@/components/ui/button";
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
  onApprove: () => void;
  onDeny: () => void;
  status: "pending" | "approved" | "denied";
  isLoading?: boolean;
  readonly?: boolean;
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
      onApprove();
    },
    [onApprove],
  );

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
        className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-muted/50"
      >
        {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        {logo ? (
          <Image src={logo} alt={displayName} width={16} height={16} className="h-4 w-4" />
        ) : (
          <ShieldAlert className="h-4 w-4 text-amber-500" />
        )}
        <span className="font-medium">{displayName}</span>
        <span className="text-muted-foreground">wants to</span>
        <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">{operation}</span>

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
                className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
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
                <pre className="mt-2 overflow-x-auto rounded bg-muted p-2 font-mono text-xs">
                  {command}
                </pre>
              )}
            </div>
          )}

          {status === "pending" && (
            <div className="flex justify-end gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={handleDenyClick}
                disabled={isLoading}
              >
                {isLoading ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <X className="h-4 w-4" />
                )}
                Deny
              </Button>
              <Button
                size="sm"
                onClick={handleApproveClick}
                disabled={isLoading}
              >
                {isLoading ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Check className="h-4 w-4" />
                )}
                Approve
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
