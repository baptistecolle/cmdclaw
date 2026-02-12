// @ts-nocheck
import { parseArgs } from "util";

const TOKEN = process.env.HUBSPOT_ACCESS_TOKEN;
if (!TOKEN) {
  console.error("Error: HUBSPOT_ACCESS_TOKEN environment variable required");
  process.exit(1);
}

const BASE_URL = "https://api.hubapi.com";
const headers = {
  Authorization: `Bearer ${TOKEN}`,
  "Content-Type": "application/json",
};

async function api(path: string, options?: RequestInit) {
  const res = await fetch(`${BASE_URL}${path}`, {
    ...options,
    headers: { ...headers, ...options?.headers },
  });
  if (!res.ok) {
    const error = await res.text();
    throw new Error(`HubSpot API error: ${res.status} - ${error}`);
  }
  return res.json();
}

const { positionals, values } = parseArgs({
  args: process.argv.slice(2),
  allowPositionals: true,
  options: {
    help: { type: "boolean", short: "h" },
    limit: { type: "string", short: "l", default: "20" },
    query: { type: "string", short: "q" },
    email: { type: "string" },
    firstname: { type: "string" },
    lastname: { type: "string" },
    company: { type: "string" },
    phone: { type: "string" },
    name: { type: "string" },
    domain: { type: "string" },
    industry: { type: "string" },
    pipeline: { type: "string" },
    stage: { type: "string" },
    amount: { type: "string" },
    subject: { type: "string" },
    body: { type: "string" },
    due: { type: "string" },
    properties: { type: "string" },
    contact: { type: "string" },
    deal: { type: "string" },
  },
});

const [resource, action, ...args] = positionals;

// ========== CONTACTS ==========
async function listContacts() {
  const limit = parseInt(values.limit || "20");
  const data = await api(
    `/crm/v3/objects/contacts?limit=${limit}&properties=firstname,lastname,email,phone,company`,
  );
  const contacts = data.results.map((c: Record<string, unknown>) => ({
    id: c.id,
    email: c.properties.email,
    firstname: c.properties.firstname,
    lastname: c.properties.lastname,
    company: c.properties.company,
    phone: c.properties.phone,
  }));
  console.log(JSON.stringify(contacts, null, 2));
}

async function getContact(id: string) {
  const data = await api(
    `/crm/v3/objects/contacts/${id}?properties=firstname,lastname,email,phone,company,lifecyclestage,hs_lead_status`,
  );
  console.log(
    JSON.stringify(
      {
        id: data.id,
        ...data.properties,
        createdAt: data.createdAt,
        updatedAt: data.updatedAt,
      },
      null,
      2,
    ),
  );
}

async function createContact() {
  if (!values.email) {
    console.error("Required: --email <email>");
    process.exit(1);
  }
  const properties: Record<string, string> = { email: values.email };
  if (values.firstname) properties.firstname = values.firstname;
  if (values.lastname) properties.lastname = values.lastname;
  if (values.company) properties.company = values.company;
  if (values.phone) properties.phone = values.phone;

  const data = await api("/crm/v3/objects/contacts", {
    method: "POST",
    body: JSON.stringify({ properties }),
  });
  console.log(`Contact created with ID: ${data.id}`);
}

async function updateContact(id: string) {
  if (!values.properties) {
    console.error('Required: --properties \'{"firstname":"John"}\'');
    process.exit(1);
  }
  const properties = JSON.parse(values.properties);
  await api(`/crm/v3/objects/contacts/${id}`, {
    method: "PATCH",
    body: JSON.stringify({ properties }),
  });
  console.log(`Contact ${id} updated`);
}

