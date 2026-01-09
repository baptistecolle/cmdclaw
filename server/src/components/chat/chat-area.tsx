"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { MessageList, type Message, type MessagePart } from "./message-list";
import { ChatInput } from "./chat-input";
import { StreamingMessage } from "./streaming-message";
import { VoiceIndicator, VoiceHint } from "./voice-indicator";
import { useChatStream, useConversation, useTranscribe } from "@/orpc/hooks";
import { useVoiceRecording, blobToBase64 } from "@/hooks/use-voice-recording";
import { useRouter } from "next/navigation";
import { MessageSquare } from "lucide-react";
import { useHotkeys } from "react-hotkeys-hook";

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
  const [streamingParts, setStreamingParts] = useState<MessagePart[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [isProcessingVoice, setIsProcessingVoice] = useState(false);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const isRecordingRef = useRef(false);

  // Voice recording
  const { isRecording, error: voiceError, startRecording, stopRecording } = useVoiceRecording();
  const { mutateAsync: transcribe } = useTranscribe();

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
      setStreamingParts([]);
    }
  }, [conversationId]);

  // Auto-scroll
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, streamingParts]);

  const handleSend = useCallback(async (content: string) => {
    const userMessage: Message = {
      id: `temp-${Date.now()}`,
      role: "user",
      content,
    };
    setMessages((prev) => [...prev, userMessage]);
    setIsStreaming(true);
    setStreamingParts([]);

    const allParts: MessagePart[] = [];
    let toolCallCounter = 0;

    await sendMessage(
      { conversationId, content },
      {
        onText: (text) => {
          // Check if the last part is a text part - if so, append to it
          const lastPart = allParts[allParts.length - 1];
          if (lastPart && lastPart.type === "text") {
            lastPart.content += text;
          } else {
            // Create a new text part
            allParts.push({ type: "text", content: text });
          }
          setStreamingParts([...allParts]);
        },
        onToolUse: (toolName, input) => {
          allParts.push({
            type: "tool_call",
            id: `tc-${toolCallCounter++}`,
            name: toolName,
            input,
          });
          setStreamingParts([...allParts]);
        },
        onToolResult: (toolName, result) => {
          // Find the last tool call with this name that doesn't have a result
          for (let i = allParts.length - 1; i >= 0; i--) {
            const part = allParts[i];
            if (part.type === "tool_call" && part.name === toolName && part.result === undefined) {
              part.result = result;
              break;
            }
          }
          setStreamingParts([...allParts]);
        },
        onDone: (newConversationId, messageId) => {
          // Compute full content from text parts
          const fullContent = allParts
            .filter((p): p is MessagePart & { type: "text" } => p.type === "text")
            .map((p) => p.content)
            .join("");

          // Add assistant message to list
          setMessages((prev) => [
            ...prev,
            {
              id: messageId,
              role: "assistant",
              content: fullContent,
              parts: allParts,
            },
          ]);
          setStreamingParts([]);
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
  }, [conversationId, router, sendMessage]);

  // Voice recording: stop and transcribe
  const stopRecordingAndTranscribe = useCallback(async () => {
    if (!isRecordingRef.current) return;
    isRecordingRef.current = false;

    const audioBlob = await stopRecording();
    if (!audioBlob || audioBlob.size === 0) return;

    setIsProcessingVoice(true);
    try {
      const base64Audio = await blobToBase64(audioBlob);
      const result = await transcribe({
        audio: base64Audio,
        mimeType: audioBlob.type || "audio/webm",
      });

      if (result.text && result.text.trim()) {
        handleSend(result.text.trim());
      }
    } catch (err) {
      console.error("Transcription error:", err);
    } finally {
      setIsProcessingVoice(false);
    }
  }, [stopRecording, transcribe, handleSend]);

  // Push-to-talk: Ctrl/Cmd + M - start recording on keydown
  useHotkeys(
    "mod+m",
    () => {
      if (!isRecordingRef.current && !isStreaming && !isProcessingVoice) {
        isRecordingRef.current = true;
        startRecording();
      }
    },
    { keydown: true, keyup: false, preventDefault: true },
    [startRecording, isStreaming, isProcessingVoice]
  );

  // Push-to-talk: stop recording on keyup of M key
  useEffect(() => {
    if (!isRecording) return;

    const handleKeyUp = (e: KeyboardEvent) => {
      // Stop when M key is released (regardless of modifier state)
      if (e.key === "m" || e.key === "M") {
        stopRecordingAndTranscribe();
      }
    };

    document.addEventListener("keyup", handleKeyUp);
    return () => document.removeEventListener("keyup", handleKeyUp);
  }, [isRecording, stopRecordingAndTranscribe]);

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
                <StreamingMessage parts={streamingParts} />
              )}
            </>
          )}

          <div ref={messagesEndRef} />
        </div>
      </div>

      <div className="border-t bg-background p-4">
        <div className="mx-auto max-w-3xl space-y-2">
          {(isRecording || isProcessingVoice || voiceError) && (
            <VoiceIndicator
              isRecording={isRecording}
              isProcessing={isProcessingVoice}
              error={voiceError}
            />
          )}
          <ChatInput
            onSend={handleSend}
            disabled={isStreaming || isRecording || isProcessingVoice}
            isStreaming={isStreaming}
          />
          <VoiceHint className="text-center" />
        </div>
      </div>
    </div>
  );
}
