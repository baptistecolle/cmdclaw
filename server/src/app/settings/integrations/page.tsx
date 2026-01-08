"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import {
  useIntegrationList,
  useGetAuthUrl,
  useToggleIntegration,
  useDisconnectIntegration,
} from "@/orpc/hooks";
import { Button } from "@/components/ui/button";
import { ExternalLink, CheckCircle2, XCircle, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

const GmailLogo = ({ className }: { className?: string }) => (
  <svg viewBox="0 0 24 24" className={className}>
    <path fill="#4285F4" d="M22 6v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2h16c1.1 0 2 .9 2 2z" />
    <path fill="#EA4335" d="M22 6l-10 7L2 6" />
    <path fill="#FBBC05" d="M2 6v12l8-6z" />
    <path fill="#34A853" d="M22 6v12l-8-6z" />
    <path fill="#C5221F" d="M22 6l-10 7L2 6h20z" />
  </svg>
);

const NotionLogo = ({ className }: { className?: string }) => (
  <svg viewBox="0 0 100 100" className={className}>
    <path
      d="M6.017 4.313l55.333-4.087c6.797-.583 8.543-.19 12.817 2.917l17.663 12.443c2.913 2.14 3.883 2.723 3.883 5.053v68.243c0 4.277-1.553 6.807-6.99 7.193L24.467 99.967c-4.08.193-6.023-.39-8.16-3.113L3.3 79.94c-2.333-3.113-3.3-5.443-3.3-8.167V11.113c0-3.497 1.553-6.413 6.017-6.8z"
      fill="#fff"
    />
    <path
      fillRule="evenodd"
      clipRule="evenodd"
      d="M61.35.227l-55.333 4.087C1.553 4.7 0 7.617 0 11.113v60.66c0 2.723.967 5.053 3.3 8.167l13.007 16.913c2.137 2.723 4.08 3.307 8.16 3.113l64.257-3.89c5.437-.387 6.99-2.917 6.99-7.193V20.64c0-2.21-.873-2.847-3.443-4.733L74.167 3.143c-4.273-3.107-6.02-3.5-12.817-2.917zM25.92 19.523c-5.247.353-6.437.436-9.417-1.99L8.927 11.507c-.77-.78-.383-1.753 1.557-1.947l53.193-3.887c4.467-.39 6.793 1.167 8.54 2.527l9.123 6.61c.39.197 1.36 1.36.193 1.36l-54.933 3.307-.68.047zM19.803 88.3V30.367c0-2.53.78-3.697 3.1-3.893L86 22.78c2.14-.193 3.107 1.167 3.107 3.693v57.547c0 2.53-.39 4.67-3.883 4.863l-60.377 3.5c-3.493.193-5.043-.97-5.043-4.083zm59.6-54.827c.387 1.75 0 3.5-1.75 3.7l-2.91.58v42.77c-2.527 1.36-4.853 2.137-6.797 2.137-3.107 0-3.883-.973-6.21-3.887l-19.03-29.94v28.967l6.02 1.363s0 3.5-4.857 3.5l-13.39.78c-.39-.78 0-2.723 1.357-3.11l3.497-.97v-38.3L30.48 40.667c-.39-1.75.58-4.277 3.3-4.473l14.357-.967 19.8 30.327v-26.83l-5.047-.58c-.39-2.143 1.163-3.7 3.103-3.89l13.41-.78z"
      fill="#000"
    />
  </svg>
);

const LinearLogo = ({ className }: { className?: string }) => (
  <svg viewBox="0 0 100 100" className={className}>
    <path
      d="M1.22 61.44c-.22-.64-.2-1.34.08-1.96l22.34-50.1c.53-1.18 1.88-1.73 3.08-1.25l46.94 18.85c.63.25 1.14.73 1.42 1.35l22.34 50.1c.53 1.18-.02 2.57-1.22 3.1l-46.94 21.12c-.62.28-1.34.28-1.96 0L1.22 61.44z"
      fill="#5E6AD2"
    />
  </svg>
);

const GitHubLogo = ({ className }: { className?: string }) => (
  <svg viewBox="0 0 98 96" className={className}>
    <path
      fillRule="evenodd"
      clipRule="evenodd"
      d="M48.854 0C21.839 0 0 22 0 49.217c0 21.756 13.993 40.172 33.405 46.69 2.427.49 3.316-1.059 3.316-2.362 0-1.141-.08-5.052-.08-9.127-13.59 2.934-16.42-5.867-16.42-5.867-2.184-5.704-5.42-7.17-5.42-7.17-4.448-3.015.324-3.015.324-3.015 4.934.326 7.523 5.052 7.523 5.052 4.367 7.496 11.404 5.378 14.235 4.074.404-3.178 1.699-5.378 3.074-6.6-10.839-1.141-22.243-5.378-22.243-24.283 0-5.378 1.94-9.778 5.014-13.2-.485-1.222-2.184-6.275.486-13.038 0 0 4.125-1.304 13.426 5.052a46.97 46.97 0 0 1 12.214-1.63c4.125 0 8.33.571 12.213 1.63 9.302-6.356 13.427-5.052 13.427-5.052 2.67 6.763.97 11.816.485 13.038 3.155 3.422 5.015 7.822 5.015 13.2 0 18.905-11.404 23.06-22.324 24.283 1.78 1.548 3.316 4.481 3.316 9.126 0 6.6-.08 11.897-.08 13.526 0 1.304.89 2.853 3.316 2.364 19.412-6.52 33.405-24.935 33.405-46.691C97.707 22 75.788 0 48.854 0z"
      fill="currentColor"
    />
  </svg>
);

const AirtableLogo = ({ className }: { className?: string }) => (
  <svg viewBox="0 0 200 170" className={className}>
    <path
      d="M90.039 12.368L24.079 39.66c-3.667 1.519-3.63 6.729.062 8.192l66.235 26.266a24.58 24.58 0 0 0 17.913 0l66.236-26.266c3.69-1.463 3.729-6.673.06-8.191l-65.958-27.293a24.58 24.58 0 0 0-18.588 0z"
      fill="#FFBF00"
    />
    <path
      d="M105.312 88.46v65.617c0 3.12 3.147 5.258 6.048 4.108l73.806-28.648a4.42 4.42 0 0 0 2.79-4.108V59.813c0-3.121-3.147-5.258-6.048-4.108l-73.806 28.648a4.42 4.42 0 0 0-2.79 4.108z"
      fill="#26B5F8"
    />
    <path
      d="M88.078 91.846l-21.904 10.576-2.224 1.075-46.238 22.155c-2.93 1.414-6.672-.722-6.672-3.978V60.088c0-1.178.604-2.195 1.414-2.96a5.09 5.09 0 0 1 1.469-.853c1.165-.49 2.605-.48 3.752.09l67.885 33.005c.604.292 1.09.792 1.36 1.36.722 1.414.143 3.074-1.262 3.674a3.03 3.03 0 0 1-.58.24z"
      fill="#ED3049"
    />
    <path
      d="M88.078 91.846l-21.904 10.576-53.72-27.9a5.09 5.09 0 0 1 1.469-.852c1.165-.49 2.605-.48 3.752.09l67.885 33.004c.604.292 1.09.792 1.36 1.36-1.09-.376-1.467-.907-.842 1.722z"
      fillOpacity=".25"
    />
  </svg>
);

const SlackLogo = ({ className }: { className?: string }) => (
  <svg viewBox="0 0 127 127" className={className}>
    <path
      d="M27.2 80c0 7.3-5.9 13.2-13.2 13.2C6.7 93.2.8 87.3.8 80c0-7.3 5.9-13.2 13.2-13.2h13.2V80zm6.6 0c0-7.3 5.9-13.2 13.2-13.2 7.3 0 13.2 5.9 13.2 13.2v33c0 7.3-5.9 13.2-13.2 13.2-7.3 0-13.2-5.9-13.2-13.2V80z"
      fill="#E01E5A"
    />
    <path
      d="M47 27c-7.3 0-13.2-5.9-13.2-13.2C33.8 6.5 39.7.6 47 .6c7.3 0 13.2 5.9 13.2 13.2V27H47zm0 6.7c7.3 0 13.2 5.9 13.2 13.2 0 7.3-5.9 13.2-13.2 13.2H13.9C6.6 60.1.7 54.2.7 46.9c0-7.3 5.9-13.2 13.2-13.2H47z"
      fill="#36C5F0"
    />
    <path
      d="M99.9 46.9c0-7.3 5.9-13.2 13.2-13.2 7.3 0 13.2 5.9 13.2 13.2 0 7.3-5.9 13.2-13.2 13.2H99.9V46.9zm-6.6 0c0 7.3-5.9 13.2-13.2 13.2-7.3 0-13.2-5.9-13.2-13.2V13.8C66.9 6.5 72.8.6 80.1.6c7.3 0 13.2 5.9 13.2 13.2v33.1z"
      fill="#2EB67D"
    />
    <path
      d="M80.1 99.8c7.3 0 13.2 5.9 13.2 13.2 0 7.3-5.9 13.2-13.2 13.2-7.3 0-13.2-5.9-13.2-13.2V99.8h13.2zm0-6.6c-7.3 0-13.2-5.9-13.2-13.2 0-7.3 5.9-13.2 13.2-13.2h33.1c7.3 0 13.2 5.9 13.2 13.2 0 7.3-5.9 13.2-13.2 13.2H80.1z"
      fill="#ECB22E"
    />
  </svg>
);

const integrationConfig = {
  gmail: {
    name: "Gmail",
    description: "Read and send emails",
    icon: GmailLogo,
    bgColor: "bg-white dark:bg-gray-800",
  },
  notion: {
    name: "Notion",
    description: "Search and create pages",
    icon: NotionLogo,
    bgColor: "bg-white dark:bg-gray-800",
  },
  linear: {
    name: "Linear",
    description: "Manage issues and projects",
    icon: LinearLogo,
    bgColor: "bg-white dark:bg-gray-800",
  },
  github: {
    name: "GitHub",
    description: "Access repositories and PRs",
    icon: GitHubLogo,
    bgColor: "bg-white dark:bg-gray-800",
  },
  airtable: {
    name: "Airtable",
    description: "Read and update bases",
    icon: AirtableLogo,
    bgColor: "bg-white dark:bg-gray-800",
  },
  slack: {
    name: "Slack",
    description: "Send messages and read channels",
    icon: SlackLogo,
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
          {Object.entries(integrationConfig).map(([type, config]) => {
            const integration = connectedIntegrations.get(type);
            const Icon = config.icon;
            const isConnecting = connectingType === type;

            return (
              <div
                key={type}
                className="flex items-center justify-between rounded-lg border p-4"
              >
                <div className="flex items-center gap-4">
                  <div
                    className={cn(
                      "flex items-center justify-center rounded-lg p-2 shadow-sm border",
                      config.bgColor
                    )}
                  >
                    <Icon className="h-6 w-6" />
                  </div>
                  <div>
                    <h3 className="font-medium">{config.name}</h3>
                    {integration ? (
                      <p className="text-sm text-muted-foreground">
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

                <div className="flex items-center gap-2">
                  {integration ? (
                    <>
                      <label className="flex cursor-pointer items-center gap-2">
                        <input
                          type="checkbox"
                          checked={integration.enabled}
                          onChange={(e) =>
                            handleToggle(integration.id, e.target.checked)
                          }
                          className="h-4 w-4 rounded border-gray-300"
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
