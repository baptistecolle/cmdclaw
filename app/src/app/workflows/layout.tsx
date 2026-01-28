"use client";

import { AppShell } from "@/components/app-shell";

export default function WorkflowsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <AppShell>
      <div className="min-h-screen bg-background">
        <div className="container px-4 py-6">
          <main className="mx-auto max-w-5xl">{children}</main>
        </div>
      </div>
    </AppShell>
  );
}
