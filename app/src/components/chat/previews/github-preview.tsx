import { PreviewProps, PreviewSection, PreviewContent, IntegrationLogo } from "./preview-styles";

export function GithubPreview({ operation, args }: PreviewProps) {
  switch (operation) {
    case "create-issue":
      return <GithubCreateIssuePreview args={args} />;
    default:
      return null;
  }
}

function GithubCreateIssuePreview({ args }: { args: Record<string, string | undefined> }) {
  const owner = args.o || args.owner;
  const repo = args.r || args.repo;
  const title = args.t || args.title;
  const body = args.b || args.body;
  const labels = args.labels;

  return (
    <div>
      <div className="mb-3 flex items-center gap-2">
        <IntegrationLogo integration="github" size={16} />
        <span className="text-sm font-medium">Create Issue</span>
      </div>

      <PreviewSection>
        <div className="bg-muted/30 rounded border p-3">
          <div className="text-muted-foreground mb-2 flex items-center gap-2 text-sm">
            <IntegrationLogo integration="github" size={16} />
            <span className="font-mono">
              {owner}/{repo}
            </span>
          </div>

          <div className="font-medium">{title || "Untitled Issue"}</div>

          {labels && (
            <div className="mt-2 flex gap-1">
              {labels.split(",").map((label) => (
                <span
                  key={label.trim()}
                  className="bg-muted inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium"
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
