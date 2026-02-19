"use client";

import { Loader2 } from "lucide-react";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import {
  SidebarProvider,
  SidebarInset,
  SidebarTrigger,
} from "@/components/animate-ui/components/radix/sidebar";
import { AppShell } from "@/components/app-shell";
import { ChatCopyButton } from "@/components/chat/chat-copy-button";
import { ChatShareControls } from "@/components/chat/chat-share-controls";
import { ChatSidebar } from "@/components/chat/chat-sidebar";
import { useIsAdmin } from "@/hooks/use-is-admin";
import { useIsMobile } from "@/hooks/use-mobile";
import { useCurrentUser } from "@/orpc/hooks";

const CHAT_CONVERSATION_ID_SYNC_EVENT = "chat:conversation-id-sync";

export default function ChatLayout({ children }: { children: React.ReactNode }) {
  const { isAdmin } = useIsAdmin();
  const params = useParams();
  const routeConversationId = params?.conversationId as string | undefined;
  const [liveConversationId, setLiveConversationId] = useState<string | undefined>(
    routeConversationId,
  );
  const router = useRouter();
  const { data: user, isLoading: userLoading } = useCurrentUser();
  const isMobile = useIsMobile();
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);

  const handleSidebarOpenChange = useCallback(
    (open: boolean) => {
      setIsSidebarOpen(isMobile ? open : true);
    },
    [isMobile],
  );

  useEffect(() => {
    setLiveConversationId(routeConversationId);
  }, [routeConversationId]);

  useEffect(() => {
    const handleConversationIdSync = (event: Event) => {
      const detail = (event as CustomEvent<{ conversationId?: string }>).detail;
      if (detail?.conversationId) {
        setLiveConversationId(detail.conversationId);
      }
    };

    window.addEventListener(CHAT_CONVERSATION_ID_SYNC_EVENT, handleConversationIdSync);
    return () =>
      window.removeEventListener(CHAT_CONVERSATION_ID_SYNC_EVENT, handleConversationIdSync);
  }, []);

  useEffect(() => {
    if (!userLoading && user && !user.onboardedAt) {
      router.replace("/onboarding/integrations");
    }
  }, [user, userLoading, router]);

  useEffect(() => {
    if (!isMobile && !isSidebarOpen) {
      setIsSidebarOpen(true);
    }
  }, [isMobile, isSidebarOpen]);

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
      <SidebarProvider
        className="bg-background text-foreground"
        open={isSidebarOpen}
        onOpenChange={handleSidebarOpenChange}
      >
        <ChatSidebar />
        <SidebarInset>
          <header className="flex h-14 items-center gap-2 border-b px-4">
            <SidebarTrigger className="md:hidden" />
            <span className="text-sm font-medium">Chat</span>
            {isAdmin && liveConversationId && (
              <span className="text-muted-foreground font-mono text-xs">
                ID: {liveConversationId}
              </span>
            )}
            <ChatCopyButton conversationId={liveConversationId} className="ml-auto" />
            <ChatShareControls conversationId={liveConversationId} />
          </header>
          <div className="flex h-[calc(100vh-3.5rem)] flex-col overflow-hidden">{children}</div>
        </SidebarInset>
      </SidebarProvider>
    </AppShell>
  );
}
