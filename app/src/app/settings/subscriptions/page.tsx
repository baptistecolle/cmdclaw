"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Loader2, CheckCircle2, XCircle, ExternalLink } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  useProviderAuthStatus,
  useConnectProvider,
  useDisconnectProvider,
} from "@/orpc/hooks";
import { useQueryClient } from "@tanstack/react-query";

type ProviderID = "openai" | "google";

const PROVIDERS: {
  id: ProviderID;
  name: string;
  description: string;
  models: string[];
}[] = [
  {
    id: "openai",
    name: "ChatGPT",
    description: "Use your ChatGPT Plus/Pro/Max subscription",
    models: ["GPT-5.1 Codex Max", "GPT-5.1 Codex Mini", "GPT-5.2", "GPT-5.2 Codex", "GPT-5.1 Codex"],
  },
  {
    id: "google",
    name: "Gemini",
    description: "Use your Google AI Pro/Ultra subscription",
    models: ["Gemini 2.5 Pro", "Gemini 2.5 Flash"],
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
        message: `${connected === "openai" ? "ChatGPT" : "Gemini"} connected successfully!`,
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

export default function SubscriptionsPage() {
  const { data, isLoading } = useProviderAuthStatus();
  const connectProvider = useConnectProvider();
  const disconnectProvider = useDisconnectProvider();
  const [connectingProvider, setConnectingProvider] = useState<ProviderID | null>(null);
  const [notification, setNotification] = useState<{
    type: "success" | "error";
    message: string;
  } | null>(null);

  const handleNotification = useCallback(
    (newNotification: { type: "success" | "error"; message: string }) => {
      setNotification(newNotification);
    },
    []
  );

  // Auto-dismiss notifications
  useEffect(() => {
    if (notification) {
      const timer = setTimeout(() => setNotification(null), 5000);
      return () => clearTimeout(timer);
    }
  }, [notification]);

  const handleConnect = async (provider: ProviderID) => {
    setConnectingProvider(provider);
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
  };

  const handleDisconnect = async (provider: ProviderID) => {
    try {
      await disconnectProvider.mutateAsync(provider);
      setNotification({
        type: "success",
        message: `${provider === "openai" ? "ChatGPT" : "Gemini"} disconnected.`,
      });
    } catch (error) {
      console.error("Failed to disconnect:", error);
      setNotification({
        type: "error",
        message: "Failed to disconnect. Please try again.",
      });
    }
  };

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
              : "border-red-500/50 bg-red-500/10 text-red-700 dark:text-red-400"
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
            <div
              key={provider.id}
              className="rounded-lg border p-5"
            >
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <h3 className="font-medium">{provider.name}</h3>
                    {isConnected && (
                      <span className="inline-flex items-center gap-1 rounded-full bg-green-500/10 px-2 py-0.5 text-xs font-medium text-green-700 dark:text-green-400">
                        <CheckCircle2 className="h-3 w-3" />
                        Connected
                      </span>
                    )}
                  </div>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {provider.description}
                  </p>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {provider.models.map((model) => (
                      <span
                        key={model}
                        className={cn(
                          "rounded-md px-2 py-0.5 text-xs",
                          isConnected
                            ? "bg-foreground/10 text-foreground"
                            : "bg-muted text-muted-foreground"
                        )}
                      >
                        {model}
                      </span>
                    ))}
                  </div>
                </div>

                <div className="shrink-0">
                  {isConnected ? (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleDisconnect(provider.id)}
                      disabled={isDisconnecting}
                    >
                      {isDisconnecting ? (
                        <Loader2 className="mr-2 h-3 w-3 animate-spin" />
                      ) : null}
                      Disconnect
                    </Button>
                  ) : (
                    <Button
                      size="sm"
                      onClick={() => handleConnect(provider.id)}
                      disabled={isConnecting}
                    >
                      {isConnecting ? (
                        <Loader2 className="mr-2 h-3 w-3 animate-spin" />
                      ) : (
                        <ExternalLink className="mr-2 h-3 w-3" />
                      )}
                      Connect
                    </Button>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <div className="mt-6 rounded-lg border border-muted bg-muted/30 p-4">
        <p className="text-xs text-muted-foreground">
          Anthropic models (Claude) are always available through Bap&apos;s platform.
          Connecting a subscription gives you access to additional models from
          that provider. Your tokens are encrypted and stored securely.
        </p>
      </div>
    </div>
  );
}
