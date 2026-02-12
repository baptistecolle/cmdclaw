"use client";

import { CheckCircle2, Loader2 } from "lucide-react";
import Image from "next/image";
import { useSearchParams, useRouter } from "next/navigation";
import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
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
    <div className="flex items-center justify-center min-h-screen">
      <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
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
          <CheckCircle2 className="h-5 w-5 text-green-500 fill-background" />
        </div>
      )}
      {isRecommended && !isConnected && (
        <span className="text-[10px] font-medium text-primary">Recommended</span>
      )}
      {isConnecting ? (
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      ) : isRecommended ? (
        <div className="flex items-center justify-center w-12 h-12 rounded-lg bg-white dark:bg-gray-800 border shadow-sm">
          <Image src={config.icon} alt={config.name} width={32} height={32} />
        </div>
      ) : (
        <div className="flex items-center justify-center w-8 h-8">
          <Image src={config.icon} alt={config.name} width={32} height={32} />
        </div>
      )}
      <span className="text-xs font-medium text-muted-foreground">{config.name}</span>
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
      try {
        const result = await getAuthUrl.mutateAsync({
          type,
          redirectUrl: `${window.location.origin}/onboarding/integrations`,
        });
        window.location.assign(result.authUrl);
      } catch (error) {
        console.error("Failed to get auth URL:", error);
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
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <div className="w-full max-w-2xl">
        <div className="text-center mb-8">
          <h1 className="text-2xl font-semibold tracking-tight mb-2">Connect your tools</h1>
          <p className="text-muted-foreground">
            Connect your apps to let the AI assistant help you with tasks like reading emails,
            scheduling meetings, and managing documents.
          </p>
        </div>

        <div className="bg-card rounded-2xl border p-6 mb-6">
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 mb-6">
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
              <span className="bg-card px-2 text-muted-foreground">More integrations</span>
            </div>
          </div>

          <div className="grid grid-cols-4 sm:grid-cols-8 gap-3">
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

        <div className="flex gap-3 justify-center">
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
