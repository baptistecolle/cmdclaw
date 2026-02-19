"use client";

import {
  ExternalLink,
  CheckCircle2,
  XCircle,
  Loader2,
  Search,
  ChevronDown,
  Plus,
  Trash2,
  Puzzle,
} from "lucide-react";
import Image from "next/image";
import { useSearchParams } from "next/navigation";
import { Suspense, useCallback, useRef } from "react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { useIsAdmin } from "@/hooks/use-is-admin";
import {
  isUnipileMissingCredentialsError,
  UNIPILE_MISSING_CREDENTIALS_MESSAGE,
} from "@/lib/integration-errors";
import { getIntegrationActions, isComingSoonIntegration } from "@/lib/integration-icons";
import { cn } from "@/lib/utils";
import {
  useIntegrationList,
  useGetAuthUrl,
  useToggleIntegration,
  useDisconnectIntegration,
  useLinkLinkedIn,
  useCustomIntegrationList,
  useCreateCustomIntegration,
  useDisconnectCustomIntegration,
  useToggleCustomIntegration,
  useDeleteCustomIntegration,
  useGetCustomAuthUrl,
} from "@/orpc/hooks";

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
  whatsapp: {
    name: "WhatsApp",
    description: "Link WhatsApp and pair the bridge with QR",
    icon: "/integrations/whatsapp.svg",
    bgColor: "bg-white dark:bg-gray-800",
  },
} as const;

const defaultCustomForm: CustomFormState = {
  slug: "",
  name: "",
  description: "",
  baseUrl: "",
  authType: "api_key",
  apiKey: "",
  clientId: "",
  clientSecret: "",
  authUrl: "",
  tokenUrl: "",
  scopes: "",
};

type IntegrationType = keyof typeof integrationConfig;
type OAuthIntegrationType = Exclude<IntegrationType, "whatsapp">;
const adminPreviewOnlyIntegrations = new Set<IntegrationType>(
  (Object.keys(integrationConfig) as IntegrationType[]).filter(
    (type) => type === "whatsapp" || isComingSoonIntegration(type as OAuthIntegrationType),
  ),
);
type CustomAuthType = "oauth2" | "api_key" | "bearer_token";
type CustomFormState = {
  slug: string;
  name: string;
  description: string;
  baseUrl: string;
  authType: CustomAuthType;
  apiKey: string;
  clientId: string;
  clientSecret: string;
  authUrl: string;
  tokenUrl: string;
  scopes: string;
};

function toErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }
  return fallback;
}

function IntegrationsPageFallback() {
  return (
    <div className="flex items-center justify-center py-12">
      <Loader2 className="h-6 w-6 animate-spin" />
    </div>
  );
}

const integrationsPageFallbackNode = <IntegrationsPageFallback />;

function IntegrationEnabledSwitch({
  integrationId,
  checked,
  onToggle,
}: {
  integrationId: string;
  checked: boolean;
  onToggle: (id: string, enabled: boolean) => Promise<void>;
}) {
  const handleCheckedChange = useCallback(
    (value: boolean) => {
      void onToggle(integrationId, value);
    },
    [integrationId, onToggle],
  );

  return <Switch checked={checked} onCheckedChange={handleCheckedChange} />;
}

function IntegrationDisconnectButton({
  integrationId,
  onDisconnect,
}: {
  integrationId: string;
  onDisconnect: (id: string) => Promise<void>;
}) {
  const handleClick = useCallback(() => {
    void onDisconnect(integrationId);
  }, [integrationId, onDisconnect]);

  return (
    <Button variant="ghost" size="sm" onClick={handleClick}>
      Disconnect
    </Button>
  );
}

