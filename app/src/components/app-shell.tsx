"use client";

import { AppSidebar } from "@/components/app-sidebar";

const APP_SHELL_CONTENT_STYLE: React.CSSProperties = { transform: "translateZ(0)" };

export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-screen w-full">
      <AppSidebar />
      <div className="relative flex-1 min-w-0 h-full overflow-auto" style={APP_SHELL_CONTENT_STYLE}>
        {children}
      </div>
    </div>
  );
}
