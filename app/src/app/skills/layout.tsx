"use client";

import { AppShell } from "@/components/app-shell";

export default function SkillsLayout({ children }: { children: React.ReactNode }) {
  return (
    <AppShell>
      <div className="bg-background min-h-screen">
        <div className="container px-4 py-6">
          <main className="mx-auto w-full max-w-[1500px]">{children}</main>
        </div>
      </div>
    </AppShell>
  );
}
