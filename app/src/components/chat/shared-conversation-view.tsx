"use client";

import { Check, Copy, Globe } from "lucide-react";
import { useCallback, useMemo, useRef, useState } from "react";
import { formatPersistedChatTranscript } from "@/components/chat/chat-transcript";
import { MessageList } from "@/components/chat/message-list";
import {
  mapPersistedMessagesToChatMessages,
  type PersistedConversationMessage,
} from "@/components/chat/persisted-message-mapper";
import { Button } from "@/components/ui/button";

type Props = {
  title: string;
  messages: PersistedConversationMessage[];
};

export function SharedConversationView({ title, messages }: Props) {
  const [isCopied, setIsCopied] = useState(false);
  const copyResetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const normalizedMessages = useMemo(
    () => mapPersistedMessagesToChatMessages(messages),
    [messages],
  );

  const transcript = useMemo(() => formatPersistedChatTranscript(messages), [messages]);

  const handleCopy = useCallback(async () => {
    if (!transcript) {
      return;
    }
    await navigator.clipboard.writeText(transcript);
    setIsCopied(true);
    if (copyResetTimerRef.current) {
      clearTimeout(copyResetTimerRef.current);
    }
    copyResetTimerRef.current = setTimeout(() => {
      setIsCopied(false);
    }, 2000);
  }, [transcript]);

  return (
    <div className="bg-background min-h-screen">
      <header className="bg-background sticky top-0 z-10 flex h-14 items-center gap-2 border-b px-4">
        <span className="truncate text-sm font-medium">{title || "Shared conversation"}</span>
        <div className="ml-auto flex items-center gap-2">
          <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-600">
            <Globe className="h-3.5 w-3.5" />
            Shared
          </span>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={!transcript}
            onClick={handleCopy}
            title="Copy chat as text"
          >
            {isCopied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
            {isCopied ? "Copied" : "Copy"}
          </Button>
        </div>
      </header>
      <main className="mx-auto max-w-3xl p-4">
        <MessageList messages={normalizedMessages} />
      </main>
    </div>
  );
}
