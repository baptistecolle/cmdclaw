import { Daytona } from "@daytonaio/sdk";
import { config } from "dotenv";
import path from "path";
import { image } from "./image";

config({ path: path.join(process.cwd(), ".env") });

function getDaytonaConfig(): {
  apiKey?: string;
  jwtToken?: string;
  organizationId?: string;
  apiUrl?: string;
  target?: string;
} {
  const apiKey = process.env.DAYTONA_API_KEY;
  const jwtToken = process.env.DAYTONA_JWT_TOKEN;
  const organizationId = process.env.DAYTONA_ORGANIZATION_ID;
  const apiUrl = process.env.DAYTONA_API_URL ?? process.env.DAYTONA_SERVER_URL;
  const target = process.env.DAYTONA_TARGET;

  if (!apiKey && !(jwtToken && organizationId)) {
    throw new Error(
      "Missing Daytona auth. Set DAYTONA_API_KEY, or set both DAYTONA_JWT_TOKEN and DAYTONA_ORGANIZATION_ID.",
    );
  }

  return {
    ...(apiKey ? { apiKey } : {}),
    ...(jwtToken ? { jwtToken } : {}),
    ...(organizationId ? { organizationId } : {}),
    ...(apiUrl ? { apiUrl } : {}),
    ...(target ? { target } : {}),
  };
}

async function createOrReplaceSnapshot(daytona: Daytona, name: string) {
  const tryCreate = () =>
    daytona.snapshot.create(
      { name, image },
      {
        onLogs: (chunk) => console.log(`[daytona] ${chunk}`),
      },
    );
  const retryCreate = async (attempt: number, lastError?: unknown) => {
    if (attempt > 8) {
      throw new Error(`Unable to recreate snapshot "${name}" after replacement retries.`, {
        cause: lastError,
      });
    }

    await new Promise((resolve) => setTimeout(resolve, 1000 * attempt));
    try {
      return await tryCreate();
    } catch (retryError) {
      const retryRecord = (
        typeof retryError === "object" && retryError !== null ? retryError : {}
      ) as {
        statusCode?: number;
        message?: string;
        response?: { status?: number };
      };
      const retryStatusCode = Number(retryRecord.statusCode ?? retryRecord.response?.status);
      const retryConflict =
        retryStatusCode === 409 || (retryRecord.message ?? "").includes("already exists");
      if (!retryConflict) {
        throw retryError;
      }
      return retryCreate(attempt + 1, retryError);
    }
  };

  try {
    return await tryCreate();
  } catch (error) {
    const errorRecord = (typeof error === "object" && error !== null ? error : {}) as {
      statusCode?: number;
      message?: string;
      response?: { status?: number };
    };
    const statusCode = Number(errorRecord.statusCode ?? errorRecord.response?.status);
    const isConflict = statusCode === 409 || (errorRecord.message ?? "").includes("already exists");
    if (!isConflict) {
      throw error;
    }

    console.log(`Snapshot "${name}" already exists, replacing it...`);
    const existing = await daytona.snapshot.get(name);
    await daytona.snapshot.delete(existing);
    return retryCreate(1);
  }
}

async function main() {
  const daytona = new Daytona(getDaytonaConfig());

  const name = process.env.DAYTONA_SNAPSHOT_DEV || "cmdclaw-agent-dev";
  console.log(`Creating Daytona dev snapshot: ${name}`);

  const snapshot = await createOrReplaceSnapshot(daytona, name);

  console.log("Snapshot created:", snapshot.id ?? name);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
