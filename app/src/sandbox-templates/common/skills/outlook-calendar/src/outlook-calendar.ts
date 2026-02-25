import { parseArgs } from "util";

const TOKEN = process.env.OUTLOOK_CALENDAR_ACCESS_TOKEN;
if (!TOKEN) {
  console.error("Error: OUTLOOK_CALENDAR_ACCESS_TOKEN environment variable required");
  process.exit(1);
}

const BASE_URL = "https://graph.microsoft.com/v1.0";
const TIME_ZONE = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";

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

type GraphDateTime = { dateTime?: string; timeZone?: string };
type GraphEvent = {
  id: string;
  subject?: string;
  bodyPreview?: string;
  body?: { content?: string };
  start?: GraphDateTime;
  end?: GraphDateTime;
  location?: { displayName?: string };
  showAs?: string;
  webLink?: string;
  organizer?: { emailAddress?: { address?: string; name?: string } };
  attendees?: Array<{
    emailAddress?: { address?: string; name?: string };
    status?: { response?: string };
  }>;
};

function parseLimit(): number {
  const parsed = Number.parseInt(values.limit ?? "10", 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error("Invalid --limit. Expected a positive integer.");
  }
  return Math.min(parsed, 100);
}

function isDateOnly(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function toDateTime(value: string, fallbackTime: "start" | "end") {
  if (isDateOnly(value)) {
    return {
      dateTime: `${value}T${fallbackTime === "start" ? "00:00:00" : "23:59:59"}`,
      timeZone: TIME_ZONE,
    };
  }
  return { dateTime: value, timeZone: TIME_ZONE };
}

function eventCollectionPath(calendarId: string): string {
  if (!calendarId || calendarId === "primary") {
    return "/me/calendar/events";
  }
  return `/me/calendars/${encodeURIComponent(calendarId)}/events`;
}

function calendarViewPath(calendarId: string): string {
  if (!calendarId || calendarId === "primary") {
    return "/me/calendar/calendarView";
  }
  return `/me/calendars/${encodeURIComponent(calendarId)}/calendarView`;
}

function mapEvent(event: GraphEvent) {
  return {
    id: event.id,
    summary: event.subject || "(No title)",
    start: event.start?.dateTime,
    end: event.end?.dateTime,
    location: event.location?.displayName,
    status: event.showAs,
  };
}

async function graphRequest(path: string, init?: RequestInit): Promise<Response> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${TOKEN}`,
    ...(init?.headers ? (init.headers as Record<string, string>) : {}),
  };

  return fetch(`${BASE_URL}${path}`, {
    ...init,
    headers,
  });
}

async function listEvents() {
  const now = new Date();
  const end = new Date(now);
  end.setDate(end.getDate() + 30);

  const params = new URLSearchParams({
    startDateTime: values.timeMin || now.toISOString(),
    endDateTime: values.timeMax || end.toISOString(),
    $top: String(parseLimit()),
    $orderby: "start/dateTime",
    $select: "id,subject,start,end,location,showAs",
  });

  const res = await graphRequest(`${calendarViewPath(values.calendar || "primary")}?${params}`);
  if (!res.ok) {
    throw new Error(await res.text());
  }

  const payload = (await res.json()) as { value?: GraphEvent[] };
  const events = (payload.value ?? []).map(mapEvent);
  console.log(JSON.stringify(events, null, 2));
}

async function getEvent(eventId: string) {
  if (!eventId) {
    throw new Error("Required: outlook-calendar get <eventId>");
  }

  const params = new URLSearchParams({
    $select: "id,subject,bodyPreview,body,start,end,location,showAs,attendees,organizer,webLink",
  });

  const res = await graphRequest(
    `${eventCollectionPath(values.calendar || "primary")}/${encodeURIComponent(eventId)}?${params}`,
  );
  if (!res.ok) {
    throw new Error(await res.text());
  }

  const event = (await res.json()) as GraphEvent;
  console.log(
    JSON.stringify(
      {
        id: event.id,
        summary: event.subject,
        description: event.body?.content,
        start: event.start?.dateTime,
        end: event.end?.dateTime,
        location: event.location?.displayName,
        status: event.showAs,
        attendees: (event.attendees ?? []).map((attendee) => ({
          email: attendee.emailAddress?.address,
          name: attendee.emailAddress?.name,
          responseStatus: attendee.status?.response,
        })),
        organizer: event.organizer,
        bodyPreview: event.bodyPreview,
        webLink: event.webLink,
      },
      null,
      2,
    ),
  );
}

async function createEvent() {
  if (!values.summary || !values.start || !values.end) {
    console.error("Required: --summary <title> --start <datetime> --end <datetime>");
    console.error("Datetime format: 2024-01-15T09:00:00 or 2024-01-15");
    process.exit(1);
  }

  const event: {
    subject: string;
    body?: { contentType: "Text"; content: string };
    start: { dateTime: string; timeZone: string };
    end: { dateTime: string; timeZone: string };
    location?: { displayName: string };
    attendees?: Array<{ emailAddress: { address: string }; type: "required" }>;
    isAllDay?: boolean;
  } = {
    subject: values.summary,
    start: toDateTime(values.start, "start"),
    end: toDateTime(values.end, "end"),
  };

  if (values.description) {
    event.body = { contentType: "Text", content: values.description };
  }

  if (values.location) {
    event.location = { displayName: values.location };
  }

  if (values.attendees) {
    event.attendees = values.attendees
      .split(",")
      .map((email) => email.trim())
      .filter(Boolean)
      .map((email) => ({
        emailAddress: { address: email },
        type: "required" as const,
      }));
  }

  if (isDateOnly(values.start) && isDateOnly(values.end)) {
    event.isAllDay = true;
  }

  const res = await graphRequest(eventCollectionPath(values.calendar || "primary"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(event),
  });

  if (!res.ok) {
    throw new Error(await res.text());
  }

  const created = (await res.json()) as { id?: string; webLink?: string };
  console.log(
    `Event created: ${created.id ?? "unknown"}${created.webLink ? ` (${created.webLink})` : ""}`,
  );
}

async function updateEvent(eventId: string) {
  if (!eventId) {
    throw new Error("Required: outlook-calendar update <eventId>");
  }

  const patch: {
    subject?: string;
    body?: { contentType: "Text"; content: string };
    start?: { dateTime: string; timeZone: string };
    end?: { dateTime: string; timeZone: string };
    location?: { displayName: string };
    isAllDay?: boolean;
  } = {};

  if (values.summary) {
    patch.subject = values.summary;
  }
  if (values.description) {
    patch.body = { contentType: "Text", content: values.description };
  }
  if (values.start) {
    patch.start = toDateTime(values.start, "start");
  }
  if (values.end) {
    patch.end = toDateTime(values.end, "end");
  }
  if (values.location) {
    patch.location = { displayName: values.location };
  }
  if (values.start && values.end && isDateOnly(values.start) && isDateOnly(values.end)) {
    patch.isAllDay = true;
  }

  if (Object.keys(patch).length === 0) {
    throw new Error(
      "No updates provided. Use one or more of --summary, --description, --start, --end, --location",
    );
  }

  const res = await graphRequest(
    `${eventCollectionPath(values.calendar || "primary")}/${encodeURIComponent(eventId)}`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    },
  );

  if (!res.ok) {
    throw new Error(await res.text());
  }

  console.log(`Event updated: ${eventId}`);
}

async function deleteEvent(eventId: string) {
  if (!eventId) {
    throw new Error("Required: outlook-calendar delete <eventId>");
  }

  const res = await graphRequest(
    `${eventCollectionPath(values.calendar || "primary")}/${encodeURIComponent(eventId)}`,
    {
      method: "DELETE",
    },
  );

  if (!res.ok && res.status !== 204) {
    throw new Error(await res.text());
  }

  console.log(`Event deleted: ${eventId}`);
}

async function listCalendars() {
  const res = await graphRequest(
    "/me/calendars?$select=id,name,canEdit,canShare,canViewPrivateItems,isDefaultCalendar",
  );
  if (!res.ok) {
    throw new Error(await res.text());
  }

  const payload = (await res.json()) as {
    value?: Array<{
      id: string;
      name: string;
      canEdit?: boolean;
      canShare?: boolean;
      canViewPrivateItems?: boolean;
      isDefaultCalendar?: boolean;
    }>;
  };

  const calendars = (payload.value ?? []).map((calendar) => ({
    id: calendar.id,
    name: calendar.name,
    canEdit: calendar.canEdit ?? false,
    canShare: calendar.canShare ?? false,
    canViewPrivateItems: calendar.canViewPrivateItems ?? false,
    primary: calendar.isDefaultCalendar ?? false,
  }));

  console.log(JSON.stringify(calendars, null, 2));
}

async function todayEvents() {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const end = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);

  const params = new URLSearchParams({
    startDateTime: start.toISOString(),
    endDateTime: end.toISOString(),
    $top: "50",
    $orderby: "start/dateTime",
    $select: "id,subject,start,end,location,showAs",
  });

  const res = await graphRequest(`${calendarViewPath(values.calendar || "primary")}?${params}`);
  if (!res.ok) {
    throw new Error(await res.text());
  }

  const payload = (await res.json()) as { value?: GraphEvent[] };
  const events = (payload.value ?? []).map(mapEvent);
  console.log(JSON.stringify(events, null, 2));
}

function showHelp() {
  console.log(`Outlook Calendar CLI - Commands:
  list [-l limit] [-t timeMin] [-m timeMax] [-c calendar]                  List events
  get <eventId> [-c calendar]                                               Get event details
  create --summary <title> --start <datetime> --end <datetime> [--description] [--location] [--attendees email1,email2]
  update <eventId> [--summary] [--start] [--end] [--description] [--location]
  delete <eventId> [-c calendar]                                            Delete an event
  calendars                                                                  List available calendars
  today [-c calendar]                                                        List today's events

Datetime format: 2024-01-15T09:00:00 (timed) or 2024-01-15 (all-day)

Options:
  -h, --help                                                                 Show this help message`);
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
  } catch (error) {
    console.error("Error:", error instanceof Error ? error.message : error);
    process.exit(1);
  }
}

main();
