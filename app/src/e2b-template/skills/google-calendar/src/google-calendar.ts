import { parseArgs } from "util";

const TOKEN = process.env.GOOGLE_CALENDAR_ACCESS_TOKEN;
if (!TOKEN) {
  console.error(
    "Error: GOOGLE_CALENDAR_ACCESS_TOKEN environment variable required",
  );
  process.exit(1);
}

const headers = { Authorization: `Bearer ${TOKEN}` };
const BASE_URL = "https://www.googleapis.com/calendar/v3";

const { positionals, values } = parseArgs({
  args: process.argv.slice(2),
  allowPositionals: true,
  options: {
    help: { type: "boolean", short: "h" },
    limit: { type: "string", short: "l", default: "10" },
    timeMin: { type: "string", short: "t" },
    timeMax: { type: "string", short: "m" },
    calendar: { type: "string", short: "c", default: "primary" },
    summary: { type: "string" },
    description: { type: "string", short: "d" },
    start: { type: "string" },
    end: { type: "string" },
    location: { type: "string" },
    attendees: { type: "string" },
  },
});

const [command, ...args] = positionals;

type CalendarDateTime = { dateTime?: string; date?: string; timeZone?: string };
type CalendarEvent = {
  id: string;
  summary?: string;
  description?: string;
  start?: CalendarDateTime;
  end?: CalendarDateTime;
  location?: string;
  status?: string;
  attendees?: Array<{ email?: string; responseStatus?: string }>;
  htmlLink?: string;
  creator?: unknown;
  organizer?: unknown;
};

async function listEvents() {
  const params = new URLSearchParams({
    maxResults: values.limit || "10",
    singleEvents: "true",
    orderBy: "startTime",
  });

  const now = new Date();
  params.set("timeMin", values.timeMin || now.toISOString());
  if (values.timeMax) params.set("timeMax", values.timeMax);

  const calendarId = encodeURIComponent(values.calendar || "primary");
  const res = await fetch(
    `${BASE_URL}/calendars/${calendarId}/events?${params}`,
    { headers },
  );
  if (!res.ok) throw new Error(await res.text());

  const { items = [] } = (await res.json()) as { items?: CalendarEvent[] };
  const events = items.map((event) => ({
    id: event.id,
    summary: event.summary || "(No title)",
    start: event.start?.dateTime || event.start?.date,
    end: event.end?.dateTime || event.end?.date,
    location: event.location,
    status: event.status,
  }));

  console.log(JSON.stringify(events, null, 2));
}

async function getEvent(eventId: string) {
  const calendarId = encodeURIComponent(values.calendar || "primary");
  const res = await fetch(
    `${BASE_URL}/calendars/${calendarId}/events/${eventId}`,
    { headers },
  );
  if (!res.ok) throw new Error(await res.text());

  const event = (await res.json()) as CalendarEvent;
  console.log(
    JSON.stringify(
      {
        id: event.id,
        summary: event.summary,
        description: event.description,
        start: event.start?.dateTime || event.start?.date,
        end: event.end?.dateTime || event.end?.date,
        location: event.location,
        status: event.status,
        attendees: event.attendees?.map((a) => ({
          email: a.email,
          responseStatus: a.responseStatus,
        })),
        htmlLink: event.htmlLink,
        creator: event.creator,
        organizer: event.organizer,
      },
      null,
      2,
    ),
  );
}

async function createEvent() {
  if (!values.summary || !values.start || !values.end) {
    console.error(
      "Required: --summary <title> --start <datetime> --end <datetime>",
    );
    console.error(
      "Datetime format: 2024-01-15T09:00:00 or 2024-01-15 (all-day)",
    );
    process.exit(1);
  }

  const isAllDay = !values.start.includes("T");
  const event: {
    summary: string;
    description?: string;
    location?: string;
    start?: { date?: string; dateTime?: string; timeZone?: string };
    end?: { date?: string; dateTime?: string; timeZone?: string };
    attendees?: Array<{ email: string }>;
  } = {
    summary: values.summary,
    description: values.description,
    location: values.location,
  };

  if (isAllDay) {
    event.start = { date: values.start };
    event.end = { date: values.end };
  } else {
    event.start = {
      dateTime: values.start,
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    };
    event.end = {
      dateTime: values.end,
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    };
  }

  if (values.attendees) {
    event.attendees = values.attendees
      .split(",")
      .map((email) => ({ email: email.trim() }));
  }

  const calendarId = encodeURIComponent(values.calendar || "primary");
  const res = await fetch(`${BASE_URL}/calendars/${calendarId}/events`, {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify(event),
  });

  if (!res.ok) throw new Error(await res.text());
  const created = (await res.json()) as { htmlLink?: string };
  console.log(`Event created: ${created.htmlLink}`);
}

