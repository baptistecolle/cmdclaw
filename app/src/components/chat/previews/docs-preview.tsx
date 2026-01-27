import {
  PreviewProps,
  PreviewField,
  PreviewSection,
  PreviewContent,
  IntegrationLogo,
} from "./preview-styles";

export function DocsPreview({
  operation,
  args,
  positionalArgs,
}: PreviewProps) {
  switch (operation) {
    case "create":
      return <DocsCreatePreview args={args} />;
    case "append":
      return <DocsAppendPreview args={args} positionalArgs={positionalArgs} />;
    default:
      return null;
  }
}

function DocsCreatePreview({ args }: { args: Record<string, string | undefined> }) {
  const title = args.title;
  const content = args.content;

  return (
    <div>
      <div className="flex items-center gap-2 mb-3">
        <IntegrationLogo integration="google_docs" size={16} />
        <span className="text-sm font-medium">Create Document</span>
      </div>

      <PreviewSection>
        <div className="rounded border bg-white dark:bg-muted/30 p-4">
          <div className="font-medium text-lg mb-2 pb-2 border-b">
            {title || "Untitled Document"}
          </div>

          {content && (
            <div className="text-sm text-muted-foreground whitespace-pre-wrap">
              {content}
            </div>
          )}

          {!content && (
            <div className="text-sm text-muted-foreground italic">
              Empty document
            </div>
          )}
        </div>
      </PreviewSection>
    </div>
  );
}

function DocsAppendPreview({
  args,
  positionalArgs,
}: {
  args: Record<string, string | undefined>;
  positionalArgs: string[];
}) {
  const documentId = positionalArgs[0];
  const text = args.text;

  return (
    <div>
      <div className="flex items-center gap-2 mb-3">
        <IntegrationLogo integration="google_docs" size={16} />
        <span className="text-sm font-medium">Append to Document</span>
      </div>

      <PreviewSection>
        <PreviewField label="Document ID" value={documentId} mono />
      </PreviewSection>

      {text && (
        <PreviewSection title="Content to Append">
          <PreviewContent>{text}</PreviewContent>
        </PreviewSection>
      )}
    </div>
  );
}
