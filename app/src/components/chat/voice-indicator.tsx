"use client";

import { Mic, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

type Props = {
  isRecording: boolean;
  isProcessing: boolean;
  error?: string | null;
};

export function VoiceIndicator({ isRecording, isProcessing, error }: Props) {
  if (error) {
    return (
      <div className="flex items-center gap-2 rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">
        <Mic className="h-4 w-4" />
        <span>{error}</span>
      </div>
    );
  }

  if (isProcessing) {
    return (
      <div className="flex items-center gap-2 rounded-lg bg-muted px-3 py-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        <span>Transcribing...</span>
      </div>
    );
  }

  if (isRecording) {
    return (
      <div className="flex items-center gap-2 rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-500">
        <span className="relative flex h-3 w-3">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-400 opacity-75"></span>
          <span className="relative inline-flex h-3 w-3 rounded-full bg-red-500"></span>
        </span>
        <span>Recording... Release to send</span>
      </div>
    );
  }

  return null;
}

type VoiceHintProps = {
  className?: string;
};

export function VoiceHint({ className }: VoiceHintProps) {
  const isMac =
    typeof navigator !== "undefined" && navigator.platform.toUpperCase().indexOf("MAC") >= 0;
  const shortcut = isMac ? "⌘K" : "Ctrl+K";

  return (
    <div className={cn("text-xs text-muted-foreground", className)}>
      Hold <kbd className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">{shortcut}</kbd> to
      record voice
    </div>
  );
}
