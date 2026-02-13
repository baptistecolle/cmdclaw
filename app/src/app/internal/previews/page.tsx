"use client";

import { ArrowLeft, AlertTriangle } from "lucide-react";
import Link from "next/link";
import { useMemo } from "react";
import { INTEGRATION_PREVIEWS } from "@/components/chat/previews";
import { PREVIEW_MOCK_DATA } from "@/components/chat/previews/mock-data";

const EMPTY_POSITIONAL_ARGS: string[] = [];

function PreviewCard({ children, label }: { children: React.ReactNode; label: string }) {
  return (
    <div className="bg-card rounded-lg border p-4">
      <div className="text-muted-foreground mb-3 border-b pb-2 text-xs font-medium">{label}</div>
      {children}
    </div>
  );
}

function MissingMockDataAlert({ integrations }: { integrations: string[] }) {
  if (integrations.length === 0) {
    return null;
  }

  return (
    <div className="mb-8 rounded-lg border border-amber-500/50 bg-amber-500/10 p-4">
      <div className="flex items-start gap-3">
        <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-500" />
        <div>
          <h3 className="font-medium text-amber-700 dark:text-amber-400">Missing Mock Data</h3>
          <p className="mt-1 text-sm text-amber-600 dark:text-amber-500">
            The following integrations have preview components but no mock data defined in{" "}
            <code className="rounded bg-amber-500/20 px-1 py-0.5 font-mono text-xs">
              mock-data.ts
            </code>
            :
          </p>
          <ul className="mt-2 space-y-1">
            {integrations.map((key) => (
              <li key={key} className="font-mono text-sm text-amber-700 dark:text-amber-400">
                {key} ({INTEGRATION_PREVIEWS[key]?.displayName})
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}

export default function PreviewsPage() {
  const integrations = useMemo(() => Object.entries(INTEGRATION_PREVIEWS), []);

  const missingMockData = useMemo(
    () =>
      integrations
        .filter(([key]) => !PREVIEW_MOCK_DATA[key] || PREVIEW_MOCK_DATA[key].length === 0)
        .map(([key]) => key),
    [integrations],
  );

  return (
    <div className="bg-background min-h-screen p-8">
      <div className="mx-auto max-w-6xl">
        <div className="mb-8">
          <Link
            href="/internal"
            className="text-muted-foreground hover:text-foreground mb-4 inline-flex items-center gap-2 text-sm"
          >
            <ArrowLeft className="h-4 w-4" />
            Back to Internal
          </Link>
          <h1 className="text-2xl font-bold">Component Previews</h1>
          <p className="text-muted-foreground mt-1">
            Preview all integration components with mock data
          </p>
        </div>

        <MissingMockDataAlert integrations={missingMockData} />

        <div className="space-y-12">
          {integrations.map(([integrationKey, config]) => {
            const mockData = PREVIEW_MOCK_DATA[integrationKey];
            const Component = config.component;

            // Skip integrations without mock data (they're shown in the alert)
            if (!mockData || mockData.length === 0) {
              return null;
            }

            return (
              <section key={integrationKey}>
                <h2 className="mb-4 border-b pb-2 text-xl font-semibold">{config.displayName}</h2>
                <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                  {mockData.map((preview) => (
                    <PreviewCard
                      key={`${integrationKey}-${preview.operation}-${preview.label}`}
                      label={preview.label}
                    >
                      <Component
                        integration={integrationKey}
                        operation={preview.operation}
                        args={preview.args}
                        positionalArgs={preview.positionalArgs ?? EMPTY_POSITIONAL_ARGS}
                        command={`${integrationKey} ${preview.operation}`}
                      />
                    </PreviewCard>
                  ))}
                </div>
              </section>
            );
          })}
        </div>
      </div>
    </div>
  );
}
