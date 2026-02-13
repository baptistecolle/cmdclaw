"use client";

import { formatDistanceToNow } from "date-fns";
import { Plus, Trash2, MoreHorizontal } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useCallback } from "react";
import {
  Sidebar,
  SidebarContent,
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useConversationList, useDeleteConversation } from "@/orpc/hooks";

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

  const handleDelete = useCallback(
    async (id: string, e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      await deleteConversation.mutateAsync(id);
      if (pathname === `/chat/${id}`) {
        router.push("/chat");
      }
    },
    [deleteConversation, pathname, router],
  );

  const handleCreateNewChat = useCallback(() => {
    window.dispatchEvent(new CustomEvent("new-chat"));
    router.push("/chat");
  }, [router]);

  const handleDeleteMenuClick = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      const id = event.currentTarget.dataset.conversationId;
      if (!id) {
        return;
      }
      void handleDelete(id, event);
    },
    [handleDelete],
  );

  return (
    <Sidebar collapsible="icon" className="border-r">
      <SidebarHeader>
        <Button
          variant="outline"
          className="w-full justify-start gap-2 group-data-[collapsible=icon]:h-8 group-data-[collapsible=icon]:w-8 group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:p-0"
          onClick={handleCreateNewChat}
        >
          <Plus className="h-4 w-4 shrink-0" />
          <span className="group-data-[collapsible=icon]:hidden">New chat</span>
        </Button>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Recent conversations</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {isLoading ? (
                <div className="text-muted-foreground px-2 py-4 text-sm">Loading...</div>
              ) : data?.conversations.length === 0 ? (
                <div className="text-muted-foreground px-2 py-4 text-sm">No conversations yet</div>
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
                        <span className="w-full truncate">{conv.title || "Untitled"}</span>
                        <span className="text-muted-foreground w-full truncate text-xs">
                          {formatDistanceToNow(new Date(conv.updatedAt), {
                            addSuffix: true,
                          })}
                        </span>
                      </Link>
                    </SidebarMenuButton>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <SidebarMenuAction
                          showOnHover
                          className="border-0 focus:ring-0 focus:outline-none focus-visible:ring-0 data-[state=open]:bg-transparent"
                        >
                          <MoreHorizontal className="h-4 w-4" />
                        </SidebarMenuAction>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="start" side="right">
                        <DropdownMenuItem
                          data-conversation-id={conv.id}
                          onClick={handleDeleteMenuClick}
                          className="text-destructive focus:text-destructive"
                        >
                          <Trash2 className="h-4 w-4" />
                          <span>Delete</span>
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </SidebarMenuItem>
                ))
              )}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarRail />
    </Sidebar>
  );
}
