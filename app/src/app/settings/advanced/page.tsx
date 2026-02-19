"use client";

import { CircleHelp } from "lucide-react";
import { useChatAdvancedSettingsStore } from "@/components/chat/chat-advanced-settings-store";
import { Switch } from "@/components/ui/switch";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

export default function AdvancedSettingsPage() {
  const displayAdvancedMetrics = useChatAdvancedSettingsStore(
    (state) => state.displayAdvancedMetrics,
  );
  const setDisplayAdvancedMetrics = useChatAdvancedSettingsStore(
    (state) => state.setDisplayAdvancedMetrics,
  );

  return (
    <div>
      <div className="mb-6">
        <h2 className="text-xl font-semibold">Advanced Settings</h2>
        <p className="text-muted-foreground mt-1 text-sm">
          Configure optional diagnostics and power-user controls.
        </p>
      </div>

      <div className="rounded-lg border p-5">
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-1.5">
              <label htmlFor="display-advanced-metrics" className="text-sm font-medium">
                Nerd mode
              </label>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    aria-label="What advanced metrics show"
                    className="text-muted-foreground hover:text-foreground inline-flex"
                  >
                    <CircleHelp className="h-3.5 w-3.5" />
                  </button>
                </TooltipTrigger>
                <TooltipContent className="max-w-xs text-xs">
                  Shows generation timing chips in chat and includes those metrics when you copy a
                  chat transcript.
                </TooltipContent>
              </Tooltip>
            </div>
            <p className="text-muted-foreground text-sm">
              Enable to show performance timings like generation and first-event wait.
            </p>
          </div>
          <Switch
            id="display-advanced-metrics"
            checked={displayAdvancedMetrics}
            onCheckedChange={setDisplayAdvancedMetrics}
          />
        </div>
      </div>
    </div>
  );
}
