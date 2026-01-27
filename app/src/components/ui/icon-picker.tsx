"use client";

import { useState } from "react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  EmojiPicker,
  EmojiPickerContent,
  EmojiPickerSearch,
} from "@/components/ui/emoji-picker";
import { cn } from "@/lib/utils";
import { FileText } from "lucide-react";

interface IconPickerProps {
  value?: string | null;
  onChange: (value: string | null) => void;
  children?: React.ReactNode;
}

export function IconDisplay({
  icon,
  className,
}: {
  icon?: string | null;
  className?: string;
}) {
  if (!icon) {
    return <FileText className={cn("h-5 w-5 text-muted-foreground", className)} />;
  }

  return <span className={cn("text-lg leading-none", className)}>{icon}</span>;
}

export function IconPicker({ value, onChange, children }: IconPickerProps) {
  const [open, setOpen] = useState(false);

  const handleEmojiSelect = (emoji: string) => {
    onChange(emoji);
    setOpen(false);
  };

  const handleRemove = () => {
    onChange(null);
    setOpen(false);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        {children || (
          <button
            type="button"
            className="flex h-10 w-10 items-center justify-center rounded-lg border bg-muted hover:bg-muted/80 transition-colors"
          >
            <IconDisplay icon={value} />
          </button>
        )}
      </PopoverTrigger>
      <PopoverContent className="w-[320px] p-0" align="start">
        <div className="flex items-center justify-between border-b px-3 py-2">
          <span className="text-sm font-medium">Pick an emoji</span>
          {value && (
            <button
              onClick={handleRemove}
              className="text-xs text-muted-foreground hover:text-foreground"
            >
              Remove
            </button>
          )}
        </div>
        <EmojiPicker
          className="h-[280px] w-full border-none"
          onEmojiSelect={(emoji) => handleEmojiSelect(emoji.emoji)}
        >
          <EmojiPickerSearch placeholder="Search emoji..." />
          <EmojiPickerContent />
        </EmojiPicker>
      </PopoverContent>
    </Popover>
  );
}
