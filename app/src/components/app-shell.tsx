"use client";

import { AppSidebar } from "@/components/app-sidebar";

export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-screen w-full">
      <AppSidebar />
      <div
        className="relative flex-1 min-w-0 h-full overflow-auto"
        style={{ transform: "translateZ(0)" }}
      >
        {children}
      </div>
    </div>
  );
}
