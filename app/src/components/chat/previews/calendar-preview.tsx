import { Calendar } from "lucide-react";
import {
  PreviewProps,
  PreviewField,
  PreviewSection,
  PreviewContent,
  PreviewBadge,
  IntegrationLogo,
} from "./preview-styles";

export function CalendarPreview({ operation, args, positionalArgs }: PreviewProps) {
  switch (operation) {
    case "create":
      return <CalendarCreatePreview args={args} />;
    case "update":
      return <CalendarUpdatePreview args={args} positionalArgs={positionalArgs} />;
    case "delete":
      return <CalendarDeletePreview positionalArgs={positionalArgs} />;
    default:
      return null;
  }
}

function CalendarCreatePreview({ args }: { args: Record<string, string | undefined> }) {
  const summary = args.summary;
  const start = args.start;
  const end = args.end;
  const description = args.description;
  const location = args.location;

  return (
    <div>
      <div className="mb-3 flex items-center gap-2">
        <IntegrationLogo integration="google_calendar" size={16} />
        <span className="text-sm font-medium">Create Event</span>
      </div>

      <PreviewSection>
        <div className="bg-muted/30 rounded border p-3">
          <div className="mb-2 text-base font-medium">{summary || "Untitled Event"}</div>

          <div className="space-y-1 text-sm">
            {(start || end) && (
              <div className="text-muted-foreground flex items-center gap-2">
                <Calendar className="h-3.5 w-3.5" />
                <span>
                  {formatDateTime(start)} {end && `— ${formatDateTime(end)}`}
                </span>
              </div>
            )}

            {location && <PreviewField label="Location" value={location} />}
          </div>
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

function CalendarUpdatePreview({
  args,
  positionalArgs,
}: {
  args: Record<string, string | undefined>;
  positionalArgs: string[];
}) {
  const eventId = positionalArgs[0];

  return (
    <div>
      <div className="mb-3 flex items-center gap-2">
        <IntegrationLogo integration="google_calendar" size={16} />
        <span className="text-sm font-medium">Update Event</span>
      </div>

      <PreviewSection>
        <PreviewField label="Event ID" value={eventId} mono />
      </PreviewSection>

      <PreviewSection title="Changes">
        {args.summary && <PreviewField label="Title" value={args.summary} />}
        {args.start && <PreviewField label="Start" value={formatDateTime(args.start)} />}
        {args.end && <PreviewField label="End" value={formatDateTime(args.end)} />}
        {args.description && <PreviewField label="Description" value={args.description} />}
        {args.location && <PreviewField label="Location" value={args.location} />}
      </PreviewSection>
    </div>
  );
}

function CalendarDeletePreview({ positionalArgs }: { positionalArgs: string[] }) {
  const eventId = positionalArgs[0];

  return (
    <div>
      <div className="mb-3 flex items-center gap-2">
        <IntegrationLogo integration="google_calendar" size={16} />
        <span className="text-sm font-medium">Delete Event</span>
        <PreviewBadge variant="danger">Destructive</PreviewBadge>
      </div>

      <PreviewSection>
        <PreviewField label="Event ID" value={eventId} mono />
      </PreviewSection>
    </div>
  );
}

function formatDateTime(datetime: string | undefined): string {
  if (!datetime) {
    return "";
  }
  try {
    const date = new Date(datetime);
    return date.toLocaleString();
  } catch {
    return datetime;
  }
}
