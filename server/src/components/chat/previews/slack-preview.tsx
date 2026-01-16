import {
  PreviewProps,
  PreviewField,
  PreviewSection,
  PreviewContent,
  PreviewBadge,
  IntegrationLogo,
} from "./preview-styles";

export function SlackPreview({
  operation,
  args,
}: PreviewProps) {
  switch (operation) {
    case "send":
      return <SlackSendPreview args={args} />;
    case "react":
      return <SlackReactPreview args={args} />;
    case "upload":
      return <SlackUploadPreview args={args} />;
    default:
      return null;
  }
}

function SlackSendPreview({ args }: { args: Record<string, string | undefined> }) {
  const channel = args.c || args.channel;
  const text = args.t || args.text;
  const thread = args.thread;

  return (
    <div>
      <div className="flex items-center gap-2 mb-3">
        <IntegrationLogo integration="slack" size={16} />
        <span className="text-sm font-medium">
          {thread ? "Reply to Thread" : "Send Message"}
        </span>
        {thread && <PreviewBadge>In Thread</PreviewBadge>}
      </div>

      <PreviewSection>
        <PreviewField label="Channel" value={channel} mono />
        {thread && <PreviewField label="Thread" value={thread} mono />}
      </PreviewSection>

      {text && (
        <PreviewSection title="Message">
          <PreviewContent>{text}</PreviewContent>
        </PreviewSection>
      )}
    </div>
  );
}

function SlackReactPreview({ args }: { args: Record<string, string | undefined> }) {
  const channel = args.c || args.channel;
  const timestamp = args.ts;
  const emoji = args.e || args.emoji;

  return (
    <div>
      <div className="flex items-center gap-2 mb-3">
        <IntegrationLogo integration="slack" size={16} />
        <span className="text-sm font-medium">Add Reaction</span>
      </div>

      <PreviewSection>
        <PreviewField label="Channel" value={channel} mono />
        <PreviewField label="Message" value={timestamp} mono />
        <div className="mt-2">
          <span className="text-xs font-medium text-muted-foreground">Emoji: </span>
          <span className="text-lg">:{emoji}:</span>
        </div>
      </PreviewSection>
    </div>
  );
}

function SlackUploadPreview({ args }: { args: Record<string, string | undefined> }) {
  const channel = args.c || args.channel;
  const file = args.file;
  const comment = args.comment;

  return (
    <div>
      <div className="flex items-center gap-2 mb-3">
        <IntegrationLogo integration="slack" size={16} />
        <span className="text-sm font-medium">Upload File</span>
      </div>

      <PreviewSection>
        <PreviewField label="Channel" value={channel} mono />
        <PreviewField label="File" value={file} />
      </PreviewSection>

      {comment && (
        <PreviewSection title="Comment">
          <PreviewContent>{comment}</PreviewContent>
        </PreviewSection>
      )}
    </div>
  );
}
