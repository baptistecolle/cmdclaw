"use client";

import { CheckCircle2, Loader2, XCircle } from "lucide-react";
import Image from "next/image";
import { useSearchParams, useRouter } from "next/navigation";
import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  isUnipileMissingCredentialsError,
  UNIPILE_MISSING_CREDENTIALS_MESSAGE,
} from "@/lib/integration-errors";
import { cn } from "@/lib/utils";
import {
  useIntegrationList,
  useGetAuthUrl,
  useCompleteOnboarding,
  useLinkLinkedIn,
} from "@/orpc/hooks";

const integrationConfig = {
  gmail: {
    name: "Gmail",
    icon: "/integrations/google-gmail.svg",
  },
  google_calendar: {
    name: "Calendar",
    icon: "/integrations/google-calendar.svg",
  },
  google_docs: {
    name: "Docs",
    icon: "/integrations/google-docs.svg",
  },
  google_sheets: {
    name: "Sheets",
    icon: "/integrations/google-sheets.svg",
  },
  google_drive: {
    name: "Drive",
    icon: "/integrations/google-drive.svg",
  },
  notion: {
    name: "Notion",
    icon: "/integrations/notion.svg",
  },
  airtable: {
    name: "Airtable",
    icon: "/integrations/airtable.svg",
  },
  slack: {
    name: "Slack",
    icon: "/integrations/slack.svg",
  },
  hubspot: {
    name: "HubSpot",
    icon: "/integrations/hubspot.svg",
  },
  linkedin: {
    name: "LinkedIn",
    icon: "/integrations/linkedin.svg",
  },
} as const;

type IntegrationType = keyof typeof integrationConfig;

const recommendedIntegrations: IntegrationType[] = ["gmail", "google_calendar"];
const otherIntegrations: IntegrationType[] = [
  "google_docs",
  "google_sheets",
  "google_drive",
  "notion",
  "airtable",
  "slack",
  "hubspot",
  "linkedin",
];

function OnboardingIntegrationsFallback() {
  return (
    <div className="flex min-h-screen items-center justify-center">
      <Loader2 className="text-muted-foreground h-8 w-8 animate-spin" />
    </div>
  );
}

const onboardingIntegrationsFallbackNode = <OnboardingIntegrationsFallback />;

function IntegrationIconButton({
  type,
  isRecommended,
  isConnected,
  isConnecting,
  onConnect,
}: {
  type: IntegrationType;
  isRecommended: boolean;
  isConnected: boolean;
  isConnecting: boolean;
  onConnect: (type: IntegrationType) => Promise<void>;
}) {
  const config = integrationConfig[type];

  const handleClick = useCallback(() => {
    if (!isConnected) {
      void onConnect(type);
    }
  }, [isConnected, onConnect, type]);

  return (
    <button
      onClick={handleClick}
      disabled={isConnected || isConnecting}
      className={cn(
        "relative flex flex-col items-center gap-2 rounded-xl p-4 transition-all",
        "border hover:border-primary/50 hover:bg-muted/50",
        isConnected && "border-green-500/50 bg-green-500/5",
        isRecommended && !isConnected && "border-primary/30 bg-primary/5",
        isConnecting && "opacity-50 cursor-wait",
      )}
    >
      {isConnected && (
        <div className="absolute -top-1.5 -right-1.5">
          <CheckCircle2 className="fill-background h-5 w-5 text-green-500" />
        </div>
      )}
      {isRecommended && !isConnected && (
        <span className="text-primary text-[10px] font-medium">Recommended</span>
      )}
      {isConnecting ? (
        <Loader2 className="text-muted-foreground h-6 w-6 animate-spin" />
      ) : isRecommended ? (
        <div className="flex h-12 w-12 items-center justify-center rounded-lg border bg-white shadow-sm dark:bg-gray-800">
          <Image
            src={config.icon}
            alt={config.name}
            width={32}
            height={32}
            className="h-8 w-auto"
          />
        </div>
      ) : (
        <div className="flex h-8 w-8 items-center justify-center">
          <Image
            src={config.icon}
            alt={config.name}
            width={32}
            height={32}
            className="h-8 w-auto"
          />
        </div>
      )}
      <span className="text-muted-foreground text-xs font-medium">{config.name}</span>
    </button>
  );
}

function OnboardingIntegrationsContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const { data: integrations, isLoading, refetch } = useIntegrationList();
  const getAuthUrl = useGetAuthUrl();
  const completeOnboarding = useCompleteOnboarding();
  const linkLinkedIn = useLinkLinkedIn();
  const [connectingType, setConnectingType] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const linkedInLinkingRef = useRef(false);

  useEffect(() => {
    const accountId = searchParams.get("account_id");
    if (accountId && !linkedInLinkingRef.current) {
      linkedInLinkingRef.current = true;
      linkLinkedIn
        .mutateAsync(accountId)
        .then(() => {
          refetch();
        })
        .catch((error) => {
          console.error("Failed to link LinkedIn:", error);
        })
        .finally(() => {
          window.history.replaceState({}, "", "/onboarding/integrations");
        });
    }
  }, [searchParams, linkLinkedIn, refetch]);

  useEffect(() => {
    const success = searchParams.get("success");
    const error = searchParams.get("error");

    if (success || error) {
      window.history.replaceState({}, "", "/onboarding/integrations");
      if (success) {
        refetch();
      }
    }
  }, [searchParams, refetch]);

  const handleConnect = useCallback(
    async (type: IntegrationType) => {
      setConnectingType(type);
      setErrorMessage(null);
      try {
        const result = await getAuthUrl.mutateAsync({
          type,
          redirectUrl: `${window.location.origin}/onboarding/integrations`,
        });
        window.location.assign(result.authUrl);
      } catch (error) {
        console.error("Failed to get auth URL:", error);
        setErrorMessage(
          isUnipileMissingCredentialsError(error)
            ? UNIPILE_MISSING_CREDENTIALS_MESSAGE
            : "Failed to start connection. Please try again.",
        );
        setConnectingType(null);
      }
    },
    [getAuthUrl],
  );

  const handleContinue = useCallback(async () => {
    await completeOnboarding.mutateAsync();
    router.push("/chat");
  }, [completeOnboarding, router]);

  const handleSkip = useCallback(async () => {
    await completeOnboarding.mutateAsync();
    router.push("/chat");
  }, [completeOnboarding, router]);

  const integrationsList = Array.isArray(integrations) ? integrations : [];
  const connectedIntegrations = new Set(integrationsList.map((i) => i.type));

  if (isLoading) {
    return <OnboardingIntegrationsFallback />;
  }

  return (
    <div className="bg-background flex min-h-screen items-center justify-center p-4">
      <div className="w-full max-w-2xl">
        <div className="mb-8 text-center">
          <h1 className="mb-2 text-2xl font-semibold tracking-tight">Connect your tools</h1>
          <p className="text-muted-foreground">
            Connect your apps to let the AI assistant help you with tasks like reading emails,
            scheduling meetings, and managing documents.
          </p>
        </div>

        {errorMessage && (
          <div className="mb-6 flex items-center gap-2 rounded-lg border border-red-500/50 bg-red-500/10 p-4 text-red-700 dark:text-red-400">
            <XCircle className="h-5 w-5" />
            {errorMessage}
          </div>
        )}

        <div className="bg-card mb-6 rounded-2xl border p-6">
          <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-5">
            {recommendedIntegrations.map((type) => (
              <IntegrationIconButton
                key={type}
                type={type}
                isRecommended
                isConnected={connectedIntegrations.has(type)}
                isConnecting={connectingType === type}
                onConnect={handleConnect}
              />
            ))}
          </div>

          <div className="relative mb-6">
            <div className="absolute inset-0 flex items-center">
              <span className="w-full border-t" />
            </div>
            <div className="relative flex justify-center text-xs uppercase">
              <span className="bg-card text-muted-foreground px-2">More integrations</span>
            </div>
          </div>

          <div className="grid grid-cols-4 gap-3 sm:grid-cols-8">
            {otherIntegrations.map((type) => (
              <IntegrationIconButton
                key={type}
                type={type}
                isRecommended={false}
                isConnected={connectedIntegrations.has(type)}
                isConnecting={connectingType === type}
                onConnect={handleConnect}
              />
            ))}
          </div>
        </div>

        <div className="flex justify-center gap-3">
          <Button variant="ghost" onClick={handleSkip} disabled={completeOnboarding.isPending}>
            Skip for now
          </Button>
          <Button onClick={handleContinue} disabled={completeOnboarding.isPending}>
            {completeOnboarding.isPending ? "Loading..." : "Continue"}
          </Button>
        </div>
      </div>
    </div>
  );
}

export default function OnboardingIntegrationsPage() {
  return (
    <Suspense fallback={onboardingIntegrationsFallbackNode}>
      <OnboardingIntegrationsContent />
    </Suspense>
  );
}
