"use client";

import { Link2, Share2, Trash2 } from "lucide-react";
import { useCallback, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { useConversation, useShareConversation, useUnshareConversation } from "@/orpc/hooks";

type ConversationShape = {
  isShared?: boolean;
  shareToken?: string | null;
};

type Props = {
  conversationId?: string;
};

function getShareUrl(token: string): string {
  if (typeof window === "undefined") {
    return `/shared/${token}`;
  }
  return `${window.location.origin}/shared/${token}`;
}

export function ChatShareControls({ conversationId }: Props) {
  const { data: conversation } = useConversation(conversationId);
  const shareConversation = useShareConversation();
  const unshareConversation = useUnshareConversation();

  const conv = conversation as ConversationShape | undefined;
  const isShared = conv?.isShared === true && !!conv?.shareToken;

  const shareUrl = useMemo(() => {
    if (!conv?.shareToken) {
      return null;
    }
    return getShareUrl(conv.shareToken);
  }, [conv?.shareToken]);

  const handleShare = useCallback(async () => {
    if (!conversationId) {
      return;
    }
    const result = await shareConversation.mutateAsync(conversationId);
    if (result.shareToken) {
      await navigator.clipboard.writeText(getShareUrl(result.shareToken));
    }
  }, [conversationId, shareConversation]);

  const handleCopyLink = useCallback(async () => {
    if (!shareUrl) {
      return;
    }
    await navigator.clipboard.writeText(shareUrl);
  }, [shareUrl]);

  const handleUnshare = useCallback(async () => {
    if (!conversationId) {
      return;
    }
    await unshareConversation.mutateAsync(conversationId);
  }, [conversationId, unshareConversation]);

  if (!conversationId) {
    return null;
  }

  return (
    <div className="ml-2 flex items-center gap-2">
      <span
        className={
          isShared
            ? "text-xs font-medium text-emerald-600"
            : "text-muted-foreground text-xs font-medium"
        }
      >
        {isShared ? "Shared" : "Private"}
      </span>
      {isShared ? (
        <>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={handleCopyLink}
            disabled={unshareConversation.isPending}
            title="Copy shared link"
          >
            <Link2 className="h-3.5 w-3.5" />
            Copy link
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={handleUnshare}
            disabled={unshareConversation.isPending}
            title="Stop sharing"
          >
            <Trash2 className="h-3.5 w-3.5" />
            {unshareConversation.isPending ? "Unsharing..." : "Unshare"}
          </Button>
        </>
      ) : (
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={handleShare}
          disabled={shareConversation.isPending}
          title="Create a public share link"
        >
          <Share2 className="h-3.5 w-3.5" />
          {shareConversation.isPending ? "Sharing..." : "Share"}
        </Button>
      )}
    </div>
  );
}