function IntegrationConnectButton({
  integrationType,
  isConnecting,
  hasError,
  onConnect,
}: {
  integrationType: OAuthIntegrationType;
  isConnecting: boolean;
  hasError: boolean;
  onConnect: (type: OAuthIntegrationType) => Promise<void>;
}) {
  const handleClick = useCallback(() => {
    void onConnect(integrationType);
  }, [integrationType, onConnect]);

  return (
    <Button
      onClick={handleClick}
      disabled={isConnecting}
      variant={hasError ? "destructive" : "default"}
    >
      {isConnecting ? "Connecting..." : hasError ? "Retry" : "Connect"}
      <ExternalLink className="ml-2 h-4 w-4" />
    </Button>
  );
}

function CustomIntegrationEnabledSwitch({
  customIntegrationId,
  checked,
  onToggle,
}: {
  customIntegrationId: string;
  checked: boolean;
  onToggle: (customIntegrationId: string, enabled: boolean) => Promise<void>;
}) {
  const handleCheckedChange = useCallback(
    (value: boolean) => {
      void onToggle(customIntegrationId, value);
    },
    [customIntegrationId, onToggle],
  );

  return <Switch checked={checked} onCheckedChange={handleCheckedChange} />;
}

function CustomIntegrationDisconnectButton({
  customIntegrationId,
  onDisconnect,
}: {
  customIntegrationId: string;
  onDisconnect: (customIntegrationId: string) => Promise<void>;
}) {
  const handleClick = useCallback(() => {
    void onDisconnect(customIntegrationId);
  }, [customIntegrationId, onDisconnect]);

  return (
    <Button variant="ghost" size="sm" onClick={handleClick}>
      Disconnect
    </Button>
  );
}

function CustomIntegrationOAuthConnectButton({
  slug,
  onConnect,
}: {
  slug: string;
  onConnect: (slug: string) => Promise<void>;
}) {
  const handleClick = useCallback(() => {
    void onConnect(slug);
  }, [onConnect, slug]);

  return (
    <Button onClick={handleClick}>
      Connect <ExternalLink className="ml-2 h-4 w-4" />
    </Button>
  );
}

function CustomIntegrationDeleteButton({
  customIntegrationId,
  onDelete,
}: {
  customIntegrationId: string;
  onDelete: (customIntegrationId: string) => Promise<void>;
}) {
  const handleClick = useCallback(() => {
    void onDelete(customIntegrationId);
  }, [customIntegrationId, onDelete]);

  return (
    <Button variant="ghost" size="sm" onClick={handleClick}>
      <Trash2 className="text-destructive h-4 w-4" />
    </Button>
  );
}

