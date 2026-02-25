/**
 * Mock data for preview components
 * When adding a new preview, add its mock data here
 */

export interface PreviewMockData {
  operation: string;
  label: string;
  args: Record<string, string | undefined>;
  positionalArgs?: string[];
}

export const PREVIEW_MOCK_DATA: Record<string, PreviewMockData[]> = {
  slack: [
    {
      operation: "send",
      label: "Send Message",
      args: {
        channel: "#general",
        text: "Hello team! Here's the weekly update on our project progress. We've made significant improvements to the API performance.",
      },
    },
    {
      operation: "send",
      label: "Reply to Thread",
      args: {
        channel: "#engineering",
        text: "Great point! I'll look into this issue and get back to you.",
        thread: "1234567890.123456",
      },
    },
    {
      operation: "react",
      label: "Add Reaction",
      args: {
        channel: "#general",
        ts: "1234567890.123456",
        emoji: "thumbsup",
      },
    },
    {
      operation: "upload",
      label: "Upload File",
      args: {
        channel: "#design",
        file: "/path/to/mockup.png",
        comment: "Here's the latest design mockup for review",
      },
    },
  ],

  gmail: [
    {
      operation: "send",
      label: "Send Email",
      args: {
        to: "john@example.com",
        subject: "Project Update - Q1 Report",
        body: "Hi John,\n\nPlease find attached the Q1 report for your review.\n\nKey highlights:\n- Revenue increased by 15%\n- Customer satisfaction at 92%\n- New feature adoption rate of 78%\n\nLet me know if you have any questions.\n\nBest regards",
      },
    },
    {
      operation: "send",
      label: "Email with CC/BCC",
      args: {
        to: "team@example.com",
        cc: "manager@example.com",
        bcc: "archive@example.com",
        subject: "Meeting Notes - Sprint Planning",
        body: "Team,\n\nAttached are the notes from today's sprint planning session.\n\nAction items have been assigned in the project tracker.\n\nThanks",
      },
    },
  ],

  outlook: [
    {
      operation: "send",
      label: "Send Email",
      args: {
        to: "john@example.com",
        subject: "Project Update - Q1 Report",
        body: "Hi John,\n\nPlease find attached the Q1 report for your review.\n\nLet me know if you have any questions.\n\nBest regards",
      },
    },
  ],

  outlook_calendar: [
    {
      operation: "create",
      label: "Create Event",
      args: {
        summary: "Product Sync",
        start: "2025-01-20T09:00:00",
        end: "2025-01-20T10:00:00",
        location: "Microsoft Teams",
        description: "Weekly product status sync.",
      },
    },
    {
      operation: "update",
      label: "Update Event",
      args: {
        summary: "Updated: Product Sync",
        start: "2025-01-20T09:30:00",
      },
      positionalArgs: ["event_123"],
    },
    {
      operation: "delete",
      label: "Delete Event",
      args: {},
      positionalArgs: ["event_123"],
    },
  ],

  google_calendar: [
    {
      operation: "create",
      label: "Create Event",
      args: {
        summary: "Team Standup",
        start: "2025-01-20T09:00:00",
        end: "2025-01-20T09:30:00",
        location: "Conference Room A",
        description: "Daily team standup to discuss progress and blockers.",
      },
    },
    {
      operation: "update",
      label: "Update Event",
      args: {
        summary: "Updated: Team Standup",
        start: "2025-01-20T10:00:00",
      },
      positionalArgs: ["event_abc123"],
    },
    {
      operation: "delete",
      label: "Delete Event",
      args: {},
      positionalArgs: ["event_xyz789"],
    },
  ],

  google_docs: [
    {
      operation: "create",
      label: "Create Document",
      args: {
        title: "Project Proposal - New Feature",
        content:
          "Executive Summary\n\nThis document outlines the proposal for implementing a new dashboard feature that will improve user analytics capabilities.\n\n1. Overview\n2. Technical Requirements\n3. Timeline\n4. Resources",
      },
    },
    {
      operation: "append",
      label: "Append to Document",
      args: {
        text: "\n\nAppendix A: Technical Specifications\n\n- API Version: 2.0\n- Authentication: OAuth 2.0\n- Rate Limits: 1000 req/min",
      },
      positionalArgs: ["doc_123abc"],
    },
  ],

  google_sheets: [
    {
      operation: "create",
      label: "Create Spreadsheet",
      args: {
        title: "Q1 Sales Report",
      },
    },
    {
      operation: "append",
      label: "Append Rows",
      args: {
        range: "Sheet1!A:D",
        values: JSON.stringify([
          ["Product", "Quantity", "Price", "Total"],
          ["Widget A", "100", "$10.00", "$1,000.00"],
          ["Widget B", "250", "$15.00", "$3,750.00"],
        ]),
      },
      positionalArgs: ["spreadsheet_123"],
    },
    {
      operation: "update",
      label: "Update Cells",
      args: {
        range: "Sheet1!B2:B3",
        values: JSON.stringify([["150"], ["300"]]),
      },
      positionalArgs: ["spreadsheet_123"],
    },
    {
      operation: "clear",
      label: "Clear Cells",
      args: {
        range: "Sheet1!A10:D20",
      },
      positionalArgs: ["spreadsheet_123"],
    },
    {
      operation: "add-sheet",
      label: "Add Sheet",
      args: {
        title: "Q2 Data",
      },
      positionalArgs: ["spreadsheet_123"],
    },
  ],

  google_drive: [
    {
      operation: "upload",
      label: "Upload File",
      args: {
        file: "/documents/report.pdf",
        name: "Q1-Report-2025.pdf",
        folder: "folder_abc123",
      },
    },
    {
      operation: "mkdir",
      label: "Create Folder",
      args: {
        name: "Project Assets",
        parent: "folder_root",
      },
    },
    {
      operation: "delete",
      label: "Delete Item",
      args: {},
      positionalArgs: ["file_xyz789"],
    },
  ],

  notion: [
    {
      operation: "create",
      label: "Create Page",
      args: {
        parent: "workspace_123",
        title: "Meeting Notes - Product Review",
        content:
          "Attendees: Alice, Bob, Charlie\n\nAgenda:\n1. Review current sprint\n2. Discuss upcoming features\n3. Plan next release",
      },
    },
    {
      operation: "append",
      label: "Append to Page",
      args: {
        content:
          "## Action Items\n- [ ] Complete API documentation\n- [ ] Review pull requests\n- [ ] Update project timeline",
      },
      positionalArgs: ["page_abc123"],
    },
  ],

  linear: [
    {
      operation: "create",
      label: "Create Issue (Urgent)",
      args: {
        team: "ENG",
        title: "Fix production bug in authentication flow",
        description:
          "Users are experiencing intermittent 500 errors when logging in. This needs immediate attention.",
        priority: "1",
      },
    },
    {
      operation: "create",
      label: "Create Issue (Normal)",
      args: {
        team: "PRODUCT",
        title: "Add dark mode support",
        description: "Implement dark mode theme across all pages to improve user experience.",
        priority: "3",
      },
    },
    {
      operation: "update",
      label: "Update Issue",
      args: {
        title: "Updated title",
        state: "In Progress",
        priority: "2",
      },
      positionalArgs: ["ENG-123"],
    },
  ],

  github: [
    {
      operation: "create-issue",
      label: "Create Issue",
      args: {
        owner: "acme",
        repo: "web-app",
        title: "Implement caching for API responses",
        body: "## Problem\nAPI responses are slow due to repeated database queries.\n\n## Solution\nImplement Redis caching for frequently accessed endpoints.\n\n## Acceptance Criteria\n- [ ] Cache user profiles\n- [ ] Cache product listings\n- [ ] Add cache invalidation",
        labels: "enhancement,performance",
      },
    },
  ],

  airtable: [
    {
      operation: "create",
      label: "Create Record",
      args: {
        base: "appXYZ123",
        table: "Tasks",
        fields: JSON.stringify({
          Name: "Review marketing proposal",
          Status: "In Progress",
          Assignee: "Alice",
          "Due Date": "2025-01-25",
        }),
      },
    },
    {
      operation: "update",
      label: "Update Record",
      args: {
        base: "appXYZ123",
        table: "Tasks",
        record: "recABC456",
        fields: JSON.stringify({
          Status: "Completed",
          "Completed Date": "2025-01-20",
        }),
      },
    },
    {
      operation: "delete",
      label: "Delete Record",
      args: {
        base: "appXYZ123",
        table: "Tasks",
        record: "recDEF789",
      },
    },
  ],

  hubspot: [
    {
      operation: "contacts.create",
      label: "Create Contact",
      args: {
        firstname: "John",
        lastname: "Smith",
        email: "john.smith@example.com",
        company: "Acme Corp",
        phone: "+1 555-123-4567",
      },
    },
    {
      operation: "companies.create",
      label: "Create Company",
      args: {
        name: "TechStart Inc",
        domain: "techstart.io",
        industry: "Technology",
      },
    },
    {
      operation: "deals.create",
      label: "Create Deal",
      args: {
        name: "Enterprise License - Q1",
        pipeline: "default",
        stage: "qualifiedtobuy",
        amount: "50000",
      },
    },
    {
      operation: "tickets.create",
      label: "Create Ticket",
      args: {
        subject: "Integration issue with API",
        pipeline: "support",
        stage: "new",
      },
    },
    {
      operation: "tasks.create",
      label: "Create Task",
      args: {
        subject: "Follow up with lead",
        due: "2025-01-22",
      },
    },
    {
      operation: "contacts.update",
      label: "Update Contact",
      args: {
        id: "12345",
        properties: JSON.stringify({
          phone: "+1 555-987-6543",
          lifecyclestage: "customer",
        }),
      },
    },
    {
      operation: "tasks.complete",
      label: "Complete Task",
      args: {
        id: "task_67890",
      },
    },
  ],
};
