"use client";

import { ChevronDown, ChevronUp, Activity } from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { useRef, useEffect, useState, useCallback, useMemo } from "react";
import type { IntegrationType } from "@/lib/integration-icons";
import { cn } from "@/lib/utils";
import { ActivityItem, type ActivityItemData } from "./activity-item";
import { IntegrationBadges } from "./integration-badges";

export type { ActivityItemData };

type Props = {
  items: ActivityItemData[];
  isStreaming: boolean;
  isExpanded: boolean;
  onToggleExpand: () => void;
  integrationsUsed: IntegrationType[];
};

// Line height is ~18px (text-xs with line-height), 5 lines = ~90px + padding
const COLLAPSED_HEIGHT = 100;
const MAX_EXPANDED_HEIGHT = 400;
const ACTIVITY_FEED_EXPAND_TRANSITION = { duration: 0.2, ease: "easeInOut" };
const ACTIVITY_ITEM_INITIAL = { opacity: 0, y: 5 };
const ACTIVITY_ITEM_ANIMATE = { opacity: 1, y: 0 };
const ACTIVITY_ITEM_EXIT = { opacity: 0 };
const ACTIVITY_ITEM_TRANSITION = { duration: 0.15 };

export function ActivityFeed({
  items,
  isStreaming,
  isExpanded,
  onToggleExpand,
  integrationsUsed,
}: Props) {
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const [userHasScrolled, setUserHasScrolled] = useState(false);
  const shouldAutoScroll = isStreaming ? false : userHasScrolled;
  const contentHeight = isExpanded ? MAX_EXPANDED_HEIGHT : COLLAPSED_HEIGHT;
  const contentAnimate = useMemo(() => ({ height: contentHeight }), [contentHeight]);
  const contentStyle = useMemo(() => ({ height: contentHeight }), [contentHeight]);

  // Auto-scroll to bottom when new items arrive (unless user has scrolled up)
  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container || shouldAutoScroll) {
      return;
    }

    container.scrollTop = container.scrollHeight;
  }, [items, shouldAutoScroll]);

  // Track user scroll
  const handleScroll = useCallback(() => {
    const container = scrollContainerRef.current;
    if (!container) {
      return;
    }

    const threshold = 20;
    const isAtBottom =
      container.scrollHeight - container.scrollTop - container.clientHeight < threshold;

    // If user scrolls up from bottom, mark as user-scrolled
    // If they scroll back to bottom, reset
    setUserHasScrolled(!isAtBottom);
  }, []);

  if (items.length === 0) {
    // Show initial loading state
    return (
      <div className="rounded-lg border border-border/50 bg-muted/30">
        <div className="flex items-center gap-2 px-3 py-2">
          <Activity className="h-4 w-4 text-muted-foreground" />
          <span className="text-sm text-muted-foreground">Processing...</span>
          <div className="flex gap-1 ml-auto">
            <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-muted-foreground/50 [animation-delay:-0.3s]" />
            <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-muted-foreground/50 [animation-delay:-0.15s]" />
            <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-muted-foreground/50" />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-border/50 bg-muted/30 overflow-hidden">
      {/* Header */}
      <button
        onClick={onToggleExpand}
        className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-muted/50 transition-colors border-b border-border/30"
      >
        <Activity className="h-4 w-4 text-muted-foreground" />
        <span className="text-muted-foreground font-medium">Activity</span>
        {isStreaming && (
          <div className="flex gap-1 ml-1">
            <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-blue-500 [animation-delay:-0.3s]" />
            <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-blue-500 [animation-delay:-0.15s]" />
            <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-blue-500" />
          </div>
        )}
        <div className="flex-1" />
        <span className="text-xs text-muted-foreground/60">{items.length} items</span>
        {isExpanded ? (
          <ChevronUp className="h-4 w-4 text-muted-foreground" />
        ) : (
          <ChevronDown className="h-4 w-4 text-muted-foreground" />
        )}
      </button>

      {/* Content */}
      <motion.div
        initial={false}
        animate={contentAnimate}
        transition={ACTIVITY_FEED_EXPAND_TRANSITION}
        className="overflow-hidden"
      >
        <div
          ref={scrollContainerRef}
          onScroll={handleScroll}
          className={cn(
            "overflow-y-auto px-3 py-2",
            isExpanded ? `h-[${MAX_EXPANDED_HEIGHT}px]` : `h-[${COLLAPSED_HEIGHT}px]`,
          )}
          style={contentStyle}
        >
          <AnimatePresence initial={false}>
            {items.map((item) => (
              <motion.div
                key={item.id}
                initial={ACTIVITY_ITEM_INITIAL}
                animate={ACTIVITY_ITEM_ANIMATE}
                exit={ACTIVITY_ITEM_EXIT}
                transition={ACTIVITY_ITEM_TRANSITION}
              >
                <ActivityItem item={item} />
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
      </motion.div>

      {/* Integration badges footer */}
      {integrationsUsed.length > 0 && (
        <div className="px-3 py-1.5 border-t border-border/30 bg-muted/20">
          <IntegrationBadges integrations={integrationsUsed} size="sm" />
        </div>
      )}
    </div>
  );
}
