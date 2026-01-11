"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import Image from "next/image";
import {
  useIntegrationList,
  useGetAuthUrl,
  useToggleIntegration,
  useDisconnectIntegration,
} from "@/orpc/hooks";
import { Button } from "@/components/ui/button";
import { ExternalLink, CheckCircle2, XCircle, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { Checkbox } from "@/components/ui/checkbox";

const integrationConfig = {
  gmail: {
    name: "Gmail",
    description: "Read and send emails",
    icon: "/integrations/gmail.svg",
    bgColor: "bg-white dark:bg-gray-800",
  },
  notion: {
    name: "Notion",
    description: "Search and create pages",
    icon: "/integrations/notion.svg",
    bgColor: "bg-white dark:bg-gray-800",
  },
  linear: {
    name: "Linear",
    description: "Manage issues and projects",
    icon: "/integrations/linear.svg",
    bgColor: "bg-white dark:bg-gray-800",
  },
  github: {
    name: "GitHub",
    description: "Access repositories and PRs",
    icon: "/integrations/github.svg",
    bgColor: "bg-white dark:bg-gray-800",
  },
  airtable: {
    name: "Airtable",
    description: "Read and update bases",
    icon: "/integrations/airtable.svg",
    bgColor: "bg-white dark:bg-gray-800",
  },
  slack: {
    name: "Slack",
    description: "Send messages and read channels",
    icon: "/integrations/slack.svg",
    bgColor: "bg-white dark:bg-gray-800",
  },
} as const;

type IntegrationType = keyof typeof integrationConfig;

function IntegrationsPageContent() {
  const searchParams = useSearchParams();
  const { data: integrations, isLoading, refetch } = useIntegrationList();
  const getAuthUrl = useGetAuthUrl();
  const toggleIntegration = useToggleIntegration();
  const disconnectIntegration = useDisconnectIntegration();
  const [connectingType, setConnectingType] = useState<string | null>(null);
  const [notification, setNotification] = useState<{
    type: "success" | "error";
    message: string;
  } | null>(null);

  // Handle URL params for success/error
  useEffect(() => {
    const success = searchParams.get("success");
    const error = searchParams.get("error");

    if (success) {
      setNotification({
        type: "success",
        message: "Integration connected successfully!",
      });
      // Clear the URL params
      window.history.replaceState({}, "", "/settings/integrations");
      refetch();
    } else if (error) {
      setNotification({
        type: "error",
        message: `Failed to connect: ${error.replace(/_/g, " ")}`,
      });
      window.history.replaceState({}, "", "/settings/integrations");
    }
  }, [searchParams, refetch]);

  // Auto-dismiss notification
  useEffect(() => {
    if (notification) {
      const timer = setTimeout(() => setNotification(null), 5000);
      return () => clearTimeout(timer);
    }
  }, [notification]);

  const handleConnect = async (type: IntegrationType) => {
    setConnectingType(type);
    try {
      const result = await getAuthUrl.mutateAsync({
        type,
        redirectUrl: window.location.href,
      });
      window.location.href = result.authUrl;
    } catch (error) {
      console.error("Failed to get auth URL:", error);
      setConnectingType(null);
      setNotification({
        type: "error",
        message: "Failed to start connection. Please try again.",
      });
    }
  };

  const handleToggle = async (id: string, enabled: boolean) => {
    try {
      await toggleIntegration.mutateAsync({ id, enabled });
      refetch();
    } catch (error) {
      console.error("Failed to toggle integration:", error);
    }
  };

  const handleDisconnect = async (id: string) => {
    try {
      await disconnectIntegration.mutateAsync(id);
      refetch();
    } catch (error) {
      console.error("Failed to disconnect integration:", error);
    }
  };

  const integrationsList = Array.isArray(integrations) ? integrations : [];
  const connectedIntegrations = new Map(
    integrationsList.map((i) => [i.type, i])
  );

  return (
    <div>
      <div className="mb-6">
        <h2 className="text-xl font-semibold">Integrations</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Connect your accounts to let the AI assistant help you with tasks.
        </p>
      </div>

      {notification && (
        <div
          className={cn(
            "mb-6 flex items-center gap-2 rounded-lg border p-4",
            notification.type === "success"
              ? "border-green-500/50 bg-green-500/10 text-green-700 dark:text-green-400"
              : "border-red-500/50 bg-red-500/10 text-red-700 dark:text-red-400"
          )}
        >
          {notification.type === "success" ? (
            <CheckCircle2 className="h-5 w-5" />
          ) : (
            <XCircle className="h-5 w-5" />
          )}
          {notification.message}
        </div>
      )}

      {isLoading ? (
        <div className="text-sm text-muted-foreground">
          Loading integrations...
        </div>
      ) : (
        <div className="space-y-4">
          {(Object.entries(integrationConfig) as [IntegrationType, (typeof integrationConfig)[IntegrationType]][]).map(([type, config]) => {
            const integration = connectedIntegrations.get(type);
            const isConnecting = connectingType === type;

            return (
              <div
                key={type}
                className="flex flex-col gap-3 rounded-lg border p-4 sm:flex-row sm:items-center sm:justify-between sm:gap-4"
              >
                <div className="flex min-w-0 items-center gap-3 sm:gap-4">
                  <div
                    className={cn(
                      "flex shrink-0 items-center justify-center rounded-lg p-2 shadow-sm border",
                      config.bgColor
                    )}
                  >
                    <Image
                      src={config.icon}
                      alt={config.name}
                      width={24}
                      height={24}
                    />
                  </div>
                  <div className="min-w-0">
                    <h3 className="font-medium">{config.name}</h3>
                    {integration ? (
                      <p className="truncate text-sm text-muted-foreground">
                        Connected as{" "}
                        <span className="font-medium">
                          {integration.displayName}
                        </span>
                      </p>
                    ) : (
                      <p className="text-sm text-muted-foreground">
                        {config.description}
                      </p>
                    )}
                  </div>
                </div>

                <div className="flex shrink-0 items-center gap-2">
                  {integration ? (
                    <>
                      <label className="flex cursor-pointer items-center gap-2">
                        <Checkbox
                          checked={integration.enabled}
                          onCheckedChange={(checked) =>
                            handleToggle(integration.id, checked === true)
                          }
                        />
                        <span className="text-sm">Enabled</span>
                      </label>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleDisconnect(integration.id)}
                      >
                        Disconnect
                      </Button>
                    </>
                  ) : (
                    <Button
                      onClick={() => handleConnect(type as IntegrationType)}
                      disabled={isConnecting}
                    >
                      {isConnecting ? "Connecting..." : "Connect"}
                      <ExternalLink className="ml-2 h-4 w-4" />
                    </Button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default function IntegrationsPage() {
  return (
    <Suspense
      fallback={
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin" />
        </div>
      }
    >
      <IntegrationsPageContent />
    </Suspense>
  );
}
