import type { ComponentType } from "react";
import type { PreviewProps } from "./preview-styles";
import { AirtablePreview } from "./airtable-preview";
import { CalendarPreview } from "./calendar-preview";
import { DocsPreview } from "./docs-preview";
import { DrivePreview } from "./drive-preview";
import { GithubPreview } from "./github-preview";
import { GmailPreview } from "./gmail-preview";
import { HubspotPreview } from "./hubspot-preview";
import { LinearPreview } from "./linear-preview";
import { NotionPreview } from "./notion-preview";
import { SheetsPreview } from "./sheets-preview";
import { SlackPreview } from "./slack-preview";

export type { PreviewProps } from "./preview-styles";
export { GenericPreview } from "./generic-preview";

export type PreviewComponent = ComponentType<PreviewProps>;

export interface IntegrationPreviewConfig {
  component: PreviewComponent;
  displayName: string;
}

// Map integration names to their preview components and display names
export const INTEGRATION_PREVIEWS: Record<string, IntegrationPreviewConfig> = {
  slack: { component: SlackPreview, displayName: "Slack" },
  gmail: { component: GmailPreview, displayName: "Gmail" },
  google_calendar: {
    component: CalendarPreview,
    displayName: "Google Calendar",
  },
  google_docs: { component: DocsPreview, displayName: "Google Docs" },
  google_sheets: { component: SheetsPreview, displayName: "Google Sheets" },
  google_drive: { component: DrivePreview, displayName: "Google Drive" },
  notion: { component: NotionPreview, displayName: "Notion" },
  linear: { component: LinearPreview, displayName: "Linear" },
  github: { component: GithubPreview, displayName: "GitHub" },
  airtable: { component: AirtablePreview, displayName: "Airtable" },
  hubspot: { component: HubspotPreview, displayName: "HubSpot" },
};

/**
 * Get the preview component for a given integration
 *
 * @param integration - The integration name (e.g., "slack", "gmail")
 * @returns The preview component or null if not found
 */
export function getPreviewComponent(integration: string): PreviewComponent | null {
  return INTEGRATION_PREVIEWS[integration]?.component || null;
}

/**
 * Check if a specific integration has a custom preview
 */
export function hasCustomPreview(integration: string): boolean {
  return integration in INTEGRATION_PREVIEWS;
}

/**
 * Get all integration keys
 */
export function getIntegrationKeys(): string[] {
  return Object.keys(INTEGRATION_PREVIEWS);
}
