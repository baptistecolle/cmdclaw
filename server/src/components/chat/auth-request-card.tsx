"use client";

import { useState } from "react";
import { ChevronDown, ChevronRight, Check, X, Loader2, Link2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  getIntegrationIcon,
  getIntegrationDisplayName,
  getIntegrationColor,
} from "@/lib/integration-icons";

export interface AuthRequestCardProps {
  integrations: string[];
  connectedIntegrations: string[];
  reason?: string;
  onConnect: (integration: string) => void;
  onCancel: () => void;
  status: "pending" | "connecting" | "completed" | "cancelled";
  isLoading?: boolean;
}

export function AuthRequestCard({
  integrations,
  connectedIntegrations,
  reason,
  onConnect,
  onCancel,
  status,
  isLoading,
}: AuthRequestCardProps) {
  const [expanded, setExpanded] = useState(true);

  return (
    <div
      className={cn(
        "rounded-lg border bg-card text-card-foreground",
        status === "pending" && "border-blue-500/50 bg-blue-50/10",
        status === "connecting" && "border-amber-500/50 bg-amber-50/10",
        status === "completed" && "border-green-500/50",
        status === "cancelled" && "border-red-500/50"
      )}
    >
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-muted/50"
      >
        {expanded ? (
          <ChevronDown className="h-4 w-4" />
        ) : (
          <ChevronRight className="h-4 w-4" />
        )}
        <Link2 className="h-4 w-4 text-blue-500" />
        <span className="font-medium">Connection Required</span>

        <div className="flex-1" />

        {status === "pending" && (
          <span className="flex items-center gap-1 text-xs text-blue-500">
            <Loader2 className="h-3 w-3 animate-spin" />
            Waiting for connection
          </span>
        )}
        {status === "connecting" && (
          <span className="flex items-center gap-1 text-xs text-amber-500">
            <Loader2 className="h-3 w-3 animate-spin" />
            Connecting...
          </span>
        )}
        {status === "completed" && (
          <span className="flex items-center gap-1 text-xs text-green-500">
            <Check className="h-3 w-3" />
            Connected
          </span>
        )}
        {status === "cancelled" && (
          <span className="flex items-center gap-1 text-xs text-red-500">
            <X className="h-3 w-3" />
            Cancelled
          </span>
        )}
      </button>

      {expanded && (
        <div className="border-t px-3 py-3">
          {reason && (
            <p className="mb-3 text-sm text-muted-foreground">{reason}</p>
          )}

          <div className="space-y-2 mb-3">
            {integrations.map((integration) => {
              const Icon = getIntegrationIcon(integration);
              const displayName = getIntegrationDisplayName(integration);
              const colorClass = getIntegrationColor(integration);
              const isConnected = connectedIntegrations.includes(integration);

              return (
                <div
                  key={integration}
                  className="flex items-center justify-between rounded border p-2"
                >
                  <div className="flex items-center gap-2">
                    {Icon && <Icon className={cn("h-4 w-4", colorClass)} />}
                    <span className="text-sm font-medium">{displayName}</span>
                  </div>
                  {isConnected ? (
                    <span className="flex items-center gap-1 text-xs text-green-500">
                      <Check className="h-3 w-3" />
                      Connected
                    </span>
                  ) : status === "pending" ? (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={(e) => {
                        e.stopPropagation();
                        onConnect(integration);
                      }}
                      disabled={isLoading}
                    >
                      {isLoading ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Link2 className="h-4 w-4 mr-1" />
                      )}
                      Connect
                    </Button>
                  ) : null}
                </div>
              );
            })}
          </div>

          {status === "pending" && (
            <div className="flex justify-end">
              <Button
                variant="outline"
                size="sm"
                onClick={(e) => {
                  e.stopPropagation();
                  onCancel();
                }}
                disabled={isLoading}
              >
                <X className="h-4 w-4 mr-1" />
                Cancel
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