async function searchContacts() {
  if (!values.query) {
    console.error("Required: -q <query>");
    process.exit(1);
  }
  const data = await api("/crm/v3/objects/contacts/search", {
    method: "POST",
    body: JSON.stringify({
      query: values.query,
      limit: parseInt(values.limit || "20"),
      properties: ["firstname", "lastname", "email", "phone", "company"],
    }),
  });
  const contacts = data.results.map((c: Record<string, unknown>) => ({
    id: c.id,
    email: c.properties.email,
    firstname: c.properties.firstname,
    lastname: c.properties.lastname,
    company: c.properties.company,
  }));
  console.log(JSON.stringify(contacts, null, 2));
}

// ========== COMPANIES ==========
async function listCompanies() {
  const limit = parseInt(values.limit || "20");
  const data = await api(
    `/crm/v3/objects/companies?limit=${limit}&properties=name,domain,industry,numberofemployees`,
  );
  const companies = data.results.map((c: Record<string, unknown>) => ({
    id: c.id,
    name: c.properties.name,
    domain: c.properties.domain,
    industry: c.properties.industry,
    employees: c.properties.numberofemployees,
  }));
  console.log(JSON.stringify(companies, null, 2));
}

async function getCompany(id: string) {
  const data = await api(
    `/crm/v3/objects/companies/${id}?properties=name,domain,industry,numberofemployees,city,state,country`,
  );
  console.log(
    JSON.stringify(
      {
        id: data.id,
        ...data.properties,
        createdAt: data.createdAt,
        updatedAt: data.updatedAt,
      },
      null,
      2,
    ),
  );
}

async function createCompany() {
  if (!values.name) {
    console.error("Required: --name <company name>");
    process.exit(1);
  }
  const properties: Record<string, string> = { name: values.name };
  if (values.domain) properties.domain = values.domain;
  if (values.industry) properties.industry = values.industry;

  const data = await api("/crm/v3/objects/companies", {
    method: "POST",
    body: JSON.stringify({ properties }),
  });
  console.log(`Company created with ID: ${data.id}`);
}

async function updateCompany(id: string) {
  if (!values.properties) {
    console.error('Required: --properties \'{"name":"Acme"}\'');
    process.exit(1);
  }
  const properties = JSON.parse(values.properties);
  await api(`/crm/v3/objects/companies/${id}`, {
    method: "PATCH",
    body: JSON.stringify({ properties }),
  });
  console.log(`Company ${id} updated`);
}

// ========== DEALS ==========
async function listDeals() {
  const limit = parseInt(values.limit || "20");
  const data = await api(
    `/crm/v3/objects/deals?limit=${limit}&properties=dealname,amount,dealstage,pipeline,closedate`,
  );
  const deals = data.results.map((d: Record<string, unknown>) => ({
    id: d.id,
    name: d.properties.dealname,
    amount: d.properties.amount,
    stage: d.properties.dealstage,
    pipeline: d.properties.pipeline,
    closeDate: d.properties.closedate,
  }));
  console.log(JSON.stringify(deals, null, 2));
}

async function getDeal(id: string) {
  const data = await api(
    `/crm/v3/objects/deals/${id}?properties=dealname,amount,dealstage,pipeline,closedate,hubspot_owner_id`,
  );
  console.log(
    JSON.stringify(
      {
        id: data.id,
        ...data.properties,
        createdAt: data.createdAt,
        updatedAt: data.updatedAt,
      },
      null,
      2,
    ),
  );
}

async function createDeal() {
  if (!values.name || !values.pipeline || !values.stage) {
    console.error("Required: --name <deal name> --pipeline <pipeline id> --stage <stage id>");
    process.exit(1);
  }
  const properties: Record<string, string> = {
    dealname: values.name,
    pipeline: values.pipeline,
    dealstage: values.stage,
  };
  if (values.amount) properties.amount = values.amount;

  const data = await api("/crm/v3/objects/deals", {
    method: "POST",
    body: JSON.stringify({ properties }),
  });
  console.log(`Deal created with ID: ${data.id}`);
}

