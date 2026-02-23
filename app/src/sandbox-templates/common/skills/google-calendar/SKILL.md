---
name: google-calendar
description: Manage Google Calendar events. Use for listing, creating, updating, and deleting calendar events.
---

# Google Calendar

CRUD operations on Google Calendar events.

## Environment Variables

- `GOOGLE_CALENDAR_ACCESS_TOKEN` - Google OAuth2 access token with calendar scope

## Commands

```bash
# List upcoming events
google-calendar list [-l limit] [-t timeMin] [-m timeMax] [-c calendarId]

# Get event details
google-calendar get <eventId> [-c calendarId]

# Create an event
google-calendar create --summary "Meeting" --start 2024-01-15T09:00:00 --end 2024-01-15T10:00:00 [--description "Notes"] [--location "Office"] [--attendees "a@x.com,b@x.com"]

# Create all-day event
google-calendar create --summary "Holiday" --start 2024-01-15 --end 2024-01-16

# Update an event
google-calendar update <eventId> [--summary "New title"] [--start ...] [--end ...]

# Delete an event
google-calendar delete <eventId>

# List available calendars
google-calendar calendars

# List today's events
google-calendar today [-c calendarId]
```

## Output Format

JSON arrays. Example for `list`:

```json
[
  { "id": "abc123", "summary": "Team Standup", "start": "2024-01-15T09:00:00-05:00", "end": "2024-01-15T09:30:00-05:00", "location": "Room 1" }
]
```
