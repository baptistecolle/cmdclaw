"use client";

import { Check, Copy } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { useConversation } from "@/orpc/hooks";
import type { MessageTiming } from "./chat-performance-metrics";
import { useChatAdvancedSettingsStore } from "./chat-advanced-settings-store";
import { formatPersistedChatTranscript } from "./chat-transcript";

type ConversationShape = {
  messages?: Array<{
    id: string;
    role: string;
    content: string;
    contentParts?: Array<
      | { type: "text"; text: string }
      | {
          type: "tool_use";
          id: string;
          name: string;
          input: Record<string, unknown>;
          integration?: string;
          operation?: string;
        }
      | { type: "tool_result"; tool_use_id: string; content: unknown }
      | {
          type: "approval";
          tool_use_id: string;
          tool_name: string;
          tool_input: unknown;
          integration: string;
          operation: string;
          command?: string;
          status: "approved" | "denied";
          question_answers?: string[][];
        }
      | { type: "thinking"; id: string; content: string }
      | { type: "system"; content: string }
    >;
    attachments?: Array<{
      filename: string;
      mimeType: string;
    }>;
    timing?: MessageTiming;
    sandboxFiles?: Array<{
      fileId: string;
      path: string;
      filename: string;
      mimeType: string;
    }>;
  }>;
};

type Props = {
  conversationId?: string;
  className?: string;
};

export function ChatCopyButton({ conversationId, className }: Props) {
  const { data: conversation } = useConversation(conversationId);
  const displayAdvancedMetrics = useChatAdvancedSettingsStore(
    (state) => state.displayAdvancedMetrics,
  );
  const [isCopied, setIsCopied] = useState(false);
  const copyResetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const transcript = useMemo(() => {
    const conv = conversation as ConversationShape | undefined;
    if (!conv?.messages || conv.messages.length === 0) {
      return "";
    }
    return formatPersistedChatTranscript(conv.messages, {
      includeTimingMetrics: displayAdvancedMetrics,
    });
  }, [conversation, displayAdvancedMetrics]);

  const hasTranscript = transcript.length > 0;

  const handleCopy = useCallback(() => {
    if (!hasTranscript) {
      return;
    }

    void navigator.clipboard
      .writeText(transcript)
      .then(() => {
        setIsCopied(true);
        if (copyResetTimerRef.current) {
          clearTimeout(copyResetTimerRef.current);
        }
        copyResetTimerRef.current = setTimeout(() => {
          setIsCopied(false);
        }, 2000);
      })
      .catch((err) => {
        console.error("Failed to copy chat transcript:", err);
      });
  }, [hasTranscript, transcript]);

  useEffect(
    () => () => {
      if (copyResetTimerRef.current) {
        clearTimeout(copyResetTimerRef.current);
      }
    },
    [],
  );

  if (!conversationId) {
    return null;
  }

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      className={className}
      data-testid="chat-copy-transcript-button"
      disabled={!hasTranscript}
      onClick={handleCopy}
      title="Copy chat as text"
    >
      {isCopied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
      {isCopied ? "Copied" : "Copy"}
    </Button>
  );
}
