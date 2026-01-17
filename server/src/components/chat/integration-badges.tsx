"use client";

import {
  getIntegrationLogo,
  getIntegrationDisplayName,
  type IntegrationType,
} from "@/lib/integration-icons";
import { cn } from "@/lib/utils";

type Props = {
  integrations: IntegrationType[];
  size?: "sm" | "md";
  className?: string;
};

export function IntegrationBadges({ integrations, size = "sm", className }: Props) {
  if (integrations.length === 0) return null;

  return (
    <div className={cn("flex items-center gap-1 flex-wrap", className)}>
      {integrations.map((integration) => (
        <IntegrationBadge key={integration} integration={integration} size={size} />
      ))}
    </div>
  );
}

function IntegrationBadge({
  integration,
  size,
}: {
  integration: IntegrationType;
  size: "sm" | "md";
}) {
  const logo = getIntegrationLogo(integration);
  const name = getIntegrationDisplayName(integration);

  const sizeClasses = size === "sm"
    ? "px-1.5 py-0.5 text-xs gap-1"
    : "px-2 py-1 text-sm gap-1.5";

  const iconSize = size === "sm" ? "h-3 w-3" : "h-4 w-4";
  const nameMaxWidth = size === "sm" ? "max-w-[60px]" : "max-w-[80px]";

  return (
    <div
      className={cn(
        "flex items-center rounded-full bg-background/80 text-muted-foreground border border-border/50 hover:bg-background transition-colors",
        sizeClasses
      )}
      title={name}
    >
      {logo && <img src={logo} alt={name} className={iconSize} />}
      <span className={cn("truncate", nameMaxWidth)}>{name}</span>
    </div>
  );
}
