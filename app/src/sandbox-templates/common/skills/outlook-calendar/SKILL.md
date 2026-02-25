---
name: outlook-calendar
description: Manage Outlook Calendar events. Use for listing, creating, updating, and deleting calendar events.
---

# Outlook Calendar

CRUD operations on Outlook Calendar events via Microsoft Graph.

## Environment Variables

- `OUTLOOK_CALENDAR_ACCESS_TOKEN` - Microsoft OAuth2 access token with Calendar scopes

## Commands

```bash
# List upcoming events
outlook-calendar list [-l limit] [-t timeMin] [-m timeMax] [-c calendarId]

# Get event details
outlook-calendar get <eventId> [-c calendarId]

# Create an event
outlook-calendar create --summary "Meeting" --start 2024-01-15T09:00:00 --end 2024-01-15T10:00:00 [--description "Notes"] [--location "Office"] [--attendees "a@x.com,b@x.com"]

# Update an event
outlook-calendar update <eventId> [--summary "New title"] [--start ...] [--end ...]

# Delete an event
outlook-calendar delete <eventId>

# List available calendars
outlook-calendar calendars

# List today's events
outlook-calendar today [-c calendarId]
```

## Output Format

JSON arrays. Example for `list`:

```json
[
  { "id": "abc123", "summary": "Team Standup", "start": "2024-01-15T09:00:00", "end": "2024-01-15T09:30:00", "location": "Room 1" }
]
```
