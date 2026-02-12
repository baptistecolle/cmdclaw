"use client";

import {
  Wrench,
  Check,
  Loader2,
  AlertCircle,
  Terminal,
  FolderSearch,
  FileSearch,
  BookOpen,
  FilePen,
  Pencil,
  Globe,
  StopCircle,
  type LucideIcon,
} from "lucide-react";
import Image from "next/image";
import ReactMarkdown from "react-markdown";
import type { IntegrationType } from "@/lib/integration-icons";
import {
  getIntegrationLogo,
  getIntegrationDisplayName,
  getOperationLabel,
} from "@/lib/integration-icons";

// Map internal SDK tool names to user-friendly display names
const TOOL_DISPLAY_NAMES: Record<string, string> = {
  Bash: "Running command",
  Glob: "Searching files",
  Grep: "Searching content",
  Read: "Reading file",
  Write: "Writing file",
  Edit: "Editing file",
  WebSearch: "Searching web",
  WebFetch: "Fetching page",
};

// Map internal SDK tool names to icons (all use consistent blue color)
const TOOL_ICONS: Record<string, LucideIcon> = {
  Bash: Terminal,
  Glob: FolderSearch,
  Grep: FileSearch,
  Read: BookOpen,
  Write: FilePen,
  Edit: Pencil,
  WebSearch: Globe,
  WebFetch: Globe,
};

function getToolDisplayName(toolName: string): string {
  return TOOL_DISPLAY_NAMES[toolName] ?? toolName;
}

function getToolIcon(toolName: string): LucideIcon {
  return TOOL_ICONS[toolName] ?? Wrench;
}

export type ActivityItemData = {
  id: string;
  timestamp: number;
  type: "text" | "thinking" | "tool_call" | "tool_result" | "system";
  content: string;
  toolName?: string;
  integration?: IntegrationType;
  operation?: string;
  status?: "running" | "complete" | "error" | "interrupted";
  input?: unknown;
  result?: unknown;
};

type Props = {
  item: ActivityItemData;
};

function formatValue(value: unknown): string {
  if (value === undefined || value === null) {
    return "";
  }
  if (typeof value === "string") {
    return value;
  }
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

// Extract command string from Bash tool input
function formatInput(input: unknown, toolName?: string): string {
  if (input === undefined || input === null) {
    return "";
  }

  // For Bash commands, extract just the command string
  if (toolName === "Bash" && typeof input === "object" && input !== null) {
    const bashInput = input as { command?: string };
    if (bashInput.command) {
      return bashInput.command;
    }
  }

  return formatValue(input);
}

export function ActivityItem({ item }: Props) {
  const { type, content, toolName, integration, operation, status, input, result } = item;

  // Get icon for tool calls only
  const getIcon = () => {
    if (type !== "tool_call" && type !== "tool_result") {
      return null;
    }

    // Integration icons take priority
    if (integration) {
      const logo = getIntegrationLogo(integration);
      if (logo) {
        return (
          <Image
            src={logo}
            alt={getIntegrationDisplayName(integration)}
            width={14}
            height={14}
            className="h-3.5 w-3.5 flex-shrink-0"
          />
        );
      }
    }

    // Tool-specific icons
    if (toolName) {
      const ToolIcon = getToolIcon(toolName);
      return <ToolIcon className="h-3.5 w-3.5 flex-shrink-0 text-blue-500" />;
    }

    return <Wrench className="h-3.5 w-3.5 text-blue-500 flex-shrink-0" />;
  };

  const getStatusIcon = () => {
    if (type === "thinking") {
      return null;
    }

    switch (status) {
      case "running":
        return <Loader2 className="h-3 w-3 animate-spin text-muted-foreground flex-shrink-0" />;
      case "complete":
        return <Check className="h-3 w-3 text-green-500 flex-shrink-0" />;
      case "error":
        return <AlertCircle className="h-3 w-3 text-red-500 flex-shrink-0" />;
      case "interrupted":
        return <StopCircle className="h-3 w-3 text-orange-500 flex-shrink-0" />;
      default:
        return null;
    }
  };

  // Render text content (agent response)
  if (type === "text") {
    return (
      <div className="prose prose-sm dark:prose-invert prose-p:my-1 prose-ul:my-1 prose-ol:my-1 prose-li:my-0 max-w-none py-0.5 text-foreground text-xs">
        <ReactMarkdown>{content}</ReactMarkdown>
      </div>
    );
  }

  // Render thinking content
  if (type === "thinking") {
    return (
      <div className="text-xs text-muted-foreground italic whitespace-pre-wrap py-0.5">
        {content}
      </div>
    );
  }

  // Render system message (interruption, etc.)
  if (type === "system") {
    return (
      <div className="text-xs py-0.5 flex items-center gap-1.5 text-orange-600 dark:text-orange-400">
        <StopCircle className="h-3.5 w-3.5 flex-shrink-0" />
        <span className="font-medium">{content}</span>
      </div>
    );
  }

  // Render tool call with full input/result
  // For integrations, show operation label (e.g., "Listing channels")
  // For regular tools, show tool action (e.g., "Running command")
  const displayName = (() => {
    if (integration) {
      // Use operation or toolName (which may contain the operation)
      const op = operation || toolName;
      return op ? getOperationLabel(integration, op) : getIntegrationDisplayName(integration);
    }
    return toolName ? getToolDisplayName(toolName) : content;
  })();

  const formattedInput = formatInput(input, toolName);
  const formattedResult = formatValue(result);

  return (
    <div className="text-xs py-0.5">
      <div className="flex items-center gap-1.5">
        {getIcon()}
        <span className="font-mono text-foreground">{displayName}</span>
        {getStatusIcon()}
      </div>
      {formattedInput && (
        <pre className="text-muted-foreground whitespace-pre-wrap ml-5 mt-0.5 font-mono">
          {formattedInput}
        </pre>
      )}
      {formattedResult && (
        <pre className="text-muted-foreground whitespace-pre-wrap ml-5 mt-0.5 font-mono">
          {formattedResult}
        </pre>
      )}
    </div>
  );
}