async function updateDeal(id: string) {
  if (!values.properties) {
    console.error('Required: --properties \'{"amount":"5000"}\'');
    process.exit(1);
  }
  const properties = JSON.parse(values.properties);
  await api(`/crm/v3/objects/deals/${id}`, {
    method: "PATCH",
    body: JSON.stringify({ properties }),
  });
  console.log(`Deal ${id} updated`);
}

// ========== TICKETS ==========
async function listTickets() {
  const limit = parseInt(values.limit || "20");
  const data = await api(
    `/crm/v3/objects/tickets?limit=${limit}&properties=subject,content,hs_pipeline,hs_pipeline_stage,hs_ticket_priority`,
  );
  const tickets = data.results.map((t: Record<string, unknown>) => ({
    id: t.id,
    subject: t.properties.subject,
    content: t.properties.content,
    pipeline: t.properties.hs_pipeline,
    stage: t.properties.hs_pipeline_stage,
    priority: t.properties.hs_ticket_priority,
  }));
  console.log(JSON.stringify(tickets, null, 2));
}

async function getTicket(id: string) {
  const data = await api(
    `/crm/v3/objects/tickets/${id}?properties=subject,content,hs_pipeline,hs_pipeline_stage,hs_ticket_priority,createdate`,
  );
  console.log(
    JSON.stringify(
      {
        id: data.id,
        ...data.properties,
        createdAt: data.createdAt,
        updatedAt: data.updatedAt,
      },
      null,
      2,
    ),
  );
}

async function createTicket() {
  if (!values.subject || !values.pipeline || !values.stage) {
    console.error("Required: --subject <subject> --pipeline <pipeline id> --stage <stage id>");
    process.exit(1);
  }
  const properties: Record<string, string> = {
    subject: values.subject,
    hs_pipeline: values.pipeline,
    hs_pipeline_stage: values.stage,
  };
  if (values.body) properties.content = values.body;

  const data = await api("/crm/v3/objects/tickets", {
    method: "POST",
    body: JSON.stringify({ properties }),
  });
  console.log(`Ticket created with ID: ${data.id}`);
}

async function updateTicket(id: string) {
  if (!values.properties) {
    console.error('Required: --properties \'{"subject":"Updated subject"}\'');
    process.exit(1);
  }
  const properties = JSON.parse(values.properties);
  await api(`/crm/v3/objects/tickets/${id}`, {
    method: "PATCH",
    body: JSON.stringify({ properties }),
  });
  console.log(`Ticket ${id} updated`);
}

// ========== TASKS ==========
async function listTasks() {
  const limit = parseInt(values.limit || "20");
  const data = await api(
    `/crm/v3/objects/tasks?limit=${limit}&properties=hs_task_subject,hs_task_body,hs_task_status,hs_task_priority,hs_timestamp`,
  );
  const tasks = data.results.map((t: Record<string, unknown>) => ({
    id: t.id,
    subject: t.properties.hs_task_subject,
    body: t.properties.hs_task_body,
    status: t.properties.hs_task_status,
    priority: t.properties.hs_task_priority,
    dueDate: t.properties.hs_timestamp,
  }));
  console.log(JSON.stringify(tasks, null, 2));
}

async function getTask(id: string) {
  const data = await api(
    `/crm/v3/objects/tasks/${id}?properties=hs_task_subject,hs_task_body,hs_task_status,hs_task_priority,hs_timestamp`,
  );
  console.log(
    JSON.stringify(
      {
        id: data.id,
        subject: data.properties.hs_task_subject,
        body: data.properties.hs_task_body,
        status: data.properties.hs_task_status,
        priority: data.properties.hs_task_priority,
        dueDate: data.properties.hs_timestamp,
        createdAt: data.createdAt,
        updatedAt: data.updatedAt,
      },
      null,
      2,
    ),
  );
}

