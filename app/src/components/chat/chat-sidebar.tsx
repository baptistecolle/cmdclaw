"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Plus, Settings, Trash2, LogOut, ChevronUp, MoreHorizontal, Plug, Sparkles } from "lucide-react";
import Image from "next/image";
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { useConversationList, useDeleteConversation } from "@/orpc/hooks";
import { formatDistanceToNow } from "date-fns";
import { authClient } from "@/lib/auth-client";

type SessionData = Awaited<ReturnType<typeof authClient.getSession>>["data"];

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
  const [session, setSession] = useState<SessionData>(null);

  useEffect(() => {
    let mounted = true;

    authClient
      .getSession()
      .then((res) => {
        if (!mounted) return;
        const hasSession = res?.data?.session && res?.data?.user;
        setSession(hasSession ? res.data : null);
      })
      .catch(() => {
        if (mounted) setSession(null);
      });

    return () => {
      mounted = false;
    };
  }, []);

  const handleSignOut = async () => {
    const { error } = await authClient.signOut();
    if (!error) {
      setSession(null);
      router.push("/login");
    }
  };

  const handleDelete = async (id: string, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    await deleteConversation.mutateAsync(id);
    if (pathname === `/chat/${id}`) {
      router.push("/chat");
    }
  };

  const displayName = session?.user?.name ?? session?.user?.email ?? "";
  const userEmail = session?.user?.email ?? "";
  const avatarInitial = userEmail ? userEmail.charAt(0).toUpperCase() : "";

  return (
    <Sidebar collapsible="icon" className="border-r">
      <SidebarHeader>
        <Link href="/chat" className="flex items-center gap-3 p-2 overflow-hidden group-data-[collapsible=icon]:p-0 group-data-[collapsible=icon]:justify-center">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden group-data-[collapsible=icon]:h-8 group-data-[collapsible=icon]:w-8">
            <Image src="/logo.png" alt="Bap" width={36} height={36} className="object-contain" />
          </div>
          <div className="space-y-0.5 group-data-[collapsible=icon]:hidden">
            <p className="text-sm font-semibold">Bap</p>
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
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <SidebarMenuAction showOnHover className="focus:ring-0 focus:outline-none focus-visible:ring-0 border-0 data-[state=open]:bg-transparent">
                          <MoreHorizontal className="h-4 w-4" />
                        </SidebarMenuAction>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="start" side="right">
                        <DropdownMenuItem
                          onClick={(e) => handleDelete(conv.id, e)}
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

      <SidebarFooter>
        <SidebarMenu>
          <SidebarMenuItem>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <SidebarMenuButton
                  size="lg"
                  tooltip={session?.user ? userEmail : "Account"}
                  className="justify-between group-data-[collapsible=icon]:justify-center"
                >
                  <div className="flex size-8 items-center justify-center rounded-full bg-sidebar-accent text-sm font-semibold text-sidebar-accent-foreground">
                    {avatarInitial}
                  </div>
                  <div className="flex min-w-0 flex-1 flex-col items-start text-left group-data-[collapsible=icon]:hidden">
                    <span className="truncate text-sm font-medium">
                      {displayName}
                    </span>
                    {userEmail && (
                      <span className="truncate text-xs text-muted-foreground">
                        {userEmail}
                      </span>
                    )}
                  </div>
                  <ChevronUp className="ml-auto h-4 w-4 group-data-[collapsible=icon]:hidden" />
                </SidebarMenuButton>
              </DropdownMenuTrigger>
              <DropdownMenuContent
                side="top"
                align="start"
                className="w-[--radix-dropdown-menu-trigger-width] min-w-56"
              >
                <DropdownMenuItem asChild>
                  <Link href="/settings/integrations" className="flex items-center gap-2">
                    <Settings className="h-4 w-4" />
                    <span>Settings</span>
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <Link href="/settings/integrations" className="flex items-center gap-2">
                    <Plug className="h-4 w-4" />
                    <span>Add Integration</span>
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <Link href="/settings/skills" className="flex items-center gap-2">
                    <Sparkles className="h-4 w-4" />
                    <span>Add Skills</span>
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                {session?.user ? (
                  <DropdownMenuItem onClick={handleSignOut} className="text-destructive focus:text-destructive">
                    <LogOut className="h-4 w-4" />
                    <span>Log out</span>
                  </DropdownMenuItem>
                ) : (
                  <DropdownMenuItem asChild>
                    <Link href="/login" className="flex items-center gap-2">
                      <LogOut className="h-4 w-4" />
                      <span>Log in</span>
                    </Link>
                  </DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>

      <SidebarRail />
    </Sidebar>
  );
}
