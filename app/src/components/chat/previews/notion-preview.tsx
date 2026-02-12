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
      <div className="flex items-center gap-2 mb-3">
        <IntegrationLogo integration="notion" size={16} />
        <span className="text-sm font-medium">Create Page</span>
      </div>

      <PreviewSection>
        <div className="rounded border bg-white dark:bg-muted/30 p-4">
          <div className="font-medium text-lg mb-2">{title || "Untitled"}</div>

          {parent && (
            <div className="text-xs text-muted-foreground mb-2">
              In: <span className="font-mono">{parent}</span>
            </div>
          )}

          {content && (
            <div className="text-sm text-muted-foreground whitespace-pre-wrap border-t pt-2 mt-2">
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
      <div className="flex items-center gap-2 mb-3">
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