function IntegrationsPageContent() {
  const { isAdmin } = useIsAdmin();
  const searchParams = useSearchParams();
  const { data: integrations, isLoading, refetch } = useIntegrationList();
  const { data: customIntegrations, refetch: refetchCustom } = useCustomIntegrationList();
  const getAuthUrl = useGetAuthUrl();
  const toggleIntegration = useToggleIntegration();
  const disconnectIntegration = useDisconnectIntegration();
  const linkLinkedIn = useLinkLinkedIn();
  const createCustom = useCreateCustomIntegration();
  const disconnectCustom = useDisconnectCustomIntegration();
  const toggleCustom = useToggleCustomIntegration();
  const deleteCustom = useDeleteCustomIntegration();
  const getCustomAuthUrl = useGetCustomAuthUrl();
  const [connectingType, setConnectingType] = useState<string | null>(null);
  const [integrationConnectErrors, setIntegrationConnectErrors] = useState<
    Partial<Record<OAuthIntegrationType, string>>
  >({});
  const [notification, setNotification] = useState<{
    type: "success" | "error";
    message: string;
  } | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [activeTab, setActiveTab] = useState<FilterTab>("all");
  const [expandedCard, setExpandedCard] = useState<string | null>(null);
  const linkedInLinkingRef = useRef(false);
  const [whatsAppBridgeStatus, setWhatsAppBridgeStatus] = useState<
    "disconnected" | "connecting" | "connected" | null
  >(null);
  const [showAddCustom, setShowAddCustom] = useState(false);
  const [customForm, setCustomForm] = useState<CustomFormState>(defaultCustomForm);

  // Handle LinkedIn account_id from redirect (Unipile hosted auth)
  useEffect(() => {
    const accountId = searchParams.get("account_id");
    if (accountId && !linkedInLinkingRef.current) {
      linkedInLinkingRef.current = true;
      linkLinkedIn
        .mutateAsync(accountId)
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
      queueMicrotask(() => {
        setNotification({
          type: "success",
          message: "Integration connected successfully!",
        });
      });
      // Clear the URL params
      window.history.replaceState({}, "", "/integrations");
      refetch();
    } else if (error) {
      queueMicrotask(() => {
        setNotification({
          type: "error",
          message: `Failed to connect: ${error.replace(/_/g, " ")}`,
        });
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

  const handleConnect = useCallback(
    async (type: OAuthIntegrationType) => {
      setConnectingType(type);
      setIntegrationConnectErrors((prev) => {
        const next = { ...prev };
        delete next[type];
        return next;
      });
      try {
        const result = await getAuthUrl.mutateAsync({
          type,
          redirectUrl: window.location.href,
        });
        window.location.assign(result.authUrl);
      } catch (error) {
        console.error("Failed to get auth URL:", error);
        setConnectingType(null);
        setIntegrationConnectErrors((prev) => ({
          ...prev,
          [type]: isUnipileMissingCredentialsError(error)
            ? UNIPILE_MISSING_CREDENTIALS_MESSAGE
            : "Failed to start connection. Please try again.",
        }));
      }
    },
    [getAuthUrl],
  );

  const handleToggle = useCallback(
    async (id: string, enabled: boolean) => {
      try {
        await toggleIntegration.mutateAsync({ id, enabled });
        refetch();
      } catch (error) {
        console.error("Failed to toggle integration:", error);
      }
    },
    [refetch, toggleIntegration],
  );

  const handleDisconnect = useCallback(
    async (id: string) => {
      try {
        await disconnectIntegration.mutateAsync(id);
        refetch();
      } catch (error) {
        console.error("Failed to disconnect integration:", error);
      }
    },
    [disconnectIntegration, refetch],
  );

  const handleToggleCustom = useCallback(
    async (customIntegrationId: string, enabled: boolean) => {
      await toggleCustom.mutateAsync({ customIntegrationId, enabled });
      await refetchCustom();
    },
    [refetchCustom, toggleCustom],
  );

  const handleDisconnectCustom = useCallback(
    async (customIntegrationId: string) => {
      await disconnectCustom.mutateAsync(customIntegrationId);
      await refetchCustom();
    },
    [disconnectCustom, refetchCustom],
  );

  const handleConnectCustomOAuth = useCallback(
    async (slug: string) => {
      try {
        const result = await getCustomAuthUrl.mutateAsync({
          slug,
          redirectUrl: window.location.href,
        });
        window.location.assign(result.authUrl);
      } catch {
        setNotification({
          type: "error",
          message: "Failed to start OAuth flow",
        });
      }
    },
    [getCustomAuthUrl],
  );

  const handleDeleteCustom = useCallback(
    async (customIntegrationId: string) => {
      await deleteCustom.mutateAsync(customIntegrationId);
      await refetchCustom();
    },
    [deleteCustom, refetchCustom],
  );

  useEffect(() => {
    let active = true;

    const loadWhatsAppStatus = async () => {
      try {
        const res = await fetch("/api/whatsapp/status");
        if (!res.ok) {
          if (res.status === 403 && active) {
            setWhatsAppBridgeStatus(null);
          }
          return;
        }
        const data = (await res.json()) as {
          status: "disconnected" | "connecting" | "connected";
        };
        if (active) {
          setWhatsAppBridgeStatus(data.status);
        }
      } catch {
        if (active) {
          setWhatsAppBridgeStatus(null);
        }
      }
    };

    loadWhatsAppStatus();
    const interval = setInterval(loadWhatsAppStatus, 5000);
    return () => {
      active = false;
      clearInterval(interval);
    };
  }, []);

  const integrationsList = Array.isArray(integrations) ? integrations : [];
  const connectedIntegrations = new Map<string, (typeof integrationsList)[number]>(
    integrationsList.map((i) => [i.type, i]),
  );

  const visibleIntegrations = (
    Object.entries(integrationConfig) as [
      IntegrationType,
      (typeof integrationConfig)[IntegrationType],
    ][]
  ).filter(([type]) => isAdmin || !adminPreviewOnlyIntegrations.has(type));

  // Filter integrations based on search and tab
  const filteredIntegrations = visibleIntegrations.filter(([type, config]) => {
    const integration = connectedIntegrations.get(type);
    const isWhatsAppConnected = type === "whatsapp" && whatsAppBridgeStatus === "connected";
    const matchesSearch =
      config.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      config.description.toLowerCase().includes(searchQuery.toLowerCase());

    if (!matchesSearch) {
      return false;
    }

    if (activeTab === "connected") {
      return !!integration || isWhatsAppConnected;
    }
    if (activeTab === "not_connected") {
      return !integration && !isWhatsAppConnected;
    }
    return true;
  });

  const connectedCount = visibleIntegrations.reduce((count, [type]) => {
    const integration = connectedIntegrations.get(type);
    const isWhatsAppConnected = type === "whatsapp" && whatsAppBridgeStatus === "connected";
    return count + (integration || isWhatsAppConnected ? 1 : 0);
  }, 0);

  const totalVisibleIntegrations = visibleIntegrations.length;

  const tabs: { id: FilterTab; label: string; count: number }[] = [
    { id: "all", label: "All", count: totalVisibleIntegrations },
    { id: "connected", label: "Connected", count: connectedCount },
    {
      id: "not_connected",
      label: "Not Connected",
      count: totalVisibleIntegrations - connectedCount,
    },
  ];

  const handleTabClick = useCallback((event: React.MouseEvent<HTMLButtonElement>) => {
    const nextTab = event.currentTarget.dataset.tab as FilterTab | undefined;
    if (nextTab) {
      setActiveTab(nextTab);
    }
  }, []);

  const handleSearchQueryChange = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    setSearchQuery(event.target.value);
  }, []);

  const handleStopPropagation = useCallback((event: React.MouseEvent) => {
    event.stopPropagation();
  }, []);

  const handleToggleExpandedCard = useCallback((event: React.MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    const type = event.currentTarget.dataset.integrationType;
    if (!type) {
      return;
    }
    setExpandedCard((current) => (current === type ? null : type));
  }, []);

  const handleOpenWhatsAppIntegration = useCallback(
    (event: React.MouseEvent<HTMLButtonElement>) => {
      event.stopPropagation();
      window.location.assign("/integrations/whatsapp");
    },
    [],
  );

  const handleShowAddCustom = useCallback(() => {
    setShowAddCustom(true);
  }, []);

  const handleHideAddCustom = useCallback(() => {
    setShowAddCustom(false);
  }, []);

  const handleDialogContentClick = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    event.stopPropagation();
  }, []);

  const handleCustomSlugChange = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const slug = event.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "");
    setCustomForm((prev) => ({ ...prev, slug }));
  }, []);

  const handleCustomNameChange = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    setCustomForm((prev) => ({ ...prev, name: event.target.value }));
  }, []);

  const handleCustomDescriptionChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      setCustomForm((prev) => ({ ...prev, description: event.target.value }));
    },
    [],
  );

  const handleCustomBaseUrlChange = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    setCustomForm((prev) => ({ ...prev, baseUrl: event.target.value }));
  }, []);

  const handleCustomAuthTypeChange = useCallback((event: React.ChangeEvent<HTMLSelectElement>) => {
    setCustomForm((prev) => ({ ...prev, authType: event.target.value as CustomAuthType }));
  }, []);

  const handleCustomApiKeyChange = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    setCustomForm((prev) => ({ ...prev, apiKey: event.target.value }));
  }, []);

  const handleCustomClientIdChange = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    setCustomForm((prev) => ({ ...prev, clientId: event.target.value }));
  }, []);

  const handleCustomClientSecretChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      setCustomForm((prev) => ({ ...prev, clientSecret: event.target.value }));
    },
    [],
  );

  const handleCustomAuthUrlChange = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    setCustomForm((prev) => ({ ...prev, authUrl: event.target.value }));
  }, []);

  const handleCustomTokenUrlChange = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    setCustomForm((prev) => ({ ...prev, tokenUrl: event.target.value }));
  }, []);

  const handleCustomScopesChange = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    setCustomForm((prev) => ({ ...prev, scopes: event.target.value }));
  }, []);

  const handleCreateCustomIntegration = useCallback(async () => {
    try {
      await createCustom.mutateAsync({
        slug: customForm.slug,
        name: customForm.name,
        description: customForm.description || customForm.name,
        baseUrl: customForm.baseUrl,
        authType: customForm.authType,
        oauthConfig:
          customForm.authType === "oauth2"
            ? {
                authUrl: customForm.authUrl,
                tokenUrl: customForm.tokenUrl,
                scopes: customForm.scopes
                  .split(",")
                  .map((s) => s.trim())
                  .filter(Boolean),
              }
            : null,
        apiKeyConfig:
          customForm.authType === "api_key"
            ? {
                method: "header" as const,
                headerName: "Authorization",
              }
            : null,
        clientId: customForm.clientId || null,
        clientSecret: customForm.clientSecret || null,
        apiKey: customForm.apiKey || null,
      });
      setShowAddCustom(false);
      setCustomForm(defaultCustomForm);
      refetchCustom();
      setNotification({
        type: "success",
        message: "Custom integration created!",
      });
    } catch (error: unknown) {
      setNotification({
        type: "error",
        message: toErrorMessage(error, "Failed to create integration"),
      });
    }
  }, [createCustom, customForm, refetchCustom]);

  return (
    <div>
      <div className="mb-6">
        <h2 className="text-xl font-semibold">Integrations</h2>
        <p className="text-muted-foreground mt-1 text-sm">
          Connect your accounts to let the AI assistant help you with tasks.
        </p>
      </div>

      {notification && (
        <div
          className={cn(
            "mb-6 flex items-center gap-2 rounded-lg border p-4",
            notification.type === "success"
              ? "border-green-500/50 bg-green-500/10 text-green-700 dark:text-green-400"
              : "border-red-500/50 bg-red-500/10 text-red-700 dark:text-red-400",
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
        <div className="bg-muted grid w-full grid-cols-3 gap-1 rounded-lg p-1 sm:flex sm:w-fit">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              data-tab={tab.id}
              onClick={handleTabClick}
              className={cn(
                "min-w-0 rounded-md px-2 py-1.5 text-[11px] font-medium transition-colors sm:px-3 sm:text-sm",
                activeTab === tab.id
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {tab.label}
              <span
                className={cn(
                  "ml-1 rounded-full px-1.5 py-0.5 text-[10px] sm:ml-1.5 sm:text-xs",
                  activeTab === tab.id
                    ? "bg-muted text-muted-foreground"
                    : "bg-muted-foreground/20 text-muted-foreground",
                )}
              >
                {tab.count}
              </span>
            </button>
          ))}
        </div>

        <div className="relative w-full sm:w-64">
          <Search className="text-muted-foreground absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2" />
          <Input
            placeholder="Search integrations..."
            value={searchQuery}
            onChange={handleSearchQueryChange}
            className="pl-9"
          />
        </div>
      </div>

      {isLoading ? (
        <div className="text-muted-foreground text-sm">Loading integrations...</div>
      ) : filteredIntegrations.length === 0 ? (
        <div className="text-muted-foreground py-8 text-center text-sm">
          {searchQuery
            ? "No integrations found matching your search."
            : activeTab === "connected"
              ? "No connected integrations yet."
              : "All integrations are connected."}
        </div>
      ) : (
        <div className="space-y-4">
          {filteredIntegrations.map(([type, config]) => {
            const isPreviewOnly = adminPreviewOnlyIntegrations.has(type);
            const integration = connectedIntegrations.get(type);
            const isConnecting = connectingType === type;
            const isExpanded = expandedCard === type;
            const isWhatsApp = type === "whatsapp";
            const isWhatsAppConnected = isWhatsApp && whatsAppBridgeStatus === "connected";
            const actions = isWhatsApp ? [] : getIntegrationActions(type);
            const connectError = !integration
              ? integrationConnectErrors[type as OAuthIntegrationType]
              : undefined;

            return (
              <div key={type} className="relative overflow-hidden rounded-lg border">
                {isPreviewOnly && (
                  <span className="bg-muted text-muted-foreground absolute top-2 right-2 z-10 rounded-full border px-2 py-0.5 text-[10px] font-semibold tracking-wide uppercase">
                    Coming soon
                  </span>
                )}
                {connectError && (
                  <div className="flex items-center gap-2 border-b border-red-500/30 bg-red-500/10 px-4 py-2 text-sm text-red-700 dark:text-red-400">
                    <XCircle className="h-4 w-4 shrink-0" />
                    {connectError}
                  </div>
                )}
                <div className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
                  <div className="flex min-w-0 items-center gap-3 sm:gap-4">
                    <div
                      className={cn(
                        "flex shrink-0 items-center justify-center rounded-lg p-2 shadow-sm border",
                        config.bgColor,
                      )}
                    >
                      <Image
                        src={config.icon}
                        alt={config.name}
                        width={24}
                        height={24}
                        className="h-6 w-auto"
                      />
                    </div>
                    <div className="min-w-0">
                      <h3 className="font-medium">{config.name}</h3>
                      {integration ? (
                        <p className="text-muted-foreground truncate text-sm">
                          Connected as{" "}
                          <span className="font-medium">{integration.displayName}</span>
                        </p>
                      ) : isWhatsAppConnected ? (
                        <p className="text-muted-foreground text-sm">
                          Bridge is connected. Open to manage QR/linking.
                        </p>
                      ) : (
                        <p className="text-muted-foreground text-sm">{config.description}</p>
                      )}
                    </div>
                  </div>

                  <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto sm:justify-end">
                    {actions.length > 0 && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="w-full justify-between sm:w-auto"
                        data-integration-type={type}
                        onClick={handleToggleExpandedCard}
                      >
                        {isExpanded ? "Hide" : "Show"} Capabilities
                        <ChevronDown
                          className={cn(
                            "ml-1 h-4 w-4 transition-transform duration-200",
                            isExpanded && "rotate-180",
                          )}
                        />
                      </Button>
                    )}
                    {isWhatsApp ? (
                      <Button className="w-full sm:w-auto" onClick={handleOpenWhatsAppIntegration}>
                        {isWhatsAppConnected ? "Manage" : "Connect"}
                        <ExternalLink className="ml-2 h-4 w-4" />
                      </Button>
                    ) : integration ? (
                      <>
                        <label
                          className="flex cursor-pointer items-center gap-2 whitespace-nowrap"
                          onClick={handleStopPropagation}
                        >
                          <IntegrationEnabledSwitch
                            checked={integration.enabled}
                            integrationId={integration.id}
                            onToggle={handleToggle}
                          />
                          <span className="inline-block w-8 text-sm">
                            {integration.enabled ? "On" : "Off"}
                          </span>
                        </label>
                        <IntegrationDisconnectButton
                          integrationId={integration.id}
                          onDisconnect={handleDisconnect}
                        />
                      </>
                    ) : (
                      <IntegrationConnectButton
                        integrationType={type as OAuthIntegrationType}
                        isConnecting={isConnecting}
                        hasError={Boolean(connectError)}
                        onConnect={handleConnect}
                      />
                    )}
                  </div>
                </div>

                {/* Expandable actions section */}
                <div
                  className={cn(
                    "grid transition-all duration-200 ease-in-out",
                    isExpanded ? "grid-rows-[1fr]" : "grid-rows-[0fr]",
                  )}
                >
                  <div className="overflow-hidden">
                    {actions.length > 0 && (
                      <div className="bg-muted/30 border-t px-4 py-3">
                        <p className="text-muted-foreground mb-2 text-xs">Available actions:</p>
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

      {/* Custom Integrations Section */}
      <div className="mt-10">
        <div className="mb-4 flex items-center justify-between">
          <div>
            <h2 className="text-xl font-semibold">Custom Integrations</h2>
            <p className="text-muted-foreground mt-1 text-sm">
              Add your own API integrations with custom credentials.
            </p>
          </div>
          <Button onClick={handleShowAddCustom}>
            <Plus className="mr-2 h-4 w-4" />
            Add Custom
          </Button>
        </div>

        {customIntegrations && customIntegrations.length > 0 ? (
          <div className="space-y-4">
            {customIntegrations.map((ci) => (
              <div key={ci.id} className="overflow-hidden rounded-lg border">
                <div className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
                  <div className="flex min-w-0 items-center gap-3 sm:gap-4">
                    <div className="flex shrink-0 items-center justify-center rounded-lg border bg-white p-2 shadow-sm dark:bg-gray-800">
                      {ci.iconUrl ? (
                        <Image src={ci.iconUrl} alt={ci.name} width={24} height={24} />
                      ) : (
                        <Puzzle className="h-6 w-6 text-indigo-500" />
                      )}
                    </div>
                    <div className="min-w-0">
                      <h3 className="font-medium">{ci.name}</h3>
                      <p className="text-muted-foreground text-sm">
                        {ci.connected ? (
                          <>
                            Connected
                            {ci.displayName ? ` as ${ci.displayName}` : ""}
                          </>
                        ) : (
                          ci.description
                        )}
                      </p>
                      {ci.communityStatus && (
                        <span
                          className={cn(
                            "mt-1 inline-block rounded-full px-2 py-0.5 text-xs",
                            ci.communityStatus === "approved"
                              ? "bg-green-100 text-green-700"
                              : ci.communityStatus === "pending"
                                ? "bg-yellow-100 text-yellow-700"
                                : "bg-red-100 text-red-700",
                          )}
                        >
                          Community: {ci.communityStatus}
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto sm:justify-end">
                    {ci.connected ? (
                      <>
                        <label className="flex cursor-pointer items-center gap-2 whitespace-nowrap">
                          <CustomIntegrationEnabledSwitch
                            checked={ci.enabled}
                            customIntegrationId={ci.id}
                            onToggle={handleToggleCustom}
                          />
                          <span className="inline-block w-8 text-sm">
                            {ci.enabled ? "On" : "Off"}
                          </span>
                        </label>
                        <CustomIntegrationDisconnectButton
                          customIntegrationId={ci.id}
                          onDisconnect={handleDisconnectCustom}
                        />
                      </>
                    ) : ci.authType === "oauth2" ? (
                      <CustomIntegrationOAuthConnectButton
                        slug={ci.slug}
                        onConnect={handleConnectCustomOAuth}
                      />
                    ) : (
                      <span className="text-muted-foreground text-xs">Credentials saved</span>
                    )}
                    {!ci.isBuiltIn && (
                      <CustomIntegrationDeleteButton
                        customIntegrationId={ci.id}
                        onDelete={handleDeleteCustom}
                      />
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="text-muted-foreground py-8 text-center text-sm">
            No custom integrations yet. Click &quot;Add Custom&quot; to create one.
          </div>
        )}
      </div>

      {/* Add Custom Integration Dialog */}
      {showAddCustom && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
          onClick={handleHideAddCustom}
        >
          <div
            className="bg-background w-full max-w-lg rounded-lg p-6 shadow-xl"
            onClick={handleDialogContentClick}
          >
            <h3 className="mb-4 text-lg font-semibold">Add Custom Integration</h3>
            <div className="max-h-[60vh] space-y-3 overflow-y-auto">
              <div>
                <label className="text-sm font-medium">Slug</label>
                <Input
                  placeholder="e.g. trello"
                  value={customForm.slug}
                  onChange={handleCustomSlugChange}
                />
              </div>
              <div>
                <label className="text-sm font-medium">Name</label>
                <Input
                  placeholder="e.g. Trello"
                  value={customForm.name}
                  onChange={handleCustomNameChange}
                />
              </div>
              <div>
                <label className="text-sm font-medium">Description</label>
                <Input
                  placeholder="What does this integration do?"
                  value={customForm.description}
                  onChange={handleCustomDescriptionChange}
                />
              </div>
              <div>
                <label className="text-sm font-medium">Base URL</label>
                <Input
                  placeholder="https://api.example.com"
                  value={customForm.baseUrl}
                  onChange={handleCustomBaseUrlChange}
                />
              </div>
              <div>
                <label className="text-sm font-medium">Auth Type</label>
                <select
                  className="bg-background w-full rounded-md border px-3 py-2 text-sm"
                  value={customForm.authType}
                  onChange={handleCustomAuthTypeChange}
                >
                  <option value="api_key">API Key</option>
                  <option value="bearer_token">Bearer Token</option>
                  <option value="oauth2">OAuth 2.0</option>
                </select>
              </div>

              {customForm.authType === "api_key" && (
                <div>
                  <label className="text-sm font-medium">API Key</label>
                  <Input
                    type="password"
                    placeholder="Your API key"
                    value={customForm.apiKey}
                    onChange={handleCustomApiKeyChange}
                  />
                </div>
              )}

              {customForm.authType === "bearer_token" && (
                <div>
                  <label className="text-sm font-medium">Bearer Token</label>
                  <Input
                    type="password"
                    placeholder="Your bearer token"
                    value={customForm.apiKey}
                    onChange={handleCustomApiKeyChange}
                  />
                </div>
              )}

              {customForm.authType === "oauth2" && (
                <>
                  <div>
                    <label className="text-sm font-medium">Client ID</label>
                    <Input value={customForm.clientId} onChange={handleCustomClientIdChange} />
                  </div>
                  <div>
                    <label className="text-sm font-medium">Client Secret</label>
                    <Input
                      type="password"
                      value={customForm.clientSecret}
                      onChange={handleCustomClientSecretChange}
                    />
                  </div>
                  <div>
                    <label className="text-sm font-medium">Auth URL</label>
                    <Input
                      placeholder="https://example.com/oauth/authorize"
                      value={customForm.authUrl}
                      onChange={handleCustomAuthUrlChange}
                    />
                  </div>
                  <div>
                    <label className="text-sm font-medium">Token URL</label>
                    <Input
                      placeholder="https://example.com/oauth/token"
                      value={customForm.tokenUrl}
                      onChange={handleCustomTokenUrlChange}
                    />
                  </div>
                  <div>
                    <label className="text-sm font-medium">Scopes (comma-separated)</label>
                    <Input
                      placeholder="read,write"
                      value={customForm.scopes}
                      onChange={handleCustomScopesChange}
                    />
                  </div>
                </>
              )}
            </div>

            <div className="mt-4 flex justify-end gap-2">
              <Button variant="ghost" onClick={handleHideAddCustom}>
                Cancel
              </Button>
              <Button
                disabled={!customForm.slug || !customForm.name || !customForm.baseUrl}
                onClick={handleCreateCustomIntegration}
              >
                Create
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function IntegrationsPage() {
  return (
    <Suspense fallback={integrationsPageFallbackNode}>
      <IntegrationsPageContent />
    </Suspense>
  );
}