async function createTask() {
  if (!values.subject) {
    console.error("Required: --subject <subject>");
    process.exit(1);
  }
  const properties: Record<string, string> = {
    hs_task_subject: values.subject,
    hs_task_status: "NOT_STARTED",
    hs_task_type: "TODO",
  };
  if (values.body) properties.hs_task_body = values.body;
  if (values.due) properties.hs_timestamp = new Date(values.due).getTime().toString();

  const data = await api("/crm/v3/objects/tasks", {
    method: "POST",
    body: JSON.stringify({ properties }),
  });
  console.log(`Task created with ID: ${data.id}`);
}

async function completeTask(id: string) {
  await api(`/crm/v3/objects/tasks/${id}`, {
    method: "PATCH",
    body: JSON.stringify({ properties: { hs_task_status: "COMPLETED" } }),
  });
  console.log(`Task ${id} marked as completed`);
}

// ========== NOTES ==========
async function listNotes() {
  const limit = parseInt(values.limit || "20");
  const data = await api(
    `/crm/v3/objects/notes?limit=${limit}&properties=hs_note_body,hs_timestamp`,
  );
  const notes = data.results.map((n: Record<string, unknown>) => ({
    id: n.id,
    body: n.properties.hs_note_body,
    timestamp: n.properties.hs_timestamp,
  }));
  console.log(JSON.stringify(notes, null, 2));
}

async function createNote() {
  if (!values.body) {
    console.error("Required: --body <note text>");
    process.exit(1);
  }
  const properties: Record<string, string> = {
    hs_note_body: values.body,
    hs_timestamp: Date.now().toString(),
  };

  const data = await api("/crm/v3/objects/notes", {
    method: "POST",
    body: JSON.stringify({ properties }),
  });

  // Associate with contact, company, or deal if specified
  const noteId = data.id;
  if (values.contact) {
    await api(`/crm/v4/objects/notes/${noteId}/associations/contacts/${values.contact}`, {
      method: "PUT",
      body: JSON.stringify([{ associationCategory: "HUBSPOT_DEFINED", associationTypeId: 202 }]),
    });
  }
  if (values.company) {
    await api(`/crm/v4/objects/notes/${noteId}/associations/companies/${values.company}`, {
      method: "PUT",
      body: JSON.stringify([{ associationCategory: "HUBSPOT_DEFINED", associationTypeId: 190 }]),
    });
  }
  if (values.deal) {
    await api(`/crm/v4/objects/notes/${noteId}/associations/deals/${values.deal}`, {
      method: "PUT",
      body: JSON.stringify([{ associationCategory: "HUBSPOT_DEFINED", associationTypeId: 214 }]),
    });
  }

  console.log(`Note created with ID: ${noteId}`);
}

// ========== PIPELINES ==========
async function listDealPipelines() {
  const data = await api("/crm/v3/pipelines/deals");
  const pipelines = data.results.map((p: Record<string, unknown>) => ({
    id: p.id,
    label: p.label,
    stages: p.stages.map((s: Record<string, unknown>) => ({
      id: s.id,
      label: s.label,
      displayOrder: s.displayOrder,
    })),
  }));
  console.log(JSON.stringify(pipelines, null, 2));
}

async function listTicketPipelines() {
  const data = await api("/crm/v3/pipelines/tickets");
  const pipelines = data.results.map((p: Record<string, unknown>) => ({
    id: p.id,
    label: p.label,
    stages: p.stages.map((s: Record<string, unknown>) => ({
      id: s.id,
      label: s.label,
      displayOrder: s.displayOrder,
    })),
  }));
  console.log(JSON.stringify(pipelines, null, 2));
}

// ========== OWNERS ==========
async function listOwners() {
  const data = await api("/crm/v3/owners");
  const owners = data.results.map((o: Record<string, unknown>) => ({
    id: o.id,
    email: o.email,
    firstName: o.firstName,
    lastName: o.lastName,
    userId: o.userId,
  }));
  console.log(JSON.stringify(owners, null, 2));
}

