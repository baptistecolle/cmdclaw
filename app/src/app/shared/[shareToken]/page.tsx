import { and, asc, eq } from "drizzle-orm";
import { notFound } from "next/navigation";
import { SharedConversationView } from "@/components/chat/shared-conversation-view";
import { db } from "@/server/db/client";
import { conversation, message } from "@/server/db/schema";
import { getPresignedDownloadUrl } from "@/server/storage/s3-client";

type Props = {
  params: Promise<{ shareToken: string }>;
};

export default async function SharedConversationPage({ params }: Props) {
  const { shareToken } = await params;

  const conv = await db.query.conversation.findFirst({
    where: and(eq(conversation.shareToken, shareToken), eq(conversation.isShared, true)),
    with: {
      messages: {
        orderBy: asc(message.createdAt),
        with: {
          attachments: true,
          sandboxFiles: true,
        },
      },
    },
  });

  if (!conv) {
    notFound();
  }

  const visibleMessages = conv.messages.filter((m) => m.role === "user" || m.role === "assistant");

  const sharedMessages = await Promise.all(
    visibleMessages.map(async (msg) => ({
      id: msg.id,
      role: msg.role,
      content: msg.content,
      contentParts: msg.contentParts,
      timing: msg.timing,
      attachments: await Promise.all(
        (msg.attachments ?? []).map(async (attachment) => ({
          filename: attachment.filename,
          mimeType: attachment.mimeType,
          dataUrl: await getPresignedDownloadUrl(attachment.storageKey),
        })),
      ),
      sandboxFiles: await Promise.all(
        (msg.sandboxFiles ?? []).map(async (file) => ({
          fileId: file.id,
          path: file.path,
          filename: file.filename,
          mimeType: file.mimeType,
          sizeBytes: file.sizeBytes,
          downloadUrl: file.storageKey ? await getPresignedDownloadUrl(file.storageKey) : null,
        })),
      ),
    })),
  );

  return (
    <SharedConversationView title={conv.title ?? "Shared conversation"} messages={sharedMessages} />
  );
}
