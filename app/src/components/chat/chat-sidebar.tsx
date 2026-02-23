"use client";

import { formatDistanceToNow } from "date-fns";
import { LoaderCircle, MoreHorizontal, Pencil, Pin, PinOff, Plus, Trash2 } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import { useChatDraftStore } from "@/components/chat/chat-draft-store";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { useIsMobile } from "@/hooks/use-mobile";
import {
  useConversationList,
  useDeleteConversation,
  useMarkConversationSeen,
  useUpdateConversationPinned,
  useUpdateConversationTitle,
} from "@/orpc/hooks";

type ConversationListData = {
  conversations: Array<{
    id: string;
    title: string | null;
    isPinned: boolean;
    generationStatus:
      | "idle"
      | "generating"
      | "awaiting_approval"
      | "awaiting_auth"
      | "paused"
      | "complete"
      | "error";
    updatedAt: Date;
    messageCount: number;
    seenMessageCount: number;
  }>;
  nextCursor?: string;
};

const RUNNING_CONVERSATION_STATUSES = new Set([
  "generating",
  "awaiting_approval",
  "awaiting_auth",
  "paused",
]);

export function ChatSidebar() {
  const isMobile = useIsMobile();
  const pathname = usePathname();
  const router = useRouter();
  const { data: rawData, isLoading } = useConversationList();
  const data = rawData as ConversationListData | undefined;
  const deleteConversation = useDeleteConversation();
  const markConversationSeenMutation = useMarkConversationSeen();
  const updateConversationPinned = useUpdateConversationPinned();
  const updateConversationTitle = useUpdateConversationTitle();
  const [isRenameModalOpen, setIsRenameModalOpen] = useState(false);
  const [renameConversationId, setRenameConversationId] = useState<string | null>(null);
  const [renameTitle, setRenameTitle] = useState("");
  const latestSeenRef = useRef<Record<string, number>>({});

  const renameTitleTrimmed = useMemo(() => renameTitle.trim(), [renameTitle]);
  const isRenameDisabled =
    !renameConversationId || renameTitleTrimmed.length === 0 || updateConversationTitle.isPending;

  const handleDelete = useCallback(
    async (id: string, e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      await deleteConversation.mutateAsync(id);
      useChatDraftStore.getState().clearDraft(id);
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

  const handleRenameMenuClick = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    const id = event.currentTarget.dataset.conversationId;
    if (!id) {
      return;
    }
    const title = event.currentTarget.dataset.conversationTitle ?? "";
    setRenameConversationId(id);
    setRenameTitle(title);
    setIsRenameModalOpen(true);
  }, []);

  const handlePinMenuClick = useCallback(
    async (event: React.MouseEvent<HTMLDivElement>) => {
      const id = event.currentTarget.dataset.conversationId;
      if (!id) {
        return;
      }
      const isPinned = event.currentTarget.dataset.conversationPinned === "true";
      await updateConversationPinned.mutateAsync({
        id,
        isPinned: !isPinned,
      });
    },
    [updateConversationPinned],
  );

  const handleRenameSubmit = useCallback(async () => {
    if (!renameConversationId || renameTitleTrimmed.length === 0) {
      return;
    }

    await updateConversationTitle.mutateAsync({
      id: renameConversationId,
      title: renameTitleTrimmed,
    });

    setIsRenameModalOpen(false);
    setRenameConversationId(null);
    setRenameTitle("");
  }, [renameConversationId, renameTitleTrimmed, updateConversationTitle]);

  const handleRenameModalOpenChange = useCallback((open: boolean) => {
    setIsRenameModalOpen(open);
    if (!open) {
      setRenameConversationId(null);
      setRenameTitle("");
    }
  }, []);

  const handleRenameInputChange = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    setRenameTitle(event.target.value);
  }, []);

  const handleRenameFormSubmit = useCallback(
    (event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      void handleRenameSubmit();
    },
    [handleRenameSubmit],
  );

  useEffect(() => {
    const activeConversationId = pathname.startsWith("/chat/")
      ? pathname.slice("/chat/".length)
      : "";
    if (!activeConversationId || !data?.conversations) {
      return;
    }
    const activeConversation = data.conversations.find((conv) => conv.id === activeConversationId);
    if (!activeConversation) {
      return;
    }

    const targetSeenCount = activeConversation.messageCount;
    const serverSeenCount = activeConversation.seenMessageCount ?? 0;
    const localLatestSeenCount = latestSeenRef.current[activeConversation.id] ?? 0;
    const currentSeenCount = Math.max(serverSeenCount, localLatestSeenCount);

    if (targetSeenCount <= currentSeenCount) {
      return;
    }

    latestSeenRef.current[activeConversation.id] = targetSeenCount;
    markConversationSeenMutation.mutate({
      id: activeConversation.id,
      seenMessageCount: targetSeenCount,
    });
  }, [data?.conversations, markConversationSeenMutation, pathname]);

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
                data?.conversations.map((conv) => {
                  const isActiveConversation = pathname === `/chat/${conv.id}`;
                  const isConversationRunning = RUNNING_CONVERSATION_STATUSES.has(
                    conv.generationStatus,
                  );
                  const seenMessageCount = conv.seenMessageCount ?? 0;
                  const hasUnreadResults =
                    !isConversationRunning &&
                    !isActiveConversation &&
                    conv.messageCount > seenMessageCount;

                  return (
                    <SidebarMenuItem key={conv.id}>
                      <SidebarMenuButton
                        asChild
                        isActive={isActiveConversation}
                        tooltip={conv.title || "Untitled"}
                        highlightValue={conv.id}
                        className="h-auto py-2"
                      >
                        <Link
                          href={`/chat/${conv.id}`}
                          className="flex min-w-0 flex-1 flex-col items-start gap-0.5"
                        >
                          <span className="flex w-full min-w-0 items-center gap-1.5">
                            {isConversationRunning ? (
                              <LoaderCircle className="text-muted-foreground h-3.5 w-3.5 shrink-0 animate-spin" />
                            ) : hasUnreadResults ? (
                              <span
                                className="h-2.5 w-2.5 shrink-0 rounded-full bg-blue-500"
                                aria-label="New unread results"
                              />
                            ) : null}
                            {conv.isPinned ? (
                              <Pin className="text-muted-foreground h-3.5 w-3.5 shrink-0" />
                            ) : null}
                            <span className="truncate">{conv.title || "Untitled"}</span>
                          </span>
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
                            data-conversation-pinned={conv.isPinned ? "true" : "false"}
                            onClick={handlePinMenuClick}
                          >
                            {conv.isPinned ? (
                              <PinOff className="h-4 w-4" />
                            ) : (
                              <Pin className="h-4 w-4" />
                            )}
                            <span>{conv.isPinned ? "Unpin" : "Pin"}</span>
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            data-conversation-id={conv.id}
                            data-conversation-title={conv.title ?? ""}
                            onClick={handleRenameMenuClick}
                          >
                            <Pencil className="h-4 w-4" />
                            <span>Rename</span>
                          </DropdownMenuItem>
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
                  );
                })
              )}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      {isMobile ? <SidebarRail /> : null}

      <AlertDialog open={isRenameModalOpen} onOpenChange={handleRenameModalOpenChange}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Rename chat</AlertDialogTitle>
          </AlertDialogHeader>
          <form className="space-y-4" onSubmit={handleRenameFormSubmit}>
            <Input
              value={renameTitle}
              onChange={handleRenameInputChange}
              placeholder="Chat title"
              autoFocus
              maxLength={200}
            />
            <AlertDialogFooter>
              <AlertDialogCancel type="button" disabled={updateConversationTitle.isPending}>
                Cancel
              </AlertDialogCancel>
              <Button type="submit" disabled={isRenameDisabled}>
                {updateConversationTitle.isPending ? "Renaming..." : "Rename"}
              </Button>
            </AlertDialogFooter>
          </form>
        </AlertDialogContent>
      </AlertDialog>
    </Sidebar>
  );
}
