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
  useSetProviderApiKey,
} from "@/orpc/hooks";

type ProviderID = "openai" | "google" | "kimi";
type ProviderAuthType = "oauth" | "api_key";

const PROVIDER_LABELS: Record<ProviderID, string> = {
  openai: "ChatGPT",
  google: "Gemini",
  kimi: "Kimi",
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
  apiKeyHelp?: string;
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
  {
    id: "google",
    authType: "oauth",
    name: "Gemini",
    description: "Use your Google AI Pro/Ultra subscription",
    logoUrl: "/integrations/gemini.svg",
    logoAlt: "Google Gemini logo",
    models: ["Gemini 2.5 Pro", "Gemini 2.5 Flash"],
  },
  {
    id: "kimi",
    authType: "api_key",
    name: "Kimi",
    description: "Use your Kimi for Coding subscription",
    logoUrl: "/integrations/kimi.svg",
    logoAlt: "Kimi logo",
    models: ["Kimi K2.5", "Kimi K2 Thinking"],
    apiKeyHelp: "Paste your KIMI_API_KEY from Kimi for Coding.",
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
  const { data, isLoading } = useProviderAuthStatus();
  const connectProvider = useConnectProvider();
  const disconnectProvider = useDisconnectProvider();
  const setProviderApiKey = useSetProviderApiKey();
  const [connectingProvider, setConnectingProvider] = useState<ProviderID | null>(null);
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

  const handleConnect = useCallback(async (provider: ProviderID) => {
    setConnectingProvider(provider);

    if (provider === "kimi") {
      const apiKey = window.prompt("Paste your KIMI_API_KEY");
      if (!apiKey?.trim()) {
        setConnectingProvider(null);
        return;
      }

      try {
        await setProviderApiKey.mutateAsync({
          provider: "kimi",
          apiKey: apiKey.trim(),
        });
        setNotification({
          type: "success",
          message: "Kimi connected successfully!",
        });
      } catch (error) {
        console.error("Failed to save Kimi API key:", error);
        setNotification({
          type: "error",
          message: "Failed to connect Kimi. Please verify your API key and try again.",
        });
      } finally {
        setConnectingProvider(null);
      }
      return;
    }

    try {
      const result = await connectProvider.mutateAsync(provider);
      // Open the OAuth URL in the same window
      window.location.href = result.authUrl;
    } catch (error) {
      console.error("Failed to start OAuth flow:", error);
      setNotification({
        type: "error",
        message: "Failed to start connection. Please try again.",
      });
      setConnectingProvider(null);
    }
  }, [connectProvider, setProviderApiKey]);

  const handleDisconnect = useCallback(async (provider: ProviderID) => {
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
  }, [disconnectProvider]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
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
        <p className="mt-1 text-sm text-muted-foreground">
          Connect your existing AI subscriptions to use additional models in Bap.
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
                  <p className="mt-1 text-sm text-muted-foreground">{provider.description}</p>
                  {provider.authType === "api_key" && provider.apiKeyHelp ? (
                    <p className="mt-1 text-xs text-muted-foreground">{provider.apiKeyHelp}</p>
                  ) : null}
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

      <div className="mt-6 rounded-lg border border-muted bg-muted/30 p-4">
        <div className="flex items-start gap-2">
          <Image
            src="/integrations/anthropic.svg"
            alt="Anthropic logo"
            width={16}
            height={16}
            className="mt-0.5 h-4 w-auto shrink-0 dark:invert"
          />
          <p className="text-xs text-muted-foreground">
            Anthropic models (Claude) are always available through Bap&apos;s platform. Connecting a
            subscription gives you access to additional models from that provider.
          </p>
        </div>
      </div>
    </div>
  );
}
