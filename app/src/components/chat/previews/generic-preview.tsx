import { getFlagLabel } from "@/lib/parse-cli-command";
import { PreviewProps, PreviewField, PreviewSection } from "./preview-styles";

export function GenericPreview({ operation, args, positionalArgs }: PreviewProps) {
  const hasArgs = Object.keys(args).length > 0;
  const hasPositional = positionalArgs.length > 0;

  if (!hasArgs && !hasPositional) {
    return (
      <PreviewSection>
        <p className="text-muted-foreground text-sm">
          Operation: <span className="font-mono">{operation}</span>
        </p>
      </PreviewSection>
    );
  }

  return (
    <div>
      {hasPositional && (
        <PreviewSection title="Arguments">
          {positionalArgs.map((arg) => (
            <span
              key={arg}
              className="bg-muted mr-2 mb-1 inline-block rounded px-1.5 py-0.5 font-mono text-xs"
            >
              {arg}
            </span>
          ))}
        </PreviewSection>
      )}

      {hasArgs && (
        <PreviewSection title="Options">
          {Object.entries(args).map(([key, value]) => (
            <PreviewField
              key={key}
              label={getFlagLabel(key)}
              value={value}
              mono={key.length === 1}
            />
          ))}
        </PreviewSection>
      )}
    </div>
  );
}
