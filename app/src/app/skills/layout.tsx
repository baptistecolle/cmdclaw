"use client";

import { AppShell } from "@/components/app-shell";

export default function SkillsLayout({ children }: { children: React.ReactNode }) {
  return (
    <AppShell>
      <div className="min-h-screen bg-background">
        <div className="container px-4 py-6">
          <main className="mx-auto w-full max-w-[1500px]">{children}</main>
        </div>
      </div>
    </AppShell>
  );
}
