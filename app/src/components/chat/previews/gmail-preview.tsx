import {
  PreviewProps,
  IntegrationLogo,
} from "./preview-styles";

export function GmailPreview({ operation, args }: PreviewProps) {
  switch (operation) {
    case "send":
      return <GmailSendPreview args={args} />;
    default:
      return null;
  }
}

function GmailSendPreview({
  args,
}: {
  args: Record<string, string | undefined>;
}) {
  const to = args.to;
  const cc = args.cc;
  const bcc = args.bcc;
  const subject = args.subject;
  const body = args.body;

  return (
    <div>
      <div className="flex items-center gap-2 mb-3">
        <IntegrationLogo integration="gmail" size={16} />
        <span className="text-sm font-medium">Send Email</span>
      </div>

      {/* Email header style */}
      <div className="rounded-t border border-b-0 bg-muted/50 p-3 text-sm">
        <div className="grid grid-cols-[60px_1fr] gap-1">
          <span className="text-muted-foreground">To:</span>
          <span className="font-medium">{to || "—"}</span>

          {cc && (
            <>
              <span className="text-muted-foreground">Cc:</span>
              <span>{cc}</span>
            </>
          )}

          {bcc && (
            <>
              <span className="text-muted-foreground">Bcc:</span>
              <span>{bcc}</span>
            </>
          )}

          <span className="text-muted-foreground">Subject:</span>
          <span className="font-medium">{subject || "(no subject)"}</span>
        </div>
      </div>

      {/* Email body */}
      <div className="rounded-b border bg-background p-3">
        <div className="text-sm whitespace-pre-wrap">
          {body || "(no content)"}
        </div>
      </div>
    </div>
  );
}
