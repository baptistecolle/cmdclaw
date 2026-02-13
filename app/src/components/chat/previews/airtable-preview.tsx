import {
  PreviewProps,
  PreviewField,
  PreviewSection,
  PreviewBadge,
  IntegrationLogo,
} from "./preview-styles";

export function AirtablePreview({ operation, args }: PreviewProps) {
  switch (operation) {
    case "create":
      return <AirtableCreatePreview args={args} />;
    case "update":
      return <AirtableUpdatePreview args={args} />;
    case "delete":
      return <AirtableDeletePreview args={args} />;
    default:
      return null;
  }
}

function AirtableCreatePreview({ args }: { args: Record<string, string | undefined> }) {
  const baseId = args.b || args.base;
  const table = args.t || args.table;
  const fields = args.fields;

  return (
    <div>
      <div className="mb-3 flex items-center gap-2">
        <IntegrationLogo integration="airtable" size={16} />
        <span className="text-sm font-medium">Create Record</span>
      </div>

      <PreviewSection>
        <div className="text-muted-foreground mb-2 flex items-center gap-2 text-sm">
          <IntegrationLogo integration="airtable" size={16} />
          <span className="font-mono">{baseId}</span>
          <span>/</span>
          <span>{table}</span>
        </div>
      </PreviewSection>

      {fields && (
        <PreviewSection title="Fields">
          <FieldsPreview fields={fields} />
        </PreviewSection>
      )}
    </div>
  );
}

function AirtableUpdatePreview({ args }: { args: Record<string, string | undefined> }) {
  const baseId = args.b || args.base;
  const table = args.t || args.table;
  const recordId = args.r || args.record;
  const fields = args.fields;

  return (
    <div>
      <div className="mb-3 flex items-center gap-2">
        <IntegrationLogo integration="airtable" size={16} />
        <span className="text-sm font-medium">Update Record</span>
      </div>

      <PreviewSection>
        <div className="text-muted-foreground mb-2 flex items-center gap-2 text-sm">
          <IntegrationLogo integration="airtable" size={16} />
          <span className="font-mono">{baseId}</span>
          <span>/</span>
          <span>{table}</span>
        </div>
        <PreviewField label="Record" value={recordId} mono />
      </PreviewSection>

      {fields && (
        <PreviewSection title="Updated Fields">
          <FieldsPreview fields={fields} />
        </PreviewSection>
      )}
    </div>
  );
}

function AirtableDeletePreview({ args }: { args: Record<string, string | undefined> }) {
  const baseId = args.b || args.base;
  const table = args.t || args.table;
  const recordId = args.r || args.record;

  return (
    <div>
      <div className="mb-3 flex items-center gap-2">
        <IntegrationLogo integration="airtable" size={16} />
        <span className="text-sm font-medium">Delete Record</span>
        <PreviewBadge variant="danger">Destructive</PreviewBadge>
      </div>

      <PreviewSection>
        <div className="text-muted-foreground mb-2 flex items-center gap-2 text-sm">
          <IntegrationLogo integration="airtable" size={16} />
          <span className="font-mono">{baseId}</span>
          <span>/</span>
          <span>{table}</span>
        </div>
        <PreviewField label="Record" value={recordId} mono />
      </PreviewSection>
    </div>
  );
}

function FieldsPreview({ fields }: { fields: string }) {
  let parsed: unknown;
  try {
    parsed = JSON.parse(fields);
  } catch {
    // Fall through to raw display
  }

  if (typeof parsed === "object" && parsed !== null) {
    return (
      <div className="bg-muted/30 divide-y rounded border">
        {Object.entries(parsed).map(([key, value]) => (
          <div key={key} className="flex px-3 py-2 text-sm">
            <span className="text-muted-foreground w-32 shrink-0 font-medium">{key}</span>
            <span className="break-words">{String(value)}</span>
          </div>
        ))}
      </div>
    );
  }

  return <pre className="bg-muted overflow-x-auto rounded p-2 text-xs">{fields}</pre>;
}
