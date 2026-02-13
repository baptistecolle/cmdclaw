"use client";

import { Send, Square, Mic, Paperclip, X } from "lucide-react";
import Image from "next/image";
import { useState, useRef, useEffect, useCallback } from "react";
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

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => resolve(reader.result as string), { once: true });
    reader.addEventListener("error", () => reject(reader.error), { once: true });
    reader.readAsDataURL(file);
  });
}

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
        if (file.size > MAX_FILE_SIZE) {
          continue;
        }
        const preview = file.type.startsWith("image/") ? URL.createObjectURL(file) : undefined;
        toAdd.push({ file, preview });
      }
      return [...prev, ...toAdd];
    });
  }, []);

  const removeAttachment = useCallback((index: number) => {
    setAttachments((prev) => {
      const item = prev[index];
      if (item?.preview) {
        URL.revokeObjectURL(item.preview);
      }
      return prev.filter((_, i) => i !== index);
    });
  }, []);

  const handleSubmit = useCallback(async () => {
    if ((!value.trim() && attachments.length === 0) || disabled) {
      return;
    }

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
        if (a.preview) {
          URL.revokeObjectURL(a.preview);
        }
      }
      setAttachments([]);
    }

    onSend(value.trim(), attachmentData);
    setValue("");
  }, [attachments, disabled, onSend, value]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        handleSubmit();
      }
    },
    [handleSubmit],
  );

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragging(false);
      if (e.dataTransfer.files.length > 0) {
        addFiles(e.dataTransfer.files);
      }
    },
    [addFiles],
  );

  const handleRemoveAttachmentClick = useCallback(
    (e: React.MouseEvent<HTMLButtonElement>) => {
      const index = Number(e.currentTarget.dataset.attachmentIndex);
      if (Number.isFinite(index)) {
        removeAttachment(index);
      }
    },
    [removeAttachment],
  );

  const handleOpenFilePicker = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const handleFileInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      if (e.target.files) {
        addFiles(e.target.files);
      }
      e.target.value = "";
    },
    [addFiles],
  );

  const handleValueChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setValue(e.target.value);
  }, []);

  const handleRecordMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      if (!disabled && !isStreaming) {
        onStartRecording?.();
      }
    },
    [disabled, isStreaming, onStartRecording],
  );

  const handleRecordMouseUp = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      if (isRecording) {
        onStopRecording?.();
      }
    },
    [isRecording, onStopRecording],
  );

  const handleRecordMouseLeave = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      if (isRecording) {
        onStopRecording?.();
      }
    },
    [isRecording, onStopRecording],
  );

  const handleRecordTouchStart = useCallback(
    (e: React.TouchEvent) => {
      e.preventDefault();
      if (!disabled && !isStreaming) {
        onStartRecording?.();
      }
    },
    [disabled, isStreaming, onStartRecording],
  );

  const handleRecordTouchEnd = useCallback(
    (e: React.TouchEvent) => {
      e.preventDefault();
      if (isRecording) {
        onStopRecording?.();
      }
    },
    [isRecording, onStopRecording],
  );

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
              key={`${a.file.name}-${a.file.lastModified}-${a.file.size}`}
              className="group bg-background relative flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs"
            >
              {a.preview ? (
                <Image
                  src={a.preview}
                  alt={a.file.name}
                  width={32}
                  height={32}
                  unoptimized
                  className="h-8 w-8 rounded object-cover"
                />
              ) : (
                <Paperclip className="text-muted-foreground h-3.5 w-3.5" />
              )}
              <span className="max-w-[120px] truncate">{a.file.name}</span>
              <button
                type="button"
                data-attachment-index={i}
                onClick={handleRemoveAttachmentClick}
                className="hover:bg-muted ml-0.5 rounded-full p-0.5"
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
          onClick={handleOpenFilePicker}
        >
          <Paperclip className="h-4 w-4" />
        </Button>
        <input
          ref={fileInputRef}
          type="file"
          multiple
          className="hidden"
          onChange={handleFileInputChange}
        />

        <textarea
          ref={textareaRef}
          data-testid="chat-input"
          value={value}
          onChange={handleValueChange}
          onKeyDown={handleKeyDown}
          placeholder="Send a message..."
          disabled={disabled}
          rows={1}
          className="flex-1 resize-none bg-transparent px-2 py-1.5 text-sm focus:outline-none disabled:opacity-50"
        />
        {onStartRecording && onStopRecording && (
          <Button
            onMouseDown={handleRecordMouseDown}
            onMouseUp={handleRecordMouseUp}
            onMouseLeave={handleRecordMouseLeave}
            onTouchStart={handleRecordTouchStart}
            onTouchEnd={handleRecordTouchEnd}
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
