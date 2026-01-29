"use client";

import { Suspense, useRef } from "react";
import { useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import Image from "next/image";
import {
  useIntegrationList,
  useGetAuthUrl,
  useToggleIntegration,
  useDisconnectIntegration,
  useLinkLinkedIn,
} from "@/orpc/hooks";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ExternalLink, CheckCircle2, XCircle, Loader2, Search, ChevronDown } from "lucide-react";
import { getIntegrationActions } from "@/lib/integration-icons";
import { cn } from "@/lib/utils";
import { Checkbox } from "@/components/ui/checkbox";

type FilterTab = "all" | "connected" | "not_connected";

const integrationConfig = {
  gmail: {
    name: "Google Gmail",
    description: "Read and send emails",
    icon: "/integrations/google-gmail.svg",
    bgColor: "bg-white dark:bg-gray-800",
  },
  google_calendar: {
    name: "Google Calendar",
    description: "Manage events and calendars",
    icon: "/integrations/google-calendar.svg",
    bgColor: "bg-white dark:bg-gray-800",
  },
  google_docs: {
    name: "Google Docs",
    description: "Read and edit documents",
    icon: "/integrations/google-docs.svg",
    bgColor: "bg-white dark:bg-gray-800",
  },
  google_sheets: {
    name: "Google Sheets",
    description: "Read and edit spreadsheets",
    icon: "/integrations/google-sheets.svg",
    bgColor: "bg-white dark:bg-gray-800",
  },
  google_drive: {
    name: "Google Drive",
    description: "Access and manage files",
    icon: "/integrations/google-drive.svg",
    bgColor: "bg-white dark:bg-gray-800",
  },
  notion: {
    name: "Notion",
    description: "Search and create pages",
    icon: "/integrations/notion.svg",
    bgColor: "bg-white dark:bg-gray-800",
  },
  // linear: {
  //   name: "Linear",
  //   description: "Manage issues and projects",
  //   icon: "/integrations/linear.svg",
  //   bgColor: "bg-white dark:bg-gray-800",
  // },
  // github: {
  //   name: "GitHub",
  //   description: "Access repositories and PRs",
  //   icon: "/integrations/github.svg",
  //   bgColor: "bg-white dark:bg-gray-800",
  // },
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
  hubspot: {
    name: "HubSpot",
    description: "Manage CRM contacts, deals, and tickets",
    icon: "/integrations/hubspot.svg",
    bgColor: "bg-white dark:bg-gray-800",
  },
  linkedin: {
    name: "LinkedIn",
    description: "Send messages, manage connections, and post content",
    icon: "/integrations/linkedin.svg",
    bgColor: "bg-white dark:bg-gray-800",
  },
  salesforce: {
    name: "Salesforce",
    description: "Query and manage CRM records, opportunities, and contacts",
    icon: "/integrations/salesforce.svg",
    bgColor: "bg-white dark:bg-gray-800",
  },
  reddit: {
    name: "Reddit",
    description: "Browse, vote, comment, and post on Reddit",
    icon: "/integrations/reddit.svg",
    bgColor: "bg-white dark:bg-gray-800",
  },
  twitter: {
    name: "X (Twitter)",
    description: "Post tweets, manage followers, and search content",
    icon: "/integrations/twitter.svg",
    bgColor: "bg-white dark:bg-gray-800",
  },
  discord: {
    name: "Discord",
    description: "List guilds, channels, and send messages",
    icon: "/integrations/discord.svg",
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
  const linkLinkedIn = useLinkLinkedIn();
  const [connectingType, setConnectingType] = useState<string | null>(null);
  const [notification, setNotification] = useState<{
    type: "success" | "error";
    message: string;
  } | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [activeTab, setActiveTab] = useState<FilterTab>("all");
  const [expandedCard, setExpandedCard] = useState<string | null>(null);
  const linkedInLinkingRef = useRef(false);

  // Handle LinkedIn account_id from redirect (Unipile hosted auth)
  useEffect(() => {
    const accountId = searchParams.get("account_id");
    if (accountId && !linkedInLinkingRef.current) {
      linkedInLinkingRef.current = true;
      linkLinkedIn.mutateAsync(accountId)
        .then(() => {
          setNotification({
            type: "success",
            message: "LinkedIn connected successfully!",
          });
          refetch();
        })
        .catch((error) => {
          console.error("Failed to link LinkedIn:", error);
          setNotification({
            type: "error",
            message: "Failed to connect LinkedIn. Please try again.",
          });
        })
        .finally(() => {
          window.history.replaceState({}, "", "/integrations");
        });
    }
  }, [searchParams, linkLinkedIn, refetch]);

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
      window.history.replaceState({}, "", "/integrations");
      refetch();
    } else if (error) {
      setNotification({
        type: "error",
        message: `Failed to connect: ${error.replace(/_/g, " ")}`,
      });
      window.history.replaceState({}, "", "/integrations");
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

  // Filter integrations based on search and tab
  const filteredIntegrations = (Object.entries(integrationConfig) as [IntegrationType, (typeof integrationConfig)[IntegrationType]][]).filter(
    ([type, config]) => {
      const integration = connectedIntegrations.get(type);
      const matchesSearch = config.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        config.description.toLowerCase().includes(searchQuery.toLowerCase());

      if (!matchesSearch) return false;

      if (activeTab === "connected") return !!integration;
      if (activeTab === "not_connected") return !integration;
      return true;
    }
  );

  const tabs: { id: FilterTab; label: string; count: number }[] = [
    { id: "all", label: "All", count: Object.keys(integrationConfig).length },
    { id: "connected", label: "Connected", count: connectedIntegrations.size },
    { id: "not_connected", label: "Not Connected", count: Object.keys(integrationConfig).length - connectedIntegrations.size },
  ];

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

      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex gap-1 rounded-lg bg-muted p-1">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={cn(
                "rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
                activeTab === tab.id
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              {tab.label}
              <span className={cn(
                "ml-1.5 rounded-full px-1.5 py-0.5 text-xs",
                activeTab === tab.id
                  ? "bg-muted text-muted-foreground"
                  : "bg-muted-foreground/20 text-muted-foreground"
              )}>
                {tab.count}
              </span>
            </button>
          ))}
        </div>

        <div className="relative w-full sm:w-64">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search integrations..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9"
          />
        </div>
      </div>

      {isLoading ? (
        <div className="text-sm text-muted-foreground">
          Loading integrations...
        </div>
      ) : filteredIntegrations.length === 0 ? (
        <div className="py-8 text-center text-sm text-muted-foreground">
          {searchQuery
            ? "No integrations found matching your search."
            : activeTab === "connected"
              ? "No connected integrations yet."
              : "All integrations are connected."}
        </div>
      ) : (
        <div className="space-y-4">
          {filteredIntegrations.map(([type, config]) => {
            const integration = connectedIntegrations.get(type);
            const isConnecting = connectingType === type;
            const isExpanded = expandedCard === type;
            const actions = getIntegrationActions(type);

            return (
              <div
                key={type}
                className="rounded-lg border overflow-hidden"
              >
                <div
                  className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between sm:gap-4"
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
                    {actions.length > 0 && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={(e) => {
                          e.stopPropagation();
                          setExpandedCard(isExpanded ? null : type);
                        }}
                      >
                        {isExpanded ? "Hide" : "Show"} Capabilities
                        <ChevronDown
                          className={cn(
                            "ml-1 h-4 w-4 transition-transform duration-200",
                            isExpanded && "rotate-180"
                          )}
                        />
                      </Button>
                    )}
                    {integration ? (
                      <>
                        <label
                          className="flex cursor-pointer items-center gap-2"
                          onClick={(e) => e.stopPropagation()}
                        >
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
                          onClick={(e) => {
                            e.stopPropagation();
                            handleDisconnect(integration.id);
                          }}
                        >
                          Disconnect
                        </Button>
                      </>
                    ) : (
                      <Button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleConnect(type);
                        }}
                        disabled={isConnecting}
                      >
                        {isConnecting ? "Connecting..." : "Connect"}
                        <ExternalLink className="ml-2 h-4 w-4" />
                      </Button>
                    )}
                  </div>
                </div>

                {/* Expandable actions section */}
                <div
                  className={cn(
                    "grid transition-all duration-200 ease-in-out",
                    isExpanded ? "grid-rows-[1fr]" : "grid-rows-[0fr]"
                  )}
                >
                  <div className="overflow-hidden">
                    {actions.length > 0 && (
                      <div className="border-t px-4 py-3 bg-muted/30">
                        <p className="text-xs text-muted-foreground mb-2">Available actions:</p>
                        <div className="flex flex-wrap gap-2">
                          {actions.map((action) => (
                            <span
                              key={action.key}
                              className="bg-muted text-muted-foreground rounded-md px-2 py-1 text-xs"
                            >
                              {action.label}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
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
