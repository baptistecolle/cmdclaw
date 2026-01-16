import { Grid3X3, Plus, Edit, Trash2 } from "lucide-react";
import {
  PreviewProps,
  PreviewField,
  PreviewSection,
  PreviewBadge,
} from "./preview-styles";

export function AirtablePreview({
  operation,
  args,
}: PreviewProps) {
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
      <div className="flex items-center gap-2 mb-3">
        <Plus className="h-4 w-4 text-blue-400" />
        <span className="text-sm font-medium">Create Record</span>
      </div>

      <PreviewSection>
        <div className="flex items-center gap-2 text-sm text-muted-foreground mb-2">
          <Grid3X3 className="h-4 w-4 text-blue-400" />
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
      <div className="flex items-center gap-2 mb-3">
        <Edit className="h-4 w-4 text-blue-400" />
        <span className="text-sm font-medium">Update Record</span>
      </div>

      <PreviewSection>
        <div className="flex items-center gap-2 text-sm text-muted-foreground mb-2">
          <Grid3X3 className="h-4 w-4 text-blue-400" />
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
      <div className="flex items-center gap-2 mb-3">
        <Trash2 className="h-4 w-4 text-red-500" />
        <span className="text-sm font-medium">Delete Record</span>
        <PreviewBadge variant="danger">Destructive</PreviewBadge>
      </div>

      <PreviewSection>
        <div className="flex items-center gap-2 text-sm text-muted-foreground mb-2">
          <Grid3X3 className="h-4 w-4 text-blue-400" />
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
  try {
    const parsed = JSON.parse(fields);
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
    <pre className="rounded bg-muted p-2 text-xs overflow-x-auto">{fields}</pre>
  );
}
