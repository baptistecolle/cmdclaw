"use client";

import { useQueryClient } from "@tanstack/react-query";
import { Loader2, CheckCircle2, XCircle, ExternalLink } from "lucide-react";
import Image from "next/image";
import { useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  useProviderAuthStatus,
  useConnectProvider,
  useDisconnectProvider,
  usePollProviderConnection,
} from "@/orpc/hooks";

type ProviderID = "openai";
type ProviderAuthType = "oauth";
type DeviceFlowState = {
  provider: "openai";
  flowId: string;
  userCode: string;
  verificationUri: string;
  verificationUriComplete: string;
  interval: number;
  expiresAt: number;
};

const PROVIDER_LABELS: Record<ProviderID, string> = {
  openai: "ChatGPT",
};

const getProviderLabel = (provider: ProviderID | string) =>
  PROVIDER_LABELS[provider as ProviderID] ?? provider;

const PROVIDERS: {
  id: ProviderID;
  authType: ProviderAuthType;
  name: string;
  description: string;
  logoUrl: string;
  logoAlt: string;
  logoClassName?: string;
  models: string[];
}[] = [
  {
    id: "openai",
    authType: "oauth",
    name: "ChatGPT",
    description: "Use your ChatGPT Plus/Pro/Max subscription",
    logoUrl: "/integrations/openai.svg",
    logoAlt: "OpenAI logo",
    logoClassName: "dark:invert",
    models: [
      "GPT-5.1 Codex Max",
      "GPT-5.1 Codex Mini",
      "GPT-5.2",
      "GPT-5.2 Codex",
      "GPT-5.1 Codex",
    ],
  },
];

function SearchParamsHandler({
  onNotification,
}: {
  onNotification: (notification: { type: "success" | "error"; message: string }) => void;
}) {
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();

  useEffect(() => {
    const connected = searchParams.get("provider_connected");
    const error = searchParams.get("provider_error");

    if (connected) {
      onNotification({
        type: "success",
        message: `${getProviderLabel(connected)} connected successfully!`,
      });
      queryClient.invalidateQueries({ queryKey: ["providerAuth"] });
      window.history.replaceState({}, "", "/settings/subscriptions");
    } else if (error) {
      onNotification({
        type: "error",
        message: `Connection failed: ${error.replace(/_/g, " ")}`,
      });
      window.history.replaceState({}, "", "/settings/subscriptions");
    }
  }, [searchParams, queryClient, onNotification]);

  return null;
}

function ProviderConnectButton({
  providerId,
  isConnected,
  isConnecting,
  isDisconnecting,
  onConnect,
  onDisconnect,
}: {
  providerId: ProviderID;
  isConnected: boolean;
  isConnecting: boolean;
  isDisconnecting: boolean;
  onConnect: (provider: ProviderID) => Promise<void>;
  onDisconnect: (provider: ProviderID) => Promise<void>;
}) {
  const handleConnectClick = useCallback(() => {
    void onConnect(providerId);
  }, [onConnect, providerId]);

  const handleDisconnectClick = useCallback(() => {
    void onDisconnect(providerId);
  }, [onDisconnect, providerId]);

  if (isConnected) {
    return (
      <Button
        variant="outline"
        size="sm"
        onClick={handleDisconnectClick}
        disabled={isDisconnecting}
      >
        {isDisconnecting ? <Loader2 className="mr-2 h-3 w-3 animate-spin" /> : null}
        Disconnect
      </Button>
    );
  }

  return (
    <Button size="sm" onClick={handleConnectClick} disabled={isConnecting}>
      {isConnecting ? (
        <Loader2 className="mr-2 h-3 w-3 animate-spin" />
      ) : (
        <ExternalLink className="mr-2 h-3 w-3" />
      )}
      Connect
    </Button>
  );
}

