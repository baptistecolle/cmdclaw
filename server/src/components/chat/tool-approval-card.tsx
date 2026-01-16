"use client";

import { useState, useMemo } from "react";
import { ChevronDown, ChevronRight, Check, X, Loader2, ShieldAlert, Code } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  getIntegrationIcon,
  getIntegrationDisplayName,
  getIntegrationColor,
} from "@/lib/integration-icons";
import { parseCliCommand } from "@/lib/parse-cli-command";
import { getPreviewComponent, GenericPreview } from "./previews";

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
}

export function ToolApprovalCard({
  toolUseId,
  toolName,
  toolInput,
  integration,
  operation,
  command,
  onApprove,
  onDeny,
  status,
  isLoading,
}: ToolApprovalCardProps) {
  const [expanded, setExpanded] = useState(true); // Start expanded for approvals
  const [showRawCommand, setShowRawCommand] = useState(false);

  const Icon = getIntegrationIcon(integration);
  const displayName = getIntegrationDisplayName(integration);
  const colorClass = getIntegrationColor(integration);

  // Parse the command to extract structured data
  const parsedCommand = useMemo(() => {
    if (!command) return null;
    return parseCliCommand(command);
  }, [command]);

  // Get the appropriate preview component
  const PreviewComponent = useMemo(() => {
    return getPreviewComponent(integration);
  }, [integration]);

  // Build preview props
  const previewProps = useMemo(() => {
    if (!parsedCommand) return null;
    return {
      integration: parsedCommand.integration,
      operation: parsedCommand.operation,
      args: parsedCommand.args,
      positionalArgs: parsedCommand.positionalArgs,
      command: parsedCommand.rawCommand,
    };
  }, [parsedCommand]);

  return (
    <div
      className={cn(
        "rounded-lg border bg-card text-card-foreground",
        status === "pending" && "border-amber-500/50 bg-amber-50/10",
        status === "approved" && "border-green-500/50",
        status === "denied" && "border-red-500/50"
      )}
    >
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-muted/50"
      >
        {expanded ? (
          <ChevronDown className="h-4 w-4" />
        ) : (
          <ChevronRight className="h-4 w-4" />
        )}
        {Icon ? (
          <Icon className={cn("h-4 w-4", colorClass)} />
        ) : (
          <ShieldAlert className="h-4 w-4 text-amber-500" />
        )}
        <span className="font-medium">{displayName}</span>
        <span className="text-muted-foreground">wants to</span>
        <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">
          {operation}
        </span>

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
          {previewProps && (
            <div className="mb-3">
              {PreviewComponent ? (
                <PreviewComponent {...previewProps} />
              ) : (
                <GenericPreview {...previewProps} />
              )}
            </div>
          )}

          {/* Collapsible Raw Command Section */}
          {command && (
            <div className="mb-3">
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setShowRawCommand(!showRawCommand);
                }}
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
                onClick={(e) => {
                  e.stopPropagation();
                  onDeny();
                }}
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
                onClick={(e) => {
                  e.stopPropagation();
                  onApprove();
                }}
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
