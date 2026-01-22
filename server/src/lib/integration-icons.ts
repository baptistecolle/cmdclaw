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
  Linkedin,
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
  | "hubspot"
  | "linkedin";

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
  linkedin: Linkedin,
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
  linkedin: "LinkedIn",
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
  linkedin: "text-[#0A66C2]",
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
  linkedin: "/integrations/linkedin.svg",
};

// Human-readable descriptions for integration operations
export const INTEGRATION_OPERATION_LABELS: Record<IntegrationType, Record<string, string>> = {
  slack: {
    channels: "Listing channels",
    history: "Reading messages",
    search: "Searching messages",
    recent: "Getting recent messages",
    users: "Listing users",
    user: "Getting user info",
    thread: "Reading thread",
    send: "Sending message",
    react: "Adding reaction",
    upload: "Uploading file",
  },
  gmail: {
    list: "Listing emails",
    get: "Reading email",
    unread: "Getting unread emails",
    send: "Sending email",
  },
  google_calendar: {
    list: "Listing events",
    get: "Getting event",
    calendars: "Listing calendars",
    today: "Getting today's events",
    create: "Creating event",
    update: "Updating event",
    delete: "Deleting event",
  },
  google_docs: {
    get: "Reading document",
    list: "Listing documents",
    search: "Searching documents",
    create: "Creating document",
    append: "Appending to document",
  },
  google_sheets: {
    get: "Reading spreadsheet",
    list: "Listing spreadsheets",
    create: "Creating spreadsheet",
    append: "Appending rows",
    update: "Updating cells",
    clear: "Clearing data",
    "add-sheet": "Adding sheet",
  },
  google_drive: {
    list: "Listing files",
    get: "Getting file",
    download: "Downloading file",
    search: "Searching files",
    folders: "Listing folders",
    upload: "Uploading file",
    mkdir: "Creating folder",
    delete: "Deleting file",
  },
  notion: {
    search: "Searching pages",
    get: "Getting page",
    databases: "Listing databases",
    query: "Querying database",
    create: "Creating page",
    append: "Appending content",
  },
  linear: {
    list: "Listing issues",
    get: "Getting issue",
    teams: "Listing teams",
    mine: "Getting my issues",
    create: "Creating issue",
    update: "Updating issue",
  },
  github: {
    repos: "Listing repositories",
    prs: "Listing pull requests",
    pr: "Getting pull request",
    "my-prs": "Getting my pull requests",
    issues: "Listing issues",
    search: "Searching code",
    "create-issue": "Creating issue",
  },
  airtable: {
    bases: "Listing bases",
    schema: "Getting schema",
    list: "Listing records",
    get: "Getting record",
    search: "Searching records",
    create: "Creating record",
    update: "Updating record",
    delete: "Deleting record",
  },
  hubspot: {
    "contacts.list": "Listing contacts",
    "contacts.get": "Getting contact",
    "contacts.search": "Searching contacts",
    "contacts.create": "Creating contact",
    "contacts.update": "Updating contact",
    "companies.list": "Listing companies",
    "companies.get": "Getting company",
    "companies.create": "Creating company",
    "companies.update": "Updating company",
    "deals.list": "Listing deals",
    "deals.get": "Getting deal",
    "deals.create": "Creating deal",
    "deals.update": "Updating deal",
    "tickets.list": "Listing tickets",
    "tickets.get": "Getting ticket",
    "tickets.create": "Creating ticket",
    "tickets.update": "Updating ticket",
    "tasks.list": "Listing tasks",
    "tasks.get": "Getting task",
    "tasks.create": "Creating task",
    "tasks.complete": "Completing task",
    "notes.list": "Listing notes",
    "notes.create": "Creating note",
    "pipelines.deals": "Getting deal pipelines",
    "pipelines.tickets": "Getting ticket pipelines",
    owners: "Listing owners",
  },
  linkedin: {
    "chats.list": "Listing chats",
    "chats.get": "Getting chat",
    "messages.list": "Listing messages",
    "messages.send": "Sending message",
    "messages.start": "Starting conversation",
    "profile.me": "Getting my profile",
    "profile.get": "Getting profile",
    "profile.company": "Getting company profile",
    search: "Searching",
    "invite.list": "Listing invitations",
    "invite.send": "Sending invitation",
    "connections.list": "Listing connections",
    "connections.remove": "Removing connection",
    "posts.list": "Listing posts",
    "posts.get": "Getting post",
    "posts.create": "Creating post",
    "posts.comment": "Commenting on post",
    "posts.react": "Reacting to post",
    "company.posts": "Listing company posts",
    "company.post": "Creating company post",
  },
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

/**
 * Get the human-readable label for an integration operation
 */
export function getOperationLabel(integration: string, operation: string): string {
  const labels = INTEGRATION_OPERATION_LABELS[integration as IntegrationType];
  if (labels && labels[operation]) {
    return labels[operation];
  }
  // Fallback: capitalize and format the operation name
  return operation.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * Get all available actions for an integration as display-friendly labels
 */
export function getIntegrationActions(integration: string): { key: string; label: string }[] {
  const labels = INTEGRATION_OPERATION_LABELS[integration as IntegrationType];
  if (!labels) return [];

  return Object.entries(labels).map(([key, label]) => ({
    key,
    // Convert "Listing channels" to "List channels" for cleaner display
    label: label.replace(/^(Listing|Getting|Reading|Searching|Creating|Updating|Deleting|Sending|Adding|Uploading|Appending|Completing|Removing|Commenting|Reacting|Starting)/, (match) => {
      const verbMap: Record<string, string> = {
        Listing: "List",
        Getting: "Get",
        Reading: "Read",
        Searching: "Search",
        Creating: "Create",
        Updating: "Update",
        Deleting: "Delete",
        Sending: "Send",
        Adding: "Add",
        Uploading: "Upload",
        Appending: "Append",
        Completing: "Complete",
        Removing: "Remove",
        Commenting: "Comment on",
        Reacting: "React to",
        Starting: "Start",
      };
      return verbMap[match] || match;
    }),
  }));
}
