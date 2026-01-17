"use client";

import { useState } from "react";
import { Check, AlertCircle, ChevronRight, Eye } from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { cn } from "@/lib/utils";
import { IntegrationBadges } from "./integration-badges";
import { ActivityItem, type ActivityItemData } from "./activity-item";
import type { IntegrationType } from "@/lib/integration-icons";

type Props = {
  messageId: string;
  integrationsUsed: IntegrationType[];
  hasError: boolean;
  activityItems?: ActivityItemData[];
  className?: string;
};

export function CollapsedTrace({
  messageId,
  integrationsUsed,
  hasError,
  activityItems = [],
  className,
}: Props) {
  const [isExpanded, setIsExpanded] = useState(false);

  return (
    <div className={cn("rounded-lg border border-border/50 bg-muted/20 overflow-hidden", className)}>
      {/* Header - always visible */}
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-muted/30 transition-colors"
      >
        <ChevronRight
          className={cn(
            "h-4 w-4 text-muted-foreground transition-transform duration-200",
            isExpanded && "rotate-90"
          )}
        />

        {hasError ? (
          <>
            <AlertCircle className="h-4 w-4 text-amber-500" />
            <span className="text-muted-foreground">Completed with error</span>
          </>
        ) : (
          <>
            <Check className="h-4 w-4 text-green-500" />
            <span className="text-muted-foreground">Working...</span>
          </>
        )}

        <div className="flex-1" />

        <IntegrationBadges integrations={integrationsUsed} size="sm" />

        <div className="flex items-center gap-1 text-xs text-muted-foreground/60 ml-2">
          <Eye className="h-3 w-3" />
          <span>View</span>
        </div>
      </button>

      {/* Expanded content */}
      <AnimatePresence initial={false}>
        {isExpanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2, ease: "easeInOut" }}
            className="overflow-hidden"
          >
            <div className="border-t border-border/30 px-3 py-2 max-h-[300px] overflow-y-auto">
              {activityItems.length > 0 ? (
                <div className="space-y-0.5">
                  {activityItems.map((item) => (
                    <ActivityItem key={item.id} item={item} />
                  ))}
                </div>
              ) : (
                <p className="text-xs text-muted-foreground italic">
                  Activity details not available
                </p>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
