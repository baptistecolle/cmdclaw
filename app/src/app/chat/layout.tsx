"use client";

import { ChatSidebar } from "@/components/chat/chat-sidebar";
import { AppShell } from "@/components/app-shell";
import {
  SidebarProvider,
  SidebarInset,
  SidebarTrigger,
} from "@/components/animate-ui/components/radix/sidebar";
import { useIsAdmin } from "@/hooks/use-is-admin";
import { useConversation, useCurrentUser } from "@/orpc/hooks";
import { useParams, useRouter } from "next/navigation";
import { Copy, Check, Loader2 } from "lucide-react";
import { useState, useEffect } from "react";

type Message = {
  role: string;
  content: string;
  toolCalls?: {
    id: string;
    name: string;
    input: Record<string, unknown>;
    result?: unknown;
  }[];
};

function formatChatToMarkdown(messages: Message[], title?: string): string {
  const lines: string[] = [];

  if (title) {
    lines.push(`# ${title}`, "");
  }

  for (const msg of messages) {
    const roleLabel = msg.role === "user" ? "**User**" : "**Assistant**";
    lines.push(roleLabel);
    lines.push(msg.content);

    if (msg.toolCalls && msg.toolCalls.length > 0) {
      lines.push("");
      lines.push("*Tool calls:*");
      for (const tc of msg.toolCalls) {
        lines.push(`- \`${tc.name}\``);
        if (tc.result !== undefined) {
          const resultStr =
            typeof tc.result === "string" ? tc.result : JSON.stringify(tc.result, null, 2);
          lines.push("  ```");
          lines.push(`  ${resultStr.split("\n").join("\n  ")}`);
          lines.push("  ```");
        }
      }
    }

    lines.push("");
    lines.push("---");
    lines.push("");
  }

  return lines.join("\n");
}

function CopyButton() {
  const params = useParams();
  const conversationId = params?.conversationId as string | undefined;
  const { data: conversation } = useConversation(conversationId);
  const [copied, setCopied] = useState(false);

  if (!conversationId || !conversation) return null;

  const conv = conversation as {
    title?: string;
    messages?: Message[];
  };

  const handleCopy = async () => {
    if (!conv.messages) return;

    const markdown = formatChatToMarkdown(conv.messages, conv.title);
    await navigator.clipboard.writeText(markdown);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <button
      onClick={handleCopy}
      className="ml-auto flex items-center gap-1.5 rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
      title="Copy chat as Markdown"
    >
      {copied ? (
        <>
          <Check className="h-3.5 w-3.5" />
          Copied
        </>
      ) : (
        <>
          <Copy className="h-3.5 w-3.5" />
          Copy
        </>
      )}
    </button>
  );
}

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
      <div className="flex h-screen items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
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
              <span className="text-xs text-muted-foreground font-mono">ID: {conversationId}</span>
            )}
            {isAdmin && <CopyButton />}
          </header>
          <div className="flex h-[calc(100vh-3.5rem)] flex-col overflow-hidden">{children}</div>
        </SidebarInset>
      </SidebarProvider>
    </AppShell>
  );
}
