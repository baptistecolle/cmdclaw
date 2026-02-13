import {
  PreviewProps,
  PreviewField,
  PreviewSection,
  PreviewContent,
  IntegrationLogo,
} from "./preview-styles";

export function NotionPreview({ operation, args, positionalArgs }: PreviewProps) {
  switch (operation) {
    case "create":
      return <NotionCreatePreview args={args} />;
    case "append":
      return <NotionAppendPreview args={args} positionalArgs={positionalArgs} />;
    default:
      return null;
  }
}

function NotionCreatePreview({ args }: { args: Record<string, string | undefined> }) {
  const parent = args.parent;
  const title = args.title;
  const content = args.content;

  return (
    <div>
      <div className="mb-3 flex items-center gap-2">
        <IntegrationLogo integration="notion" size={16} />
        <span className="text-sm font-medium">Create Page</span>
      </div>

      <PreviewSection>
        <div className="dark:bg-muted/30 rounded border bg-white p-4">
          <div className="mb-2 text-lg font-medium">{title || "Untitled"}</div>

          {parent && (
            <div className="text-muted-foreground mb-2 text-xs">
              In: <span className="font-mono">{parent}</span>
            </div>
          )}

          {content && (
            <div className="text-muted-foreground mt-2 border-t pt-2 text-sm whitespace-pre-wrap">
              {content}
            </div>
          )}
        </div>
      </PreviewSection>
    </div>
  );
}

function NotionAppendPreview({
  args,
  positionalArgs,
}: {
  args: Record<string, string | undefined>;
  positionalArgs: string[];
}) {
  const pageId = positionalArgs[0];
  const content = args.content;

  return (
    <div>
      <div className="mb-3 flex items-center gap-2">
        <IntegrationLogo integration="notion" size={16} />
        <span className="text-sm font-medium">Append to Page</span>
      </div>

      <PreviewSection>
        <PreviewField label="Page ID" value={pageId} mono />
      </PreviewSection>

      {content && (
        <PreviewSection title="Content to Append">
          <PreviewContent>{content}</PreviewContent>
        </PreviewSection>
      )}
    </div>
  );
}
