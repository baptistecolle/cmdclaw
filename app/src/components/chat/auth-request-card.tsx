"use client";

import { ChevronDown, ChevronRight, Check, X, Loader2, Link2 } from "lucide-react";
import Image from "next/image";
import { useCallback, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { getIntegrationDisplayName, getIntegrationLogo } from "@/lib/integration-icons";
import { cn } from "@/lib/utils";

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
  const integrationsByKey = useMemo(() => {
    const map = new Map<string, string>();
    for (const integration of integrations) {
      map.set(integration, integration);
    }
    return map;
  }, [integrations]);
  const handleToggleExpanded = useCallback(() => {
    setExpanded((prev) => !prev);
  }, []);
  const handleCancelClick = useCallback(
    (event: React.MouseEvent<HTMLButtonElement>) => {
      event.stopPropagation();
      onCancel();
    },
    [onCancel],
  );
  const handleConnectClick = useCallback(
    (event: React.MouseEvent<HTMLButtonElement>) => {
      event.stopPropagation();
      const integration = event.currentTarget.dataset.integrationKey;
      if (!integration) {
        return;
      }
      const resolved = integrationsByKey.get(integration);
      if (resolved) {
        onConnect(resolved);
      }
    },
    [integrationsByKey, onConnect],
  );

  return (
    <div
      className={cn(
        "rounded-lg border bg-card text-card-foreground",
        status === "pending" && "border-blue-500/50 bg-blue-50/10",
        status === "connecting" && "border-amber-500/50 bg-amber-50/10",
        status === "completed" && "border-green-500/50",
        status === "cancelled" && "border-red-500/50",
      )}
    >
      <button
        onClick={handleToggleExpanded}
        className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-muted/50"
      >
        {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        <div className="flex items-center -space-x-1">
          {integrations.slice(0, 3).map((integration) => {
            const logo = getIntegrationLogo(integration);
            return logo ? (
              <Image
                key={integration}
                src={logo}
                alt={getIntegrationDisplayName(integration)}
                width={20}
                height={20}
                className="h-5 w-5 object-contain"
              />
            ) : null;
          })}
        </div>
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
          {reason && <p className="mb-3 text-sm text-muted-foreground">{reason}</p>}

          <div className="space-y-3">
            {integrations.map((integration) => {
              const logo = getIntegrationLogo(integration);
              const displayName = getIntegrationDisplayName(integration);
              const isConnected = connectedIntegrations.includes(integration);

              return (
                <div key={integration} className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    {logo && (
                      <Image
                        src={logo}
                        alt={displayName}
                        width={24}
                        height={24}
                        className="h-6 w-6 object-contain"
                      />
                    )}
                    <span className="text-sm">
                      <span className="font-medium">Bap</span> needs access to{" "}
                      <span className="font-medium">{displayName}</span>
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    {isConnected ? (
                      <span className="flex items-center gap-1 text-xs text-green-500">
                        <Check className="h-3 w-3" />
                        Connected
                      </span>
                    ) : status === "pending" ? (
                      <>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={handleCancelClick}
                          disabled={isLoading}
                        >
                          <X className="h-4 w-4 mr-1" />
                          Cancel
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          data-integration-key={integration}
                          onClick={handleConnectClick}
                          disabled={isLoading}
                        >
                          {isLoading ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <Link2 className="h-4 w-4 mr-1" />
                          )}
                          Connect
                        </Button>
                      </>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