// ========== HELP ==========
function showHelp() {
  console.log(`HubSpot CLI - CRM Management

CONTACTS
  hubspot contacts list [-l limit]                List contacts
  hubspot contacts get <id>                       Get contact details
  hubspot contacts create --email <email> [--firstname] [--lastname] [--company] [--phone]
  hubspot contacts update <id> --properties '{...}'
  hubspot contacts search -q <query>              Search contacts

COMPANIES
  hubspot companies list [-l limit]               List companies
  hubspot companies get <id>                      Get company details
  hubspot companies create --name <name> [--domain] [--industry]
  hubspot companies update <id> --properties '{...}'

DEALS
  hubspot deals list [-l limit]                   List deals
  hubspot deals get <id>                          Get deal details
  hubspot deals create --name <n> --pipeline <id> --stage <id> [--amount]
  hubspot deals update <id> --properties '{...}'

TICKETS
  hubspot tickets list [-l limit]                 List tickets
  hubspot tickets get <id>                        Get ticket details
  hubspot tickets create --subject <s> --pipeline <id> --stage <id> [--body]
  hubspot tickets update <id> --properties '{...}'

TASKS
  hubspot tasks list [-l limit]                   List tasks
  hubspot tasks get <id>                          Get task details
  hubspot tasks create --subject <s> [--body] [--due <date>]
  hubspot tasks complete <id>                     Mark task complete

NOTES
  hubspot notes list [-l limit]                   List notes
  hubspot notes create --body <text> [--contact <id>] [--company <id>] [--deal <id>]

PIPELINES
  hubspot pipelines deals                         List deal pipelines and stages
  hubspot pipelines tickets                       List ticket pipelines and stages

OWNERS
  hubspot owners                                  List owners (sales reps)

OPTIONS
  -h, --help                                      Show this help message`);
}

// ========== MAIN ==========
async function main() {
  if (values.help) {
    showHelp();
    return;
  }

  try {
    switch (resource) {
      case "contacts":
        switch (action) {
          case "list":
            await listContacts();
            break;
          case "get":
            await getContact(args[0]);
            break;
          case "create":
            await createContact();
            break;
          case "update":
            await updateContact(args[0]);
            break;
          case "search":
            await searchContacts();
            break;
          default:
            console.error(`Unknown contacts action: ${action}`);
        }
        break;

      case "companies":
        switch (action) {
          case "list":
            await listCompanies();
            break;
          case "get":
            await getCompany(args[0]);
            break;
          case "create":
            await createCompany();
            break;
          case "update":
            await updateCompany(args[0]);
            break;
          default:
            console.error(`Unknown companies action: ${action}`);
        }
        break;

      case "deals":
        switch (action) {
          case "list":
            await listDeals();
            break;
          case "get":
            await getDeal(args[0]);
            break;
          case "create":
            await createDeal();
            break;
          case "update":
            await updateDeal(args[0]);
            break;
          default:
            console.error(`Unknown deals action: ${action}`);
        }
        break;

      case "tickets":
        switch (action) {
          case "list":
            await listTickets();
            break;
          case "get":
            await getTicket(args[0]);
            break;
          case "create":
            await createTicket();
            break;
          case "update":
            await updateTicket(args[0]);
            break;
          default:
            console.error(`Unknown tickets action: ${action}`);
        }
        break;

      case "tasks":
        switch (action) {
          case "list":
            await listTasks();
            break;
          case "get":
            await getTask(args[0]);
            break;
          case "create":
            await createTask();
            break;
          case "complete":
            await completeTask(args[0]);
            break;
          default:
            console.error(`Unknown tasks action: ${action}`);
        }
        break;

      case "notes":
        switch (action) {
          case "list":
            await listNotes();
            break;
          case "create":
            await createNote();
            break;
          default:
            console.error(`Unknown notes action: ${action}`);
        }
        break;

      case "pipelines":
        switch (action) {
          case "deals":
            await listDealPipelines();
            break;
          case "tickets":
            await listTicketPipelines();
            break;
          default:
            console.error(`Unknown pipelines action: ${action}`);
        }
        break;

      case "owners":
        await listOwners();
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
