import {
  PreviewProps,
  PreviewField,
  PreviewSection,
  PreviewContent,
  PreviewBadge,
  IntegrationLogo,
} from "./preview-styles";

export function LinearPreview({
  operation,
  args,
  positionalArgs,
}: PreviewProps) {
  switch (operation) {
    case "create":
      return <LinearCreatePreview args={args} />;
    case "update":
      return <LinearUpdatePreview args={args} positionalArgs={positionalArgs} />;
    default:
      return null;
  }
}

function LinearCreatePreview({ args }: { args: Record<string, string | undefined> }) {
  const team = args.team || args.t;
  const title = args.title;
  const description = args.d || args.description;
  const priority = args.p || args.priority;

  const priorityLabels: Record<string, { label: string; variant: "default" | "warning" | "danger" }> = {
    "0": { label: "No Priority", variant: "default" },
    "1": { label: "Urgent", variant: "danger" },
    "2": { label: "High", variant: "warning" },
    "3": { label: "Medium", variant: "default" },
    "4": { label: "Low", variant: "default" },
  };

  const priorityInfo = priority ? priorityLabels[priority] : undefined;

  return (
    <div>
      <div className="flex items-center gap-2 mb-3">
        <IntegrationLogo integration="linear" size={16} />
        <span className="text-sm font-medium">Create Issue</span>
      </div>

      <PreviewSection>
        <div className="rounded border bg-muted/30 p-3">
          <div className="flex items-center gap-2 mb-2">
            <IntegrationLogo integration="linear" size={16} />
            <span className="font-medium">{title || "Untitled Issue"}</span>
            {priorityInfo && (
              <PreviewBadge variant={priorityInfo.variant}>
                {priorityInfo.label}
              </PreviewBadge>
            )}
          </div>

          {team && (
            <div className="text-xs text-muted-foreground">
              Team: <span className="font-mono">{team}</span>
            </div>
          )}
        </div>
      </PreviewSection>

      {description && (
        <PreviewSection title="Description">
          <PreviewContent>{description}</PreviewContent>
        </PreviewSection>
      )}
    </div>
  );
}

function LinearUpdatePreview({
  args,
  positionalArgs,
}: {
  args: Record<string, string | undefined>;
  positionalArgs: string[];
}) {
  const identifier = positionalArgs[0];
  const title = args.title;
  const state = args.state;
  const priority = args.priority;

  return (
    <div>
      <div className="flex items-center gap-2 mb-3">
        <IntegrationLogo integration="linear" size={16} />
        <span className="text-sm font-medium">Update Issue</span>
      </div>

      <PreviewSection>
        <PreviewField label="Issue" value={identifier} mono />
      </PreviewSection>

      <PreviewSection title="Changes">
        {title && <PreviewField label="Title" value={title} />}
        {state && <PreviewField label="State" value={state} />}
        {priority && <PreviewField label="Priority" value={priority} />}
      </PreviewSection>
    </div>
  );
}
