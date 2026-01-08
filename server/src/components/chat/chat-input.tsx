"use client";

import { useState, useRef, useEffect } from "react";
import { Send, Square } from "lucide-react";
import { Button } from "@/components/ui/button";

type Props = {
  onSend: (content: string) => void;
  onStop?: () => void;
  disabled?: boolean;
  isStreaming?: boolean;
};

export function ChatInput({ onSend, onStop, disabled, isStreaming }: Props) {
  const [value, setValue] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Auto-resize textarea
  useEffect(() => {
    const textarea = textareaRef.current;
    if (textarea) {
      textarea.style.height = "auto";
      textarea.style.height = `${Math.min(textarea.scrollHeight, 200)}px`;
    }
  }, [value]);

  const handleSubmit = () => {
    if (value.trim() && !disabled) {
      onSend(value.trim());
      setValue("");
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  return (
    <div className="flex gap-2 rounded-lg border bg-muted/50 p-2">
      <textarea
        ref={textareaRef}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="Send a message..."
        disabled={disabled}
        rows={1}
        className="flex-1 resize-none bg-transparent px-2 py-1.5 text-sm focus:outline-none disabled:opacity-50"
      />
      {isStreaming ? (
        <Button
          onClick={onStop}
          size="icon"
          variant="destructive"
          className="h-9 w-9"
        >
          <Square className="h-4 w-4" />
        </Button>
      ) : (
        <Button
          onClick={handleSubmit}
          disabled={disabled || !value.trim()}
          size="icon"
          className="h-9 w-9"
        >
          <Send className="h-4 w-4" />
        </Button>
      )}
    </div>
  );
}
