/**
 * Integration Icons Mapping
 *
 * Maps integration types to lucide-react icons for display in the UI.
 */

import {
  Mail,
  Calendar,
  FileText,
  Table2,
  HardDrive,
  BookOpen,
  TicketCheck,
  Github,
  Grid3X3,
  MessageSquare,
  Users,
  type LucideIcon,
} from "lucide-react";

export type IntegrationType =
  | "gmail"
  | "google_calendar"
  | "google_docs"
  | "google_sheets"
  | "google_drive"
  | "notion"
  | "linear"
  | "github"
  | "airtable"
  | "slack"
  | "hubspot";

export const INTEGRATION_ICONS: Record<IntegrationType, LucideIcon> = {
  gmail: Mail,
  google_calendar: Calendar,
  google_docs: FileText,
  google_sheets: Table2,
  google_drive: HardDrive,
  notion: BookOpen,
  linear: TicketCheck,
  github: Github,
  airtable: Grid3X3,
  slack: MessageSquare,
  hubspot: Users,
};

export const INTEGRATION_DISPLAY_NAMES: Record<IntegrationType, string> = {
  gmail: "Gmail",
  google_calendar: "Google Calendar",
  google_docs: "Google Docs",
  google_sheets: "Google Sheets",
  google_drive: "Google Drive",
  notion: "Notion",
  linear: "Linear",
  github: "GitHub",
  airtable: "Airtable",
  slack: "Slack",
  hubspot: "HubSpot",
};

export const INTEGRATION_COLORS: Record<IntegrationType, string> = {
  gmail: "text-red-500",
  google_calendar: "text-blue-500",
  google_docs: "text-blue-600",
  google_sheets: "text-green-500",
  google_drive: "text-yellow-500",
  notion: "text-gray-800 dark:text-gray-200",
  linear: "text-purple-500",
  github: "text-gray-900 dark:text-gray-100",
  airtable: "text-blue-400",
  slack: "text-[#4A154B]",
  hubspot: "text-orange-500",
};

export const INTEGRATION_LOGOS: Record<IntegrationType, string> = {
  gmail: "/integrations/google-gmail.svg",
  google_calendar: "/integrations/google-calendar.svg",
  google_docs: "/integrations/google-docs.svg",
  google_sheets: "/integrations/google-sheets.svg",
  google_drive: "/integrations/google-drive.svg",
  notion: "/integrations/notion.svg",
  linear: "/integrations/linear.svg",
  github: "/integrations/github.svg",
  airtable: "/integrations/airtable.svg",
  slack: "/integrations/slack.svg",
  hubspot: "/integrations/hubspot.svg",
};

/**
 * Get the icon component for an integration
 */
export function getIntegrationIcon(integration: string): LucideIcon | null {
  return INTEGRATION_ICONS[integration as IntegrationType] || null;
}

/**
 * Get the display name for an integration
 */
export function getIntegrationDisplayName(integration: string): string {
  return INTEGRATION_DISPLAY_NAMES[integration as IntegrationType] || integration;
}

/**
 * Get the color class for an integration icon
 */
export function getIntegrationColor(integration: string): string {
  return INTEGRATION_COLORS[integration as IntegrationType] || "text-muted-foreground";
}

/**
 * Get the logo path for an integration
 */
export function getIntegrationLogo(integration: string): string | null {
  return INTEGRATION_LOGOS[integration as IntegrationType] || null;
}
