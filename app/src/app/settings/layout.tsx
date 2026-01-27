"use client";

import { AppShell } from "@/components/app-shell";

export default function SettingsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <AppShell>
      <div className="flex min-h-screen items-center justify-center bg-background">
        <main className="w-full max-w-4xl px-4">{children}</main>
      </div>
    </AppShell>
  );
}
