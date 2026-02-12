import {
  PreviewProps,
  PreviewField,
  PreviewSection,
  PreviewContent,
  PreviewBadge,
  IntegrationLogo,
} from "./preview-styles";

export function SheetsPreview({
  operation,
  args,
  positionalArgs,
}: PreviewProps) {
  switch (operation) {
    case "create":
      return <SheetsCreatePreview args={args} />;
    case "append":
      return (
        <SheetsAppendPreview args={args} positionalArgs={positionalArgs} />
      );
    case "update":
      return (
        <SheetsUpdatePreview args={args} positionalArgs={positionalArgs} />
      );
    case "clear":
      return <SheetsClearPreview args={args} positionalArgs={positionalArgs} />;
    case "add-sheet":
      return (
        <SheetsAddSheetPreview args={args} positionalArgs={positionalArgs} />
      );
    default:
      return null;
  }
}

function SheetsCreatePreview({
  args,
}: {
  args: Record<string, string | undefined>;
}) {
  const title = args.title;

  return (
    <div>
      <div className="flex items-center gap-2 mb-3">
        <IntegrationLogo integration="google_sheets" size={16} />
        <span className="text-sm font-medium">Create Spreadsheet</span>
      </div>

      <PreviewSection>
        <div className="rounded border bg-muted/30 p-3 flex items-center gap-2">
          <IntegrationLogo integration="google_sheets" size={20} />
          <span className="font-medium">{title || "Untitled Spreadsheet"}</span>
        </div>
      </PreviewSection>
    </div>
  );
}

function SheetsAppendPreview({
  args,
  positionalArgs,
}: {
  args: Record<string, string | undefined>;
  positionalArgs: string[];
}) {
  const spreadsheetId = positionalArgs[0];
  const range = args.range;
  const values = args.values;

  return (
    <div>
      <div className="flex items-center gap-2 mb-3">
        <IntegrationLogo integration="google_sheets" size={16} />
        <span className="text-sm font-medium">Append Rows</span>
      </div>

      <PreviewSection>
        <PreviewField label="Spreadsheet" value={spreadsheetId} mono />
        <PreviewField label="Range" value={range} mono />
      </PreviewSection>

      {values && (
        <PreviewSection title="Data">
          <ValuesPreview values={values} />
        </PreviewSection>
      )}
    </div>
  );
}

function SheetsUpdatePreview({
  args,
  positionalArgs,
}: {
  args: Record<string, string | undefined>;
  positionalArgs: string[];
}) {
  const spreadsheetId = positionalArgs[0];
  const range = args.range;
  const values = args.values;

  return (
    <div>
      <div className="flex items-center gap-2 mb-3">
        <IntegrationLogo integration="google_sheets" size={16} />
        <span className="text-sm font-medium">Update Cells</span>
      </div>

      <PreviewSection>
        <PreviewField label="Spreadsheet" value={spreadsheetId} mono />
        <PreviewField label="Range" value={range} mono />
      </PreviewSection>

      {values && (
        <PreviewSection title="New Values">
          <ValuesPreview values={values} />
        </PreviewSection>
      )}
    </div>
  );
}

function SheetsClearPreview({
  args,
  positionalArgs,
}: {
  args: Record<string, string | undefined>;
  positionalArgs: string[];
}) {
  const spreadsheetId = positionalArgs[0];
  const range = args.range;

  return (
    <div>
      <div className="flex items-center gap-2 mb-3">
        <IntegrationLogo integration="google_sheets" size={16} />
        <span className="text-sm font-medium">Clear Cells</span>
        <PreviewBadge variant="danger">Destructive</PreviewBadge>
      </div>

      <PreviewSection>
        <PreviewField label="Spreadsheet" value={spreadsheetId} mono />
        <PreviewField label="Range" value={range} mono />
      </PreviewSection>
    </div>
  );
}

function SheetsAddSheetPreview({
  args,
  positionalArgs,
}: {
  args: Record<string, string | undefined>;
  positionalArgs: string[];
}) {
  const spreadsheetId = positionalArgs[0];
  const title = args.title;

  return (
    <div>
      <div className="flex items-center gap-2 mb-3">
        <IntegrationLogo integration="google_sheets" size={16} />
        <span className="text-sm font-medium">Add Sheet</span>
      </div>

      <PreviewSection>
        <PreviewField label="Spreadsheet" value={spreadsheetId} mono />
        <PreviewField label="Sheet Name" value={title} />
      </PreviewSection>
    </div>
  );
}

function ValuesPreview({ values }: { values: string }) {
  try {
    const parsed = JSON.parse(values);
    if (Array.isArray(parsed)) {
      return (
        <div className="overflow-x-auto">
          <table className="w-full text-sm border-collapse">
            <tbody>
              {parsed.slice(0, 5).map((row, i) => (
                <tr key={i}>
                  {Array.isArray(row) ? (
                    row.map((cell, j) => (
                      <td key={j} className="border px-2 py-1 bg-muted/30">
                        {String(cell)}
                      </td>
                    ))
                  ) : (
                    <td className="border px-2 py-1 bg-muted/30">
                      {String(row)}
                    </td>
                  )}
                </tr>
              ))}
              {parsed.length > 5 && (
                <tr>
                  <td
                    className="border px-2 py-1 text-muted-foreground text-center"
                    colSpan={100}
                  >
                    ... and {parsed.length - 5} more rows
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      );
    }
  } catch {
    // Fall through to raw display
  }

  return <PreviewContent>{values}</PreviewContent>;
}
