"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Plus, MessageSquare, Settings, Trash2 } from "lucide-react";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuAction,
  SidebarRail,
} from "@/components/animate-ui/components/radix/sidebar";
import { Button } from "@/components/ui/button";
import { useConversationList, useDeleteConversation } from "@/orpc/hooks";
import { formatDistanceToNow } from "date-fns";

type ConversationListData = {
  conversations: Array<{
    id: string;
    title: string | null;
    updatedAt: Date;
    messageCount: number;
  }>;
  nextCursor?: string;
};

export function ChatSidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const { data: rawData, isLoading } = useConversationList();
  const data = rawData as ConversationListData | undefined;
  const deleteConversation = useDeleteConversation();

  const handleDelete = async (id: string, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    await deleteConversation.mutateAsync(id);
    if (pathname === `/chat/${id}`) {
      router.push("/chat");
    }
  };

  return (
    <Sidebar collapsible="icon" className="border-r">
      <SidebarHeader>
        <Link href="/chat" className="flex items-center gap-3 p-2 overflow-hidden group-data-[collapsible=icon]:p-0 group-data-[collapsible=icon]:justify-center">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground group-data-[collapsible=icon]:h-8 group-data-[collapsible=icon]:w-8">
            <MessageSquare className="h-5 w-5 group-data-[collapsible=icon]:h-4 group-data-[collapsible=icon]:w-4" />
          </div>
          <div className="space-y-0.5 group-data-[collapsible=icon]:hidden">
            <p className="text-sm font-semibold">AI Assistant</p>
            <p className="text-xs text-muted-foreground">Chat</p>
          </div>
        </Link>
        <Button
          asChild
          variant="outline"
          className="w-full justify-start gap-2 group-data-[collapsible=icon]:w-8 group-data-[collapsible=icon]:h-8 group-data-[collapsible=icon]:p-0 group-data-[collapsible=icon]:justify-center"
        >
          <Link href="/chat">
            <Plus className="h-4 w-4 shrink-0" />
            <span className="group-data-[collapsible=icon]:hidden">New chat</span>
          </Link>
        </Button>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Recent conversations</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {isLoading ? (
                <div className="px-2 py-4 text-sm text-muted-foreground">
                  Loading...
                </div>
              ) : data?.conversations.length === 0 ? (
                <div className="px-2 py-4 text-sm text-muted-foreground">
                  No conversations yet
                </div>
              ) : (
                data?.conversations.map((conv) => (
                  <SidebarMenuItem key={conv.id}>
                    <SidebarMenuButton
                      asChild
                      isActive={pathname === `/chat/${conv.id}`}
                      tooltip={conv.title || "Untitled"}
                      highlightValue={conv.id}
                      className="h-auto py-2"
                    >
                      <Link
                        href={`/chat/${conv.id}`}
                        className="flex min-w-0 flex-1 flex-col items-start gap-0.5"
                      >
                        <span className="w-full truncate">
                          {conv.title || "Untitled"}
                        </span>
                        <span className="w-full truncate text-xs text-muted-foreground">
                          {formatDistanceToNow(new Date(conv.updatedAt), {
                            addSuffix: true,
                          })}
                        </span>
                      </Link>
                    </SidebarMenuButton>
                    <SidebarMenuAction
                      onClick={(e) => handleDelete(conv.id, e)}
                      showOnHover
                    >
                      <Trash2 className="h-4 w-4" />
                    </SidebarMenuAction>
                  </SidebarMenuItem>
                ))
              )}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton asChild tooltip="Settings" highlightValue="settings">
              <Link href="/settings/integrations">
                <Settings className="h-4 w-4" />
                <span>Settings</span>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>

      <SidebarRail />
    </Sidebar>
  );
}
