import {
  PreviewProps,
  PreviewField,
  PreviewSection,
  PreviewBadge,
  IntegrationLogo,
} from "./preview-styles";

export function DrivePreview({
  operation,
  args,
  positionalArgs,
}: PreviewProps) {
  switch (operation) {
    case "upload":
      return <DriveUploadPreview args={args} />;
    case "mkdir":
      return <DriveMkdirPreview args={args} />;
    case "delete":
      return <DriveDeletePreview positionalArgs={positionalArgs} />;
    default:
      return null;
  }
}

function DriveUploadPreview({ args }: { args: Record<string, string | undefined> }) {
  const file = args.file;
  const name = args.name;
  const folder = args.folder;

  return (
    <div>
      <div className="flex items-center gap-2 mb-3">
        <IntegrationLogo integration="google_drive" size={16} />
        <span className="text-sm font-medium">Upload File</span>
      </div>

      <PreviewSection>
        <div className="rounded border bg-muted/30 p-3">
          <PreviewField label="File" value={file} />
          {name && <PreviewField label="Save as" value={name} />}
          {folder && <PreviewField label="Destination" value={folder} mono />}
        </div>
      </PreviewSection>
    </div>
  );
}

function DriveMkdirPreview({ args }: { args: Record<string, string | undefined> }) {
  const name = args.name;
  const parent = args.parent;

  return (
    <div>
      <div className="flex items-center gap-2 mb-3">
        <IntegrationLogo integration="google_drive" size={16} />
        <span className="text-sm font-medium">Create Folder</span>
      </div>

      <PreviewSection>
        <div className="rounded border bg-muted/30 p-3 flex items-center gap-2">
          <IntegrationLogo integration="google_drive" size={20} />
          <span className="font-medium">{name || "New Folder"}</span>
        </div>
        {parent && <PreviewField label="Parent Folder" value={parent} mono />}
      </PreviewSection>
    </div>
  );
}

function DriveDeletePreview({ positionalArgs }: { positionalArgs: string[] }) {
  const fileId = positionalArgs[0];

  return (
    <div>
      <div className="flex items-center gap-2 mb-3">
        <IntegrationLogo integration="google_drive" size={16} />
        <span className="text-sm font-medium">Delete Item</span>
        <PreviewBadge variant="danger">Destructive</PreviewBadge>
      </div>

      <PreviewSection>
        <PreviewField label="File/Folder ID" value={fileId} mono />
      </PreviewSection>
    </div>
  );
}
