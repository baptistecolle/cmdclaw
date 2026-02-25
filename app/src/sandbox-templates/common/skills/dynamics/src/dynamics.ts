#!/usr/bin/env node

const TOKEN = process.env.DYNAMICS_ACCESS_TOKEN;
const INSTANCE_URL = process.env.DYNAMICS_INSTANCE_URL;
const API_VERSION = "v9.2";

if (!TOKEN || !INSTANCE_URL) {
  console.log(
    JSON.stringify({
      error: {
        code: "AUTH_REQUIRED",
        integration: "dynamics",
        message: "Microsoft Dynamics authentication required",
      },
    }),
  );
  process.exit(1);
}

const baseUrl = `${INSTANCE_URL.replace(/\/+$/, "")}/api/data/${API_VERSION}`;

async function dvFetch(path: string, options: RequestInit = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      Accept: "application/json",
      "Content-Type": "application/json",
      "OData-Version": "4.0",
      "OData-MaxVersion": "4.0",
      ...options.headers,
    },
  });

  if (response.status === 401) {
    console.log(
      JSON.stringify({
        error: {
          code: "AUTH_REQUIRED",
          integration: "dynamics",
          message: "Dynamics session expired, please reconnect",
        },
      }),
    );
    process.exit(1);
  }

  if (!response.ok) {
    const raw = await response.text();
    let message = raw || `HTTP ${response.status}`;
    try {
      const parsed = JSON.parse(raw) as { error?: { message?: string } };
      if (parsed?.error?.message) {
        message = parsed.error.message;
      }
    } catch {
      // keep raw fallback
    }
    throw new Error(message);
  }

  if (response.status === 204) {
    return null;
  }

  return response.json();
}

function getArgValue(args: string[], flag: string): string | undefined {
  const index = args.findIndex((arg) => arg === flag);
  if (index < 0) {
    return undefined;
  }
  return args[index + 1];
}

function buildQuery(args: string[]): string {
  const params = new URLSearchParams();

  const select = getArgValue(args, "--select");
  const filter = getArgValue(args, "--filter");
  const orderBy = getArgValue(args, "--orderby");
  const top = getArgValue(args, "--top");

  if (select) {
    params.set("$select", select);
  }
  if (filter) {
    params.set("$filter", filter);
  }
  if (orderBy) {
    params.set("$orderby", orderBy);
  }
  if (top) {
    params.set("$top", top);
  }

  const query = params.toString();
  return query ? `?${query}` : "";
}

async function main() {
  const args = process.argv.slice(2);
  const resource = args[0];
  const action = args[1];

  try {
    let result: unknown;

    if (resource === "whoami") {
      result = await dvFetch("/WhoAmI()", { method: "GET" });
      console.log(JSON.stringify(result, null, 2));
      return;
    }

    if (!resource || !action) {
      throw new Error("Usage: dynamics <tables|rows|whoami> <action>");
    }

    if (resource === "tables") {
      if (action === "list") {
        const top = getArgValue(args, "--top") || "50";
        result = await dvFetch(
          `/EntityDefinitions?$select=LogicalName,SchemaName,DisplayName,IsCustomEntity&$top=${encodeURIComponent(top)}`,
        );
      } else if (action === "get") {
        const logicalName = args[2];
        if (!logicalName) {
          throw new Error("Usage: dynamics tables get <logicalName>");
        }
        result = await dvFetch(
          `/EntityDefinitions(LogicalName='${encodeURIComponent(logicalName)}')?$select=LogicalName,SchemaName,DisplayName,PrimaryIdAttribute,PrimaryNameAttribute&$expand=Attributes($select=LogicalName,AttributeType,RequiredLevel,MaxLength,IsPrimaryId,IsPrimaryName;$top=200)`,
        );
      } else {
        throw new Error("Usage: dynamics tables <list|get>");
      }
    } else if (resource === "rows") {
      const table = args[2];
      if (!table) {
        throw new Error("Usage: dynamics rows <list|get|create|update|delete> <table> ...");
      }

      if (action === "list") {
        const query = buildQuery(args.slice(3));
        result = await dvFetch(`/${encodeURIComponent(table)}${query}`);
      } else if (action === "get") {
        const rowId = args[3];
        if (!rowId) {
          throw new Error("Usage: dynamics rows get <table> <rowId> [--select col1,col2]");
        }
        const query = buildQuery(args.slice(4));
        result = await dvFetch(
          `/${encodeURIComponent(table)}(${encodeURIComponent(rowId)})${query}`,
        );
      } else if (action === "create") {
        const jsonData = args[3];
        if (!jsonData) {
          throw new Error('Usage: dynamics rows create <table> \'{"field":"value"}\'');
        }
        result = await dvFetch(`/${encodeURIComponent(table)}`, {
          method: "POST",
          body: jsonData,
        });
      } else if (action === "update") {
        const rowId = args[3];
        const jsonData = args[4];
        if (!rowId || !jsonData) {
          throw new Error('Usage: dynamics rows update <table> <rowId> \'{"field":"value"}\'');
        }
        await dvFetch(`/${encodeURIComponent(table)}(${encodeURIComponent(rowId)})`, {
          method: "PATCH",
          body: jsonData,
        });
        result = { success: true, id: rowId };
      } else if (action === "delete") {
        const rowId = args[3];
        if (!rowId) {
          throw new Error("Usage: dynamics rows delete <table> <rowId>");
        }
        await dvFetch(`/${encodeURIComponent(table)}(${encodeURIComponent(rowId)})`, {
          method: "DELETE",
        });
        result = { success: true, id: rowId };
      } else {
        throw new Error("Usage: dynamics rows <list|get|create|update|delete> <table> ...");
      }
    } else {
      throw new Error("Usage: dynamics <tables|rows|whoami> <action>");
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

export const __dynamicsCliModule = true;
