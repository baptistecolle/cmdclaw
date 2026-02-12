import {
  PreviewProps,
  PreviewField,
  PreviewSection,
  PreviewContent,
  IntegrationLogo,
} from "./preview-styles";

export function GithubPreview({ operation, args }: PreviewProps) {
  switch (operation) {
    case "create-issue":
      return <GithubCreateIssuePreview args={args} />;
    default:
      return null;
  }
}

function GithubCreateIssuePreview({
  args,
}: {
  args: Record<string, string | undefined>;
}) {
  const owner = args.o || args.owner;
  const repo = args.r || args.repo;
  const title = args.t || args.title;
  const body = args.b || args.body;
  const labels = args.labels;

  return (
    <div>
      <div className="flex items-center gap-2 mb-3">
        <IntegrationLogo integration="github" size={16} />
        <span className="text-sm font-medium">Create Issue</span>
      </div>

      <PreviewSection>
        <div className="rounded border bg-muted/30 p-3">
          <div className="flex items-center gap-2 text-sm text-muted-foreground mb-2">
            <IntegrationLogo integration="github" size={16} />
            <span className="font-mono">
              {owner}/{repo}
            </span>
          </div>

          <div className="font-medium">{title || "Untitled Issue"}</div>

          {labels && (
            <div className="flex gap-1 mt-2">
              {labels.split(",").map((label) => (
                <span
                  key={label.trim()}
                  className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium bg-muted"
                >
                  {label.trim()}
                </span>
              ))}
            </div>
          )}
        </div>
      </PreviewSection>

      {body && (
        <PreviewSection title="Description">
          <PreviewContent>{body}</PreviewContent>
        </PreviewSection>
      )}
    </div>
  );
}
