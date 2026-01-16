import type { ComponentType } from "react";
import type { PreviewProps } from "./preview-styles";
import { SlackPreview } from "./slack-preview";
import { GmailPreview } from "./gmail-preview";
import { CalendarPreview } from "./calendar-preview";
import { DocsPreview } from "./docs-preview";
import { SheetsPreview } from "./sheets-preview";
import { DrivePreview } from "./drive-preview";
import { NotionPreview } from "./notion-preview";
import { LinearPreview } from "./linear-preview";
import { GithubPreview } from "./github-preview";
import { AirtablePreview } from "./airtable-preview";
import { HubspotPreview } from "./hubspot-preview";
import { GenericPreview } from "./generic-preview";

export type { PreviewProps } from "./preview-styles";
export { GenericPreview } from "./generic-preview";

type PreviewComponent = ComponentType<PreviewProps>;

// Map integration names to their preview components
const INTEGRATION_PREVIEWS: Record<string, PreviewComponent> = {
  slack: SlackPreview,
  gmail: GmailPreview,
  google_calendar: CalendarPreview,
  google_docs: DocsPreview,
  google_sheets: SheetsPreview,
  google_drive: DrivePreview,
  notion: NotionPreview,
  linear: LinearPreview,
  github: GithubPreview,
  airtable: AirtablePreview,
  hubspot: HubspotPreview,
};

/**
 * Get the preview component for a given integration
 *
 * @param integration - The integration name (e.g., "slack", "gmail")
 * @returns The preview component or null if not found
 */
export function getPreviewComponent(
  integration: string
): PreviewComponent | null {
  return INTEGRATION_PREVIEWS[integration] || null;
}

/**
 * Check if a specific integration has a custom preview
 */
export function hasCustomPreview(integration: string): boolean {
  return integration in INTEGRATION_PREVIEWS;
}
