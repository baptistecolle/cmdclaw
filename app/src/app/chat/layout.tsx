"use client";

import { Loader2 } from "lucide-react";
import { useParams, useRouter } from "next/navigation";
import { useEffect } from "react";
import {
  SidebarProvider,
  SidebarInset,
  SidebarTrigger,
} from "@/components/animate-ui/components/radix/sidebar";
import { AppShell } from "@/components/app-shell";
import { ChatCopyButton } from "@/components/chat/chat-copy-button";
import { ChatSidebar } from "@/components/chat/chat-sidebar";
import { useIsAdmin } from "@/hooks/use-is-admin";
import { useCurrentUser } from "@/orpc/hooks";

export default function ChatLayout({ children }: { children: React.ReactNode }) {
  const { isAdmin } = useIsAdmin();
  const params = useParams();
  const conversationId = params?.conversationId as string | undefined;
  const router = useRouter();
  const { data: user, isLoading: userLoading } = useCurrentUser();

  useEffect(() => {
    if (!userLoading && user && !user.onboardedAt) {
      router.replace("/onboarding/integrations");
    }
  }, [user, userLoading, router]);

  // Show loading while checking onboarding status
  if (userLoading || (user && !user.onboardedAt)) {
    return (
      <div className="bg-background flex h-screen items-center justify-center">
        <Loader2 className="text-muted-foreground h-8 w-8 animate-spin" />
      </div>
    );
  }

  return (
    <AppShell>
      <SidebarProvider className="bg-background text-foreground">
        <ChatSidebar />
        <SidebarInset>
          <header className="flex h-14 items-center gap-2 border-b px-4">
            <SidebarTrigger />
            <span className="text-sm font-medium">Chat</span>
            {isAdmin && conversationId && (
              <span className="text-muted-foreground font-mono text-xs">ID: {conversationId}</span>
            )}
            <ChatCopyButton conversationId={conversationId} className="ml-auto" />
          </header>
          <div className="flex h-[calc(100vh-3.5rem)] flex-col overflow-hidden">{children}</div>
        </SidebarInset>
      </SidebarProvider>
    </AppShell>
  );
}