async function updateEvent(eventId: string) {
  const calendarId = encodeURIComponent(values.calendar || "primary");

  // First get the existing event
  const getRes = await fetch(
    `${BASE_URL}/calendars/${calendarId}/events/${eventId}`,
    { headers },
  );
  if (!getRes.ok) throw new Error(await getRes.text());
  const existing = (await getRes.json()) as CalendarEvent;

  // Update fields
  if (values.summary) existing.summary = values.summary;
  if (values.description) existing.description = values.description;
  if (values.location) existing.location = values.location;

  if (values.start) {
    const isAllDay = !values.start.includes("T");
    if (isAllDay) {
      existing.start = { date: values.start };
    } else {
      existing.start = {
        dateTime: values.start,
        timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      };
    }
  }

  if (values.end) {
    const isAllDay = !values.end.includes("T");
    if (isAllDay) {
      existing.end = { date: values.end };
    } else {
      existing.end = {
        dateTime: values.end,
        timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      };
    }
  }

  const res = await fetch(
    `${BASE_URL}/calendars/${calendarId}/events/${eventId}`,
    {
      method: "PUT",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify(existing),
    },
  );

  if (!res.ok) throw new Error(await res.text());
  console.log(`Event updated: ${eventId}`);
}

async function deleteEvent(eventId: string) {
  const calendarId = encodeURIComponent(values.calendar || "primary");
  const res = await fetch(
    `${BASE_URL}/calendars/${calendarId}/events/${eventId}`,
    {
      method: "DELETE",
      headers,
    },
  );

  if (!res.ok && res.status !== 204) throw new Error(await res.text());
  console.log(`Event deleted: ${eventId}`);
}

async function listCalendars() {
  const res = await fetch(`${BASE_URL}/users/me/calendarList`, { headers });
  if (!res.ok) throw new Error(await res.text());

  const { items = [] } = (await res.json()) as {
    items?: Array<{
      id: string;
      summary: string;
      description?: string;
      primary?: boolean;
      accessRole?: string;
    }>;
  };
  const calendars = items.map((cal) => ({
    id: cal.id,
    summary: cal.summary,
    description: cal.description,
    primary: cal.primary || false,
    accessRole: cal.accessRole,
  }));

  console.log(JSON.stringify(calendars, null, 2));
}

async function todayEvents() {
  const now = new Date();
  const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const endOfDay = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate() + 1,
  );

  const params = new URLSearchParams({
    maxResults: "50",
    singleEvents: "true",
    orderBy: "startTime",
    timeMin: startOfDay.toISOString(),
    timeMax: endOfDay.toISOString(),
  });

  const calendarId = encodeURIComponent(values.calendar || "primary");
  const res = await fetch(
    `${BASE_URL}/calendars/${calendarId}/events?${params}`,
    { headers },
  );
  if (!res.ok) throw new Error(await res.text());

  const { items = [] } = (await res.json()) as { items?: CalendarEvent[] };
  const events = items.map((event) => ({
    id: event.id,
    summary: event.summary || "(No title)",
    start: event.start?.dateTime || event.start?.date,
    end: event.end?.dateTime || event.end?.date,
    location: event.location,
  }));

  console.log(JSON.stringify(events, null, 2));
}

function showHelp() {
  console.log(`Google Calendar CLI - Commands:
  list [-l limit] [-t timeMin] [-m timeMax] [-c calendar]  List events
  get <eventId> [-c calendar]                               Get event details
  create --summary <title> --start <datetime> --end <datetime> [--description] [--location] [--attendees email1,email2]
  update <eventId> [--summary] [--start] [--end] [--description] [--location]
  delete <eventId> [-c calendar]                            Delete an event
  calendars                                                 List available calendars
  today [-c calendar]                                       List today's events

Datetime format: 2024-01-15T09:00:00 (timed) or 2024-01-15 (all-day)

Options:
  -h, --help                                                Show this help message`);
}

async function main() {
  if (values.help) {
    showHelp();
    return;
  }

  try {
    switch (command) {
      case "list":
        await listEvents();
        break;
      case "get":
        await getEvent(args[0]);
        break;
      case "create":
        await createEvent();
        break;
      case "update":
        await updateEvent(args[0]);
        break;
      case "delete":
        await deleteEvent(args[0]);
        break;
      case "calendars":
        await listCalendars();
        break;
      case "today":
        await todayEvents();
        break;
      default:
        showHelp();
    }
  } catch (e) {
    console.error("Error:", e instanceof Error ? e.message : e);
    process.exit(1);
  }
}

main();
