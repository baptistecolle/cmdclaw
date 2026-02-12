"use client";

import { ChatArea } from "@/components/chat/chat-area";
import { use, useEffect } from "react";
import { useSearchParams } from "next/navigation";
import { client } from "@/orpc/client";

type Props = {
  params: Promise<{ conversationId: string }>;
};

export default function ConversationPage({ params }: Props) {
  const { conversationId } = use(params);
  const searchParams = useSearchParams();

  // Handle OAuth callback
  useEffect(() => {
    const authComplete = searchParams.get("auth_complete");
    const generationId = searchParams.get("generation_id");

    if (authComplete && generationId) {
      // Notify server that auth is complete
      client.generation
        .submitAuthResult({
          generationId,
          integration: authComplete,
          success: true,
        })
        .then(() => {
          // Clear URL params
          window.history.replaceState({}, "", `/chat/${conversationId}`);
        })
        .catch((err) => {
          console.error("Failed to submit auth result:", err);
        });
    }
  }, [searchParams, conversationId]);

  return <ChatArea conversationId={conversationId} />;
}
