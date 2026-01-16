"use client";

import { useState } from "react";
import { ChevronDown, ChevronRight, Check, X, Loader2, ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  getIntegrationIcon,
  getIntegrationDisplayName,
  getIntegrationColor,
} from "@/lib/integration-icons";

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

  const Icon = getIntegrationIcon(integration);
  const displayName = getIntegrationDisplayName(integration);
  const colorClass = getIntegrationColor(integration);

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
          {command && (
            <div className="mb-3">
              <p className="mb-1 text-xs font-medium text-muted-foreground">
                Command:
              </p>
              <pre className="overflow-x-auto rounded bg-muted p-2 font-mono text-xs">
                {command}
              </pre>
            </div>
          )}

          <div className="mb-3">
            <p className="mb-1 text-xs font-medium text-muted-foreground">
              Details:
            </p>
            <pre className="max-h-32 overflow-auto rounded bg-muted p-2 text-xs">
              {JSON.stringify(toolInput, null, 2)}
            </pre>
          </div>

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
