#!/usr/bin/env node
/**
 * Salesforce CLI Tool
 *
 * Query and manage Salesforce CRM records using the Salesforce REST API.
 * Supports SOQL queries, SOSL searches, and CRUD operations on all standard and custom objects.
 */

const CLI_ARGS = process.argv.slice(2);
const IS_HELP_REQUEST = CLI_ARGS.includes("--help") || CLI_ARGS.includes("-h");
const TOKEN = process.env.SALESFORCE_ACCESS_TOKEN ?? "";
const INSTANCE_URL = process.env.SALESFORCE_INSTANCE_URL ?? "";
const API_VERSION = "v59.0";

if ((!TOKEN || !INSTANCE_URL) && !IS_HELP_REQUEST) {
  console.log(
    JSON.stringify({
      error: {
        code: "AUTH_REQUIRED",
        integration: "salesforce",
        message: "Salesforce authentication required",
      },
    }),
  );
  process.exit(1);
}

const baseUrl = `${INSTANCE_URL}/services/data/${API_VERSION}`;

async function sfFetch(path: string, options: RequestInit = {}) {
  const res = await fetch(`${baseUrl}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      "Content-Type": "application/json",
      ...options.headers,
    },
  });

  if (res.status === 401) {
    console.log(
      JSON.stringify({
        error: {
          code: "AUTH_REQUIRED",
          integration: "salesforce",
          message: "Salesforce session expired, please reconnect",
        },
      }),
    );
    process.exit(1);
  }

  if (!res.ok) {
    const errorText = await res.text();
    let errorMessage: string;
    try {
      const errorJson = JSON.parse(errorText);
      errorMessage = Array.isArray(errorJson)
        ? errorJson[0]?.message || `HTTP ${res.status}`
        : errorJson.message || `HTTP ${res.status}`;
    } catch {
      errorMessage = errorText || `HTTP ${res.status}`;
    }
    throw new Error(errorMessage);
  }

  // Handle 204 No Content (e.g., successful PATCH/DELETE)
  if (res.status === 204) {
    return null;
  }

  return res.json();
}

// Commands
const commands = {
  // SOQL Query - most flexible, works with any object including custom
  async query(soql: string) {
    const encoded = encodeURIComponent(soql);
    return sfFetch(`/query?q=${encoded}`);
  },

  // Get single record by ID
  async get(objectType: string, recordId: string, fields?: string[]) {
    const path = fields
      ? `/sobjects/${objectType}/${recordId}?fields=${fields.join(",")}`
      : `/sobjects/${objectType}/${recordId}`;
    return sfFetch(path);
  },

  // Create new record
  async create(objectType: string, data: Record<string, unknown>) {
    return sfFetch(`/sobjects/${objectType}`, {
      method: "POST",
      body: JSON.stringify(data),
    });
  },

  // Update existing record
  async update(objectType: string, recordId: string, data: Record<string, unknown>) {
    await sfFetch(`/sobjects/${objectType}/${recordId}`, {
      method: "PATCH",
      body: JSON.stringify(data),
    });
    return { success: true, id: recordId };
  },

  // Describe object (get fields, types, picklist values)
  async describe(objectType: string) {
    const result = await sfFetch(`/sobjects/${objectType}/describe`);
    // Return a simplified view of the object metadata
    return {
      name: result.name,
      label: result.label,
      keyPrefix: result.keyPrefix,
      labelPlural: result.labelPlural,
      custom: result.custom,
      createable: result.createable,
      updateable: result.updateable,
      deletable: result.deletable,
      fields: result.fields.map(
        (f: {
          name: string;
          label: string;
          type: string;
          length: number;
          nillable: boolean;
          createable: boolean;
          updateable: boolean;
          picklistValues?: { value: string; label: string; active: boolean }[];
          referenceTo?: string[];
        }) => ({
          name: f.name,
          label: f.label,
          type: f.type,
          length: f.length,
          required: !f.nillable,
          createable: f.createable,
          updateable: f.updateable,
          picklistValues: f.picklistValues?.filter((p) => p.active),
          referenceTo: f.referenceTo,
        }),
      ),
    };
  },

  // List available objects
  async objects() {
    const result = await sfFetch("/sobjects");
    // Return commonly used objects first, then custom objects
    const commonObjects = [
      "Account",
      "Contact",
      "Lead",
      "Opportunity",
      "Task",
      "Event",
      "Case",
      "Campaign",
    ];
    const sobjects = result.sobjects
      .filter((o: { queryable: boolean; createable: boolean }) => o.queryable && o.createable)
      .map((o: { name: string; label: string; custom: boolean }) => ({
        name: o.name,
        label: o.label,
        custom: o.custom,
      }))
      .toSorted((a: { name: string; custom: boolean }, b: { name: string; custom: boolean }) => {
        const aCommon = commonObjects.indexOf(a.name);
        const bCommon = commonObjects.indexOf(b.name);
        if (aCommon !== -1 && bCommon !== -1) {
          return aCommon - bCommon;
        }
        if (aCommon !== -1) {
          return -1;
        }
        if (bCommon !== -1) {
          return 1;
        }
        if (a.custom !== b.custom) {
          return a.custom ? 1 : -1;
        }
        return a.name.localeCompare(b.name);
      });

    return {
      totalSize: sobjects.length,
      commonObjects: sobjects.filter(
        (o: { name: string }) => commonObjects.includes(o.name) || o.name.endsWith("__c"),
      ),
      allObjects: sobjects,
    };
  },

  // Search across objects (SOSL)
  async search(sosl: string) {
    const encoded = encodeURIComponent(sosl);
    return sfFetch(`/search?q=${encoded}`);
  },
};

function showHelp() {
  console.log(`Salesforce CLI

Usage:
  salesforce query <SOQL>
  salesforce get <ObjectType> <RecordId> [field1,field2,...]
  salesforce create <ObjectType> '{"Field":"Value"}'
  salesforce update <ObjectType> <RecordId> '{"Field":"Value"}'
  salesforce describe <ObjectType>
  salesforce objects
  salesforce search <SOSL>

Options:
  -h, --help  Show this help message`);
}

// CLI argument parsing
async function main() {
  if (IS_HELP_REQUEST) {
    showHelp();
    return;
  }

  const args = CLI_ARGS;
  const command = args[0];

  try {
    let result;

    switch (command) {
      case "query": {
        const soql = args.slice(1).join(" ");
        if (!soql) {
          throw new Error("Usage: salesforce query <SOQL>");
        }
        result = await commands.query(soql);
        break;
      }

      case "get": {
        const [, objectType, recordId, ...fieldArgs] = args;
        if (!objectType || !recordId) {
          throw new Error("Usage: salesforce get <ObjectType> <RecordId> [field1,field2,...]");
        }
        const fields = fieldArgs[0]?.split(",");
        result = await commands.get(objectType, recordId, fields);
        break;
      }

      case "create": {
        const [, objectType, jsonData] = args;
        if (!objectType || !jsonData) {
          throw new Error('Usage: salesforce create <ObjectType> \'{"Field": "Value"}\'');
        }
        result = await commands.create(objectType, JSON.parse(jsonData));
        break;
      }

      case "update": {
        const [, objectType, recordId, jsonData] = args;
        if (!objectType || !recordId || !jsonData) {
          throw new Error(
            'Usage: salesforce update <ObjectType> <RecordId> \'{"Field": "Value"}\'',
          );
        }
        result = await commands.update(objectType, recordId, JSON.parse(jsonData));
        break;
      }

      case "describe": {
        const [, objectType] = args;
        if (!objectType) {
          throw new Error("Usage: salesforce describe <ObjectType>");
        }
        result = await commands.describe(objectType);
        break;
      }

      case "objects": {
        result = await commands.objects();
        break;
      }

      case "search": {
        const sosl = args.slice(1).join(" ");
        if (!sosl) {
          throw new Error("Usage: salesforce search <SOSL>");
        }
        result = await commands.search(sosl);
        break;
      }

      default:
        console.log(
          JSON.stringify({
            error: "Unknown command",
            availableCommands: [
              "query <SOQL>       - Execute SOQL query",
              "get <Object> <Id>  - Get record by ID",
              "create <Object> <JSON> - Create new record",
              "update <Object> <Id> <JSON> - Update record",
              "describe <Object>  - Get object metadata",
              "objects            - List available objects",
              "search <SOSL>      - Cross-object search",
            ],
          }),
        );
        process.exit(1);
    }

    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    console.log(
      JSON.stringify({
        error: error instanceof Error ? error.message : "Unknown error",
      }),
    );
    process.exit(1);
  }
}

main();
