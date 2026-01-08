"use client";

import { ChatSidebar } from "@/components/chat/chat-sidebar";
import {
  SidebarProvider,
  SidebarInset,
  SidebarTrigger,
} from "@/components/animate-ui/components/radix/sidebar";

export default function ChatLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <SidebarProvider className="bg-background text-foreground">
      <ChatSidebar />
      <SidebarInset>
        <header className="flex h-14 items-center gap-2 border-b px-4">
          <SidebarTrigger />
          <span className="text-sm font-medium">Chat</span>
        </header>
        <div className="flex h-[calc(100vh-3.5rem)] flex-col">{children}</div>
      </SidebarInset>
    </SidebarProvider>
  );
}
