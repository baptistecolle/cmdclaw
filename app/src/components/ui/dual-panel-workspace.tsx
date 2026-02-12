"use client";

import {
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type DualPanelWorkspaceProps = {
  left: ReactNode;
  right: ReactNode;
  leftTitle?: string;
  rightTitle?: string;
  defaultRightWidth?: number;
  minLeftWidth?: number;
  minRightWidth?: number;
  storageKey?: string;
  className?: string;
};

const DEFAULT_RIGHT_WIDTH = 48;
const DEFAULT_MIN_LEFT = 28;
const DEFAULT_MIN_RIGHT = 30;

export function DualPanelWorkspace({
  left,
  right,
  leftTitle = "Assistant",
  rightTitle = "Editor",
  defaultRightWidth = DEFAULT_RIGHT_WIDTH,
  minLeftWidth = DEFAULT_MIN_LEFT,
  minRightWidth = DEFAULT_MIN_RIGHT,
  storageKey,
  className,
}: DualPanelWorkspaceProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const dragStateRef = useRef<{ active: boolean }>({ active: false });
  const pointerUpHandlerRef = useRef<(() => void) | null>(null);
  const [mobilePanel, setMobilePanel] = useState<"left" | "right">("right");
  const [rightWidth, setRightWidth] = useState(() => {
    if (!storageKey || typeof window === "undefined") {
      return defaultRightWidth;
    }
    const saved = window.localStorage.getItem(storageKey);
    const parsed = Number(saved);
    if (!Number.isFinite(parsed)) {
      return defaultRightWidth;
    }
    const maxRight = 100 - minLeftWidth;
    const minRight = minRightWidth;
    return Math.min(Math.max(minRight, maxRight), Math.max(minRight, parsed));
  });

  const bounds = useMemo(() => {
    const maxRight = 100 - minLeftWidth;
    const minRight = minRightWidth;
    return {
      minRight,
      maxRight: Math.max(minRight, maxRight),
    };
  }, [minLeftWidth, minRightWidth]);

  const setWidthWithinBounds = useCallback(
    (value: number) => {
      const next = Math.min(bounds.maxRight, Math.max(bounds.minRight, value));
      setRightWidth(next);
      if (storageKey && typeof window !== "undefined") {
        window.localStorage.setItem(storageKey, String(next));
      }
    },
    [bounds.maxRight, bounds.minRight, storageKey],
  );

  const onPointerMove = useCallback(
    (event: globalThis.PointerEvent) => {
      if (!dragStateRef.current.active || !containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      const x = event.clientX - rect.left;
      const leftPct = (x / rect.width) * 100;
      const nextRight = 100 - leftPct;
      setWidthWithinBounds(nextRight);
    },
    [setWidthWithinBounds],
  );

  const stopDrag = useCallback(() => {
    dragStateRef.current.active = false;
    document.body.style.cursor = "";
    document.body.style.userSelect = "";
    window.removeEventListener("pointermove", onPointerMove);
    if (pointerUpHandlerRef.current) {
      window.removeEventListener("pointerup", pointerUpHandlerRef.current);
      pointerUpHandlerRef.current = null;
    }
  }, [onPointerMove]);

  const startDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    dragStateRef.current.active = true;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    window.addEventListener("pointermove", onPointerMove);
    const handlePointerUp = () => stopDrag();
    pointerUpHandlerRef.current = handlePointerUp;
    window.addEventListener("pointerup", handlePointerUp);
  };

  useEffect(() => {
    return () => {
      stopDrag();
    };
  }, [stopDrag]);

  const leftWidth = 100 - rightWidth;

  return (
    <div className={cn("flex min-h-0 flex-1 flex-col", className)}>
      <div className="mb-3 flex items-center gap-2 md:hidden">
        <Button
          type="button"
          variant={mobilePanel === "left" ? "default" : "outline"}
          size="sm"
          onClick={() => setMobilePanel("left")}
        >
          {leftTitle}
        </Button>
        <Button
          type="button"
          variant={mobilePanel === "right" ? "default" : "outline"}
          size="sm"
          onClick={() => setMobilePanel("right")}
        >
          {rightTitle}
        </Button>
      </div>

      <div className="flex min-h-0 flex-1 md:hidden">
        {mobilePanel === "left" ? (
          <section className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border bg-background">
            <div className="border-b px-4 py-2.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {leftTitle}
            </div>
            <div className="min-h-0 flex-1">{left}</div>
          </section>
        ) : (
          <section className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border bg-background">
            <div className="border-b px-4 py-2.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {rightTitle}
            </div>
            <div className="min-h-0 flex-1">{right}</div>
          </section>
        )}
      </div>

      <div ref={containerRef} className="hidden min-h-0 flex-1 md:flex">
        <section
          className="flex min-h-0 flex-col overflow-hidden rounded-l-xl border bg-background"
          style={{ width: `${leftWidth}%` }}
        >
          <div className="border-b px-4 py-2.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {leftTitle}
          </div>
          <div className="min-h-0 flex-1">{left}</div>
        </section>

        <div
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize panels"
          tabIndex={0}
          onPointerDown={startDrag}
          onKeyDown={(event) => {
            if (event.key === "ArrowLeft") {
              setWidthWithinBounds(rightWidth + 2);
            }
            if (event.key === "ArrowRight") {
              setWidthWithinBounds(rightWidth - 2);
            }
          }}
          className="group relative w-3 cursor-col-resize"
        >
          <div className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-border transition-colors group-hover:bg-foreground/40" />
          <div className="absolute top-1/2 left-1/2 h-12 w-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-border/80 transition-colors group-hover:bg-foreground/40" />
        </div>

        <section
          className="flex min-h-0 flex-col overflow-hidden rounded-r-xl border bg-background"
          style={{ width: `${rightWidth}%` }}
        >
          <div className="border-b px-4 py-2.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {rightTitle}
          </div>
          <div className="min-h-0 flex-1">{right}</div>
        </section>
      </div>
    </div>
  );
}
