import {
  PreviewProps,
  PreviewField,
  PreviewSection,
  IntegrationLogo,
} from "./preview-styles";

type HubSpotObjectType =
  | "contacts"
  | "companies"
  | "deals"
  | "tickets"
  | "tasks"
  | "notes";

const OBJECT_LABELS: Record<HubSpotObjectType, string> = {
  contacts: "Contact",
  companies: "Company",
  deals: "Deal",
  tickets: "Ticket",
  tasks: "Task",
  notes: "Note",
};

export function HubspotPreview({ operation, args }: PreviewProps) {
  // Parse operation: "contacts.create" -> { object: "contacts", action: "create" }
  const [objectType, action] = operation.split(".") as [
    HubSpotObjectType,
    string,
  ];

  if (!objectType || !action) return null;

  const objectLabel = OBJECT_LABELS[objectType] || objectType;

  switch (action) {
    case "create":
      return (
        <HubspotCreatePreview
          args={args}
          objectType={objectType}
          objectLabel={objectLabel}
        />
      );
    case "update":
      return <HubspotUpdatePreview args={args} objectLabel={objectLabel} />;
    case "complete":
      return <HubspotCompletePreview args={args} objectLabel={objectLabel} />;
    default:
      return null;
  }
}

interface HubspotPreviewComponentProps {
  args: Record<string, string | undefined>;
  objectType?: HubSpotObjectType;
  objectLabel: string;
}

function HubspotCreatePreview({
  args,
  objectType,
  objectLabel,
}: HubspotPreviewComponentProps) {
  // Extract common fields based on object type
  const fields = getDisplayFields(objectType!, args);

  return (
    <div>
      <div className="flex items-center gap-2 mb-3">
        <IntegrationLogo integration="hubspot" size={16} />
        <span className="text-sm font-medium">Create {objectLabel}</span>
      </div>

      <PreviewSection>
        <div className="rounded border bg-muted/30 p-3">
          <div className="flex items-center gap-2 mb-2">
            <IntegrationLogo integration="hubspot" size={16} />
            <span className="font-medium">
              {getPrimaryField(objectType!, args)}
            </span>
          </div>

          {fields.map(([label, value]) =>
            value ? (
              <PreviewField key={label} label={label} value={value} />
            ) : null,
          )}
        </div>
      </PreviewSection>

      {args.properties && (
        <PreviewSection title="Additional Properties">
          <PropertiesPreview properties={args.properties} />
        </PreviewSection>
      )}
    </div>
  );
}

function HubspotUpdatePreview({
  args,
  objectLabel,
}: Omit<HubspotPreviewComponentProps, "objectType">) {
  // The first positional arg after "hubspot <object> update" is the ID
  const id = args.id;

  return (
    <div>
      <div className="flex items-center gap-2 mb-3">
        <IntegrationLogo integration="hubspot" size={16} />
        <span className="text-sm font-medium">Update {objectLabel}</span>
      </div>

      <PreviewSection>
        <div className="flex items-center gap-2 text-sm text-muted-foreground mb-2">
          <IntegrationLogo integration="hubspot" size={16} />
          <span className="font-mono">{id || "Unknown ID"}</span>
        </div>
      </PreviewSection>

      {args.properties && (
        <PreviewSection title="Updated Properties">
          <PropertiesPreview properties={args.properties} />
        </PreviewSection>
      )}
    </div>
  );
}

function HubspotCompletePreview({
  args,
  objectLabel,
}: Omit<HubspotPreviewComponentProps, "objectType">) {
  const id = args.id;

  return (
    <div>
      <div className="flex items-center gap-2 mb-3">
        <IntegrationLogo integration="hubspot" size={16} />
        <span className="text-sm font-medium">Complete {objectLabel}</span>
      </div>

      <PreviewSection>
        <PreviewField label="Task ID" value={id} mono />
      </PreviewSection>
    </div>
  );
}

function getPrimaryField(
  objectType: HubSpotObjectType,
  args: Record<string, string | undefined>,
): string {
  switch (objectType) {
    case "contacts":
      if (args.firstname && args.lastname) {
        return `${args.firstname} ${args.lastname}`;
      }
      return args.email || args.firstname || "New Contact";
    case "companies":
      return args.name || "New Company";
    case "deals":
      return args.name || "New Deal";
    case "tickets":
      return args.subject || "New Ticket";
    case "tasks":
      return args.subject || "New Task";
    case "notes":
      return args.body?.slice(0, 50) || "New Note";
    default:
      return "New Record";
  }
}

function getDisplayFields(
  objectType: HubSpotObjectType,
  args: Record<string, string | undefined>,
): [string, string | undefined][] {
  switch (objectType) {
    case "contacts":
      return [
        ["Email", args.email],
        ["Company", args.company],
        ["Phone", args.phone],
      ];
    case "companies":
      return [
        ["Domain", args.domain],
        ["Industry", args.industry],
      ];
    case "deals":
      return [
        ["Pipeline", args.pipeline],
        ["Stage", args.stage],
        ["Amount", args.amount],
      ];
    case "tickets":
      return [
        ["Pipeline", args.pipeline],
        ["Stage", args.stage],
      ];
    case "tasks":
      return [["Due", args.due]];
    case "notes":
      return [
        ["Contact", args.contact],
        ["Company", args.company],
        ["Deal", args.deal],
      ];
    default:
      return [];
  }
}

function PropertiesPreview({ properties }: { properties: string }) {
  try {
    const parsed = JSON.parse(properties);
    if (typeof parsed === "object" && parsed !== null) {
      return (
        <div className="rounded border bg-muted/30 divide-y">
          {Object.entries(parsed).map(([key, value]) => (
            <div key={key} className="flex px-3 py-2 text-sm">
              <span className="font-medium text-muted-foreground w-32 shrink-0">
                {key}
              </span>
              <span className="break-words">{String(value)}</span>
            </div>
          ))}
        </div>
      );
    }
  } catch {
    // Fall through to raw display
  }

  return (
    <pre className="rounded bg-muted p-2 text-xs overflow-x-auto">
      {properties}
    </pre>
  );
}
