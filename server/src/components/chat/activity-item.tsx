"use client";

import { Brain, Wrench, Check, Loader2, AlertCircle, Clock } from "lucide-react";
import { cn } from "@/lib/utils";
import { getIntegrationLogo, getIntegrationDisplayName } from "@/lib/integration-icons";
import type { IntegrationType } from "@/lib/integration-icons";

export type ActivityItemData = {
  id: string;
  timestamp: number;
  type: "thinking" | "tool_call" | "tool_result";
  content: string;
  toolName?: string;
  integration?: IntegrationType;
  status?: "running" | "complete" | "error";
};

type Props = {
  item: ActivityItemData;
  showTimestamp?: boolean;
};

function formatDuration(startTime: number): string {
  const elapsed = Date.now() - startTime;
  if (elapsed < 1000) return "<1s";
  if (elapsed < 60000) return `${Math.floor(elapsed / 1000)}s`;
  return `${Math.floor(elapsed / 60000)}m ${Math.floor((elapsed % 60000) / 1000)}s`;
}

export function ActivityItem({ item, showTimestamp = true }: Props) {
  const { type, content, toolName, integration, status } = item;

  // Truncate content for preview
  const truncatedContent = content.length > 80 ? content.slice(0, 80) + "..." : content;

  // Get icon and styling based on type
  const getIcon = () => {
    if (type === "thinking") {
      return <Brain className="h-3.5 w-3.5 text-purple-500" />;
    }
    if (type === "tool_call" || type === "tool_result") {
      // Show integration logo if available
      if (integration) {
        const logo = getIntegrationLogo(integration);
        if (logo) {
          return (
            <img src={logo} alt={getIntegrationDisplayName(integration)} className="h-3.5 w-3.5" />
          );
        }
      }
      return <Wrench className="h-3.5 w-3.5 text-blue-500" />;
    }
    return null;
  };

  const getStatusIcon = () => {
    if (type === "thinking") return null;

    switch (status) {
      case "running":
        return <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />;
      case "complete":
        return <Check className="h-3 w-3 text-green-500" />;
      case "error":
        return <AlertCircle className="h-3 w-3 text-red-500" />;
      default:
        return null;
    }
  };

  const getDisplayText = () => {
    if (type === "thinking") {
      return <span className="italic text-muted-foreground">{truncatedContent}</span>;
    }
    if (type === "tool_call" && toolName) {
      const displayName = integration
        ? `${getIntegrationDisplayName(integration)}.${toolName.split("_").pop()}`
        : toolName;

      return (
        <span className="text-foreground">
          <span className="font-mono text-xs">{displayName}</span>
          <span className="text-muted-foreground">
            {status === "running" ? " → Running..." : status === "complete" ? " → Complete" : status === "error" ? " → Error" : ""}
          </span>
        </span>
      );
    }
    return <span className="text-muted-foreground">{truncatedContent}</span>;
  };

  return (
    <div className="flex items-center gap-2 py-0.5 text-xs">
      <span className="flex-shrink-0">{getIcon()}</span>
      <span className="flex-1 truncate">{getDisplayText()}</span>
      <span className="flex items-center gap-1">
        {getStatusIcon()}
        {showTimestamp && (
          <span className="flex items-center gap-0.5 text-muted-foreground/60">
            <Clock className="h-2.5 w-2.5" />
            {formatDuration(item.timestamp)}
          </span>
        )}
      </span>
    </div>
  );
}
