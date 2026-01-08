"use client";

import { ChatArea } from "@/components/chat/chat-area";
import { use } from "react";

type Props = {
  params: Promise<{ conversationId: string }>;
};

export default function ConversationPage({ params }: Props) {
  const { conversationId } = use(params);
  return <ChatArea conversationId={conversationId} />;
}