export default function SubscriptionsPage() {
  const { data, isLoading, refetch } = useProviderAuthStatus();
  const connectProvider = useConnectProvider();
  const pollProvider = usePollProviderConnection();
  const disconnectProvider = useDisconnectProvider();
  const [connectingProvider, setConnectingProvider] = useState<ProviderID | null>(null);
  const [deviceFlow, setDeviceFlow] = useState<DeviceFlowState | null>(null);
  const [notification, setNotification] = useState<{
    type: "success" | "error";
    message: string;
  } | null>(null);

  const handleNotification = useCallback(
    (newNotification: { type: "success" | "error"; message: string }) => {
      setNotification(newNotification);
    },
    [],
  );

  // Auto-dismiss notifications
  useEffect(() => {
    if (notification) {
      const timer = setTimeout(() => setNotification(null), 5000);
      return () => clearTimeout(timer);
    }
  }, [notification]);

  useEffect(() => {
    if (!deviceFlow) {
      return;
    }

    if (Date.now() >= deviceFlow.expiresAt) {
      setNotification({
        type: "error",
        message: "Device code expired. Please reconnect to generate a new code.",
      });
      setDeviceFlow(null);
      setConnectingProvider(null);
      return;
    }

    const timeout = setTimeout(() => {
      void (async () => {
        try {
          const result = await pollProvider.mutateAsync({
            provider: deviceFlow.provider,
            flowId: deviceFlow.flowId,
          });

          if (result.status === "connected") {
            await refetch();
            setNotification({
              type: "success",
              message: `${getProviderLabel(deviceFlow.provider)} connected successfully!`,
            });
            setDeviceFlow(null);
            setConnectingProvider(null);
            return;
          }

          if (result.status === "failed") {
            setNotification({
              type: "error",
              message: `Connection failed: ${result.error.replace(/_/g, " ")}`,
            });
            setDeviceFlow(null);
            setConnectingProvider(null);
            return;
          }

          if (result.status === "pending" && result.interval) {
            setDeviceFlow((prev) => (prev ? { ...prev, interval: result.interval } : prev));
          }
        } catch (error) {
          console.error("Failed polling provider auth:", error);
        }
      })();
    }, deviceFlow.interval * 1000);

    return () => clearTimeout(timeout);
  }, [deviceFlow, pollProvider, refetch]);

  const handleConnect = useCallback(
    async (provider: ProviderID) => {
      setConnectingProvider(provider);

      try {
        const result = await connectProvider.mutateAsync(provider);

        if (result.mode === "device") {
          setDeviceFlow({
            provider,
            flowId: result.flowId,
            userCode: result.userCode,
            verificationUri: result.verificationUri,
            verificationUriComplete: result.verificationUriComplete,
            interval: result.interval,
            expiresAt: Date.now() + result.expiresIn * 1000,
          });
          return;
        }

        if (result.mode === "redirect") {
          window.location.href = result.authUrl;
          return;
        }

        setConnectingProvider(null);
      } catch (error) {
        console.error("Failed to start OAuth flow:", error);
        setNotification({
          type: "error",
          message: "Failed to start connection. Please try again.",
        });
        setConnectingProvider(null);
      }
    },
    [connectProvider],
  );

  const handleDisconnect = useCallback(
    async (provider: ProviderID) => {
      try {
        await disconnectProvider.mutateAsync(provider);
        setNotification({
          type: "success",
          message: `${getProviderLabel(provider)} disconnected.`,
        });
      } catch (error) {
        console.error("Failed to disconnect:", error);
        setNotification({
          type: "error",
          message: "Failed to disconnect. Please try again.",
        });
      }
    },
    [disconnectProvider],
  );

  const handleCopyDeviceCode = useCallback(() => {
    if (!deviceFlow) {
      return;
    }
    void navigator.clipboard.writeText(deviceFlow.userCode);
  }, [deviceFlow]);

  const handleCancelDeviceFlow = useCallback(() => {
    setDeviceFlow(null);
    setConnectingProvider(null);
  }, []);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="text-muted-foreground h-6 w-6 animate-spin" />
      </div>
    );
  }

  const connected = data?.connected ?? {};

  return (
    <div>
      <Suspense fallback={null}>
        <SearchParamsHandler onNotification={handleNotification} />
      </Suspense>
      <div className="mb-6">
        <h2 className="text-xl font-semibold">Subscriptions</h2>
        <p className="text-muted-foreground mt-1 text-sm">
          Connect your existing AI subscriptions to use additional models in cmdclaw.
        </p>
      </div>

      {notification && (
        <div
          className={cn(
            "mb-6 flex items-center gap-2 rounded-lg border p-3 text-sm",
            notification.type === "success"
              ? "border-green-500/50 bg-green-500/10 text-green-700 dark:text-green-400"
              : "border-red-500/50 bg-red-500/10 text-red-700 dark:text-red-400",
          )}
        >
          {notification.type === "success" ? (
            <CheckCircle2 className="h-4 w-4 shrink-0" />
          ) : (
            <XCircle className="h-4 w-4 shrink-0" />
          )}
          {notification.message}
        </div>
      )}

      {deviceFlow && (
        <div className="mb-6 rounded-lg border p-4">
          <p className="text-sm font-medium">ChatGPT Pro/Plus (Device Code)</p>
          <p className="text-muted-foreground mt-2 text-sm">
            Open the verification page and enter the code below.
          </p>
          <p className="mt-2 text-sm">Go to this link: {deviceFlow.verificationUri}</p>
          <div className="bg-muted mt-3 rounded-md px-3 py-2 font-mono text-lg tracking-wider">
            {deviceFlow.userCode}
          </div>
          <div className="mt-3 flex gap-2">
            <Button variant="outline" size="sm" onClick={handleCopyDeviceCode}>
              Copy code
            </Button>
            <Button variant="outline" size="sm" onClick={handleCancelDeviceFlow}>
              Cancel
            </Button>
            <div className="text-muted-foreground ml-auto flex items-center text-xs">
              <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
              Waiting for authorization...
            </div>
          </div>
        </div>
      )}

      <div className="space-y-4">
        {PROVIDERS.map((provider) => {
          const isConnected = provider.id in connected;
          const isConnecting = connectingProvider === provider.id;
          const isDisconnecting = disconnectProvider.isPending;

          return (
            <div key={provider.id} className="rounded-lg border p-5">
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <Image
                      src={provider.logoUrl}
                      alt={provider.logoAlt}
                      width={20}
                      height={20}
                      className={cn("h-5 w-auto shrink-0", provider.logoClassName)}
                    />
                    <h3 className="font-medium">{provider.name}</h3>
                    {isConnected && (
                      <span className="inline-flex items-center gap-1 rounded-full bg-green-500/10 px-2 py-0.5 text-xs font-medium text-green-700 dark:text-green-400">
                        <CheckCircle2 className="h-3 w-3" />
                        Connected
                      </span>
                    )}
                  </div>
                  <p className="text-muted-foreground mt-1 text-sm">{provider.description}</p>
                </div>

                <div className="shrink-0">
                  <ProviderConnectButton
                    providerId={provider.id}
                    isConnected={isConnected}
                    isConnecting={isConnecting}
                    isDisconnecting={isDisconnecting}
                    onConnect={handleConnect}
                    onDisconnect={handleDisconnect}
                  />
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <div className="border-muted bg-muted/30 mt-6 rounded-lg border p-4">
        <div className="flex items-start gap-2">
          <Image
            src="/integrations/anthropic.svg"
            alt="Anthropic logo"
            width={16}
            height={16}
            className="mt-0.5 h-4 w-auto shrink-0 dark:invert"
          />
          <p className="text-muted-foreground text-xs">
            Anthropic models (Claude) are always available through CmdClaw&apos;s platform.
            Connecting a subscription gives you access to additional models from that provider.
          </p>
        </div>
      </div>
    </div>
  );
}
