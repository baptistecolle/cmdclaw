"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { Send, Square, Mic, Paperclip, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export type AttachmentData = {
  name: string;
  mimeType: string;
  dataUrl: string;
};

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
const MAX_FILES = 5;

type AttachmentItem = { file: File; preview?: string };

type Props = {
  onSend: (content: string, attachments?: AttachmentData[]) => void;
  onStop?: () => void;
  disabled?: boolean;
  isStreaming?: boolean;
  isRecording?: boolean;
  onStartRecording?: () => void;
  onStopRecording?: () => void;
};

export function ChatInput({
  onSend,
  onStop,
  disabled,
  isStreaming,
  isRecording,
  onStartRecording,
  onStopRecording,
}: Props) {
  const [value, setValue] = useState("");
  const [attachments, setAttachments] = useState<AttachmentItem[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Auto-resize textarea
  useEffect(() => {
    const textarea = textareaRef.current;
    if (textarea) {
      textarea.style.height = "auto";
      textarea.style.height = `${Math.min(textarea.scrollHeight, 200)}px`;
    }
  }, [value]);

  const addFiles = useCallback((files: FileList | File[]) => {
    const fileArray = Array.from(files);
    setAttachments((prev) => {
      const remaining = MAX_FILES - prev.length;
      const toAdd: AttachmentItem[] = [];
      for (const file of fileArray.slice(0, remaining)) {
        if (file.size > MAX_FILE_SIZE) continue;
        const preview = file.type.startsWith("image/")
          ? URL.createObjectURL(file)
          : undefined;
        toAdd.push({ file, preview });
      }
      return [...prev, ...toAdd];
    });
  }, []);

  const removeAttachment = useCallback((index: number) => {
    setAttachments((prev) => {
      const item = prev[index];
      if (item?.preview) URL.revokeObjectURL(item.preview);
      return prev.filter((_, i) => i !== index);
    });
  }, []);

  const readFileAsDataUrl = (file: File): Promise<string> =>
    new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });

  const handleSubmit = async () => {
    if ((!value.trim() && attachments.length === 0) || disabled) return;

    let attachmentData: AttachmentData[] | undefined;
    if (attachments.length > 0) {
      attachmentData = await Promise.all(
        attachments.map(async (a) => ({
          name: a.file.name,
          mimeType: a.file.type,
          dataUrl: await readFileAsDataUrl(a.file),
        })),
      );
      // Clean up previews
      for (const a of attachments) {
        if (a.preview) URL.revokeObjectURL(a.preview);
      }
      setAttachments([]);
    }

    onSend(value.trim(), attachmentData);
    setValue("");
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files.length > 0) {
      addFiles(e.dataTransfer.files);
    }
  };

  return (
    <div
      className={cn(
        "flex flex-col gap-2 rounded-lg border bg-muted/50 p-2 transition-colors",
        isDragging && "border-primary bg-primary/5",
      )}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {/* Attachment previews */}
      {attachments.length > 0 && (
        <div className="flex flex-wrap gap-2 px-1">
          {attachments.map((a, i) => (
            <div
              key={i}
              className="group relative flex items-center gap-1.5 rounded-md border bg-background px-2 py-1 text-xs"
            >
              {a.preview ? (
                <img
                  src={a.preview}
                  alt={a.file.name}
                  className="h-8 w-8 rounded object-cover"
                />
              ) : (
                <Paperclip className="h-3.5 w-3.5 text-muted-foreground" />
              )}
              <span className="max-w-[120px] truncate">{a.file.name}</span>
              <button
                type="button"
                onClick={() => removeAttachment(i)}
                className="ml-0.5 rounded-full p-0.5 hover:bg-muted"
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="flex gap-2">
        {/* Attach button */}
        <Button
          type="button"
          size="icon"
          variant="ghost"
          className="h-9 w-9 shrink-0"
          disabled={disabled || isStreaming || attachments.length >= MAX_FILES}
          onClick={() => fileInputRef.current?.click()}
        >
          <Paperclip className="h-4 w-4" />
        </Button>
        <input
          ref={fileInputRef}
          type="file"
          multiple
          className="hidden"
          onChange={(e) => {
            if (e.target.files) addFiles(e.target.files);
            e.target.value = "";
          }}
        />

        <textarea
          ref={textareaRef}
          data-testid="chat-input"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Send a message..."
          disabled={disabled}
          rows={1}
          className="flex-1 resize-none bg-transparent px-2 py-1.5 text-sm focus:outline-none disabled:opacity-50"
        />
        {onStartRecording && onStopRecording && (
          <Button
            onMouseDown={(e) => {
              e.preventDefault();
              if (!disabled && !isStreaming) onStartRecording();
            }}
            onMouseUp={(e) => {
              e.preventDefault();
              if (isRecording) onStopRecording();
            }}
            onMouseLeave={(e) => {
              e.preventDefault();
              if (isRecording) onStopRecording();
            }}
            onTouchStart={(e) => {
              e.preventDefault();
              if (!disabled && !isStreaming) onStartRecording();
            }}
            onTouchEnd={(e) => {
              e.preventDefault();
              if (isRecording) onStopRecording();
            }}
            disabled={disabled && !isRecording}
            size="icon"
            variant={isRecording ? "destructive" : "outline"}
            className={cn("h-9 w-9 touch-none", isRecording && "animate-pulse")}
          >
            <Mic className="h-4 w-4" />
          </Button>
        )}
        {isStreaming ? (
          <Button
            onClick={onStop}
            data-testid="chat-stop"
            aria-label="Stop generation"
            size="icon"
            variant="destructive"
            className="h-9 w-9"
          >
            <Square className="h-4 w-4" />
          </Button>
        ) : (
          <Button
            onClick={handleSubmit}
            data-testid="chat-send"
            aria-label="Send message"
            disabled={disabled || (!value.trim() && attachments.length === 0)}
            size="icon"
            className="h-9 w-9"
          >
            <Send className="h-4 w-4" />
          </Button>
        )}
      </div>
    </div>
  );
}
