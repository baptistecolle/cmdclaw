import { cn } from "@/lib/utils";
import { type LucideIcon } from "lucide-react";
import Image from "next/image";
import { getIntegrationLogo } from "@/lib/integration-icons";

export interface PreviewProps {
  integration: string;
  operation: string;
  args: Record<string, string | undefined>;
  positionalArgs: string[];
  command: string;
  className?: string;
}

interface IntegrationLogoProps {
  integration: string;
  size?: number;
  className?: string;
}

export function IntegrationLogo({ integration, size = 16, className }: IntegrationLogoProps) {
  const logo = getIntegrationLogo(integration);

  if (!logo) return null;

  return (
    <Image
      src={logo}
      alt={integration}
      width={size}
      height={size}
      className={cn("shrink-0", className)}
    />
  );
}

interface PreviewHeaderProps {
  icon?: LucideIcon;
  iconColor?: string;
  integration?: string;
  operation: string;
  operationLabel?: string;
  className?: string;
}

export function PreviewHeader({
  icon: Icon,
  iconColor,
  integration,
  operation,
  operationLabel,
  className,
}: PreviewHeaderProps) {
  return (
    <div className={cn("flex items-center gap-2 mb-3", className)}>
      {integration ? (
        <IntegrationLogo integration={integration} size={16} />
      ) : (
        Icon && <Icon className={cn("h-4 w-4", iconColor)} />
      )}
      <span className="text-sm font-medium">{operationLabel || operation}</span>
    </div>
  );
}

interface PreviewFieldProps {
  label: string;
  value: string | undefined;
  mono?: boolean;
  className?: string;
}

export function PreviewField({ label, value, mono, className }: PreviewFieldProps) {
  if (!value) return null;

  return (
    <div className={cn("mb-2", className)}>
      <span className="text-xs font-medium text-muted-foreground">{label}: </span>
      <span className={cn("text-sm", mono && "font-mono")}>{value}</span>
    </div>
  );
}

interface PreviewSectionProps {
  title?: string;
  children: React.ReactNode;
  className?: string;
}

export function PreviewSection({ title, children, className }: PreviewSectionProps) {
  return (
    <div className={cn("mb-3", className)}>
      {title && <p className="text-xs font-medium text-muted-foreground mb-1">{title}</p>}
      {children}
    </div>
  );
}

interface PreviewContentProps {
  children: React.ReactNode;
  className?: string;
}

export function PreviewContent({ children, className }: PreviewContentProps) {
  return (
    <div className={cn("rounded bg-muted p-3 text-sm whitespace-pre-wrap break-words", className)}>
      {children}
    </div>
  );
}

interface PreviewGridProps {
  children: React.ReactNode;
  className?: string;
}

export function PreviewGrid({ children, className }: PreviewGridProps) {
  return <div className={cn("grid grid-cols-2 gap-2", className)}>{children}</div>;
}

interface PreviewBadgeProps {
  children: React.ReactNode;
  variant?: "default" | "success" | "warning" | "danger";
  className?: string;
}

export function PreviewBadge({ children, variant = "default", className }: PreviewBadgeProps) {
  const variants = {
    default: "bg-muted text-muted-foreground",
    success: "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400",
    warning: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400",
    danger: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400",
  };

  return (
    <span
      className={cn(
        "inline-flex items-center rounded px-1.5 py-0.5 text-xs font-medium",
        variants[variant],
        className,
      )}
    >
      {children}
    </span>
  );
}
