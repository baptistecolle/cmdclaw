"use client";

import { useState, useRef, useEffect } from "react";
import { MessageList, type Message } from "./message-list";
import { ChatInput } from "./chat-input";
import { StreamingMessage } from "./streaming-message";
import { useChatStream, useConversation } from "@/orpc/hooks";
import { useRouter } from "next/navigation";
import { MessageSquare } from "lucide-react";

type Props = {
  conversationId?: string;
};

export function ChatArea({ conversationId }: Props) {
  const router = useRouter();
  const { data: existingConversation, isLoading } = useConversation(
    conversationId
  );
  const { sendMessage } = useChatStream();

  const [messages, setMessages] = useState<Message[]>([]);
  const [streamingContent, setStreamingContent] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [toolCalls, setToolCalls] = useState<
    { name: string; input: unknown; result?: unknown }[]
  >([]);

  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Load existing messages
  useEffect(() => {
    const conv = existingConversation as {
      messages?: Array<{
        id: string;
        role: string;
        content: string;
        toolCalls?: unknown;
      }>;
    } | null | undefined;

    if (conv?.messages) {
      setMessages(
        conv.messages.map((m) => ({
          id: m.id,
          role: m.role as Message["role"],
          content: m.content,
          toolCalls: (m.toolCalls as Message["toolCalls"]) ?? undefined,
        }))
      );
    }
  }, [existingConversation]);

  // Reset when conversation changes
  useEffect(() => {
    if (!conversationId) {
      setMessages([]);
      setStreamingContent("");
      setToolCalls([]);
    }
  }, [conversationId]);

  // Auto-scroll
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, streamingContent]);

  const handleSend = async (content: string) => {
    const userMessage: Message = {
      id: `temp-${Date.now()}`,
      role: "user",
      content,
    };
    setMessages((prev) => [...prev, userMessage]);
    setIsStreaming(true);
    setStreamingContent("");
    setToolCalls([]);

    let fullContent = "";
    const allToolCalls: { name: string; input: unknown; result?: unknown }[] =
      [];

    await sendMessage(
      { conversationId, content },
      {
        onText: (text) => {
          fullContent += text;
          setStreamingContent(fullContent);
        },
        onToolUse: (toolName, input) => {
          allToolCalls.push({ name: toolName, input });
          setToolCalls([...allToolCalls]);
        },
        onToolResult: (toolName, result) => {
          const idx = allToolCalls.findIndex(
            (tc) => tc.name === toolName && !tc.result
          );
          if (idx !== -1) {
            allToolCalls[idx].result = result;
            setToolCalls([...allToolCalls]);
          }
        },
        onDone: (newConversationId, messageId) => {
          // Add assistant message to list
          setMessages((prev) => [
            ...prev,
            {
              id: messageId,
              role: "assistant",
              content: fullContent,
              toolCalls: allToolCalls.map((tc, i) => ({
                id: `tc-${i}`,
                name: tc.name,
                input: tc.input as Record<string, unknown>,
                result: tc.result,
              })),
            },
          ]);
          setStreamingContent("");
          setToolCalls([]);
          setIsStreaming(false);

          // Navigate to new conversation if this was a new chat
          if (!conversationId && newConversationId) {
            router.push(`/chat/${newConversationId}`);
          }
        },
        onError: (message) => {
          console.error("Chat error:", message);
          setIsStreaming(false);
          // Add error message
          setMessages((prev) => [
            ...prev,
            {
              id: `error-${Date.now()}`,
              role: "assistant",
              content: `Error: ${message}`,
            },
          ]);
        },
      }
    );
  };

  if (conversationId && isLoading) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <div className="text-muted-foreground">Loading conversation...</div>
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col">
      <div className="flex-1 overflow-y-auto p-4">
        <div className="mx-auto max-w-3xl">
          {messages.length === 0 && !isStreaming ? (
            <div className="flex h-[60vh] flex-col items-center justify-center gap-4 text-center">
              <div className="flex h-16 w-16 items-center justify-center rounded-full bg-muted">
                <MessageSquare className="h-8 w-8 text-muted-foreground" />
              </div>
              <div>
                <h2 className="text-xl font-semibold">How can I help you?</h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  Ask me anything or use your connected integrations
                </p>
              </div>
            </div>
          ) : (
            <>
              <MessageList messages={messages} />

              {isStreaming && (
                <StreamingMessage
                  content={streamingContent}
                  toolCalls={toolCalls}
                />
              )}
            </>
          )}

          <div ref={messagesEndRef} />
        </div>
      </div>

      <div className="border-t bg-background p-4">
        <div className="mx-auto max-w-3xl">
          <ChatInput
            onSend={handleSend}
            disabled={isStreaming}
            isStreaming={isStreaming}
          />
        </div>
      </div>
    </div>
  );
}
