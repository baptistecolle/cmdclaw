export type DynamicsInstance = {
  id: string;
  friendlyName: string;
  instanceUrl: string;
  apiUrl: string;
};

type DiscoveryInstance = {
  Id?: unknown;
  FriendlyName?: unknown;
  ApiUrl?: unknown;
  UrlName?: unknown;
};

type DiscoveryResponse = {
  value?: DiscoveryInstance[];
};

function normalizeUrl(value: string): string {
  return value.trim().replace(/\/+$/, "");
}

function deriveInstanceUrl(instance: DiscoveryInstance): string | null {
  if (typeof instance.ApiUrl === "string" && instance.ApiUrl.trim().length > 0) {
    return normalizeUrl(instance.ApiUrl);
  }

  if (typeof instance.UrlName === "string" && instance.UrlName.trim().length > 0) {
    return `https://${instance.UrlName.trim()}.crm.dynamics.com`;
  }

  return null;
}

export async function fetchDynamicsInstances(accessToken: string): Promise<DynamicsInstance[]> {
  const response = await fetch(
    "https://globaldisco.crm.dynamics.com/api/discovery/v2.0/Instances",
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/json",
      },
    },
  );

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Failed to list Dynamics environments: ${response.status} ${errorText}`);
  }

  const payload = (await response.json()) as DiscoveryResponse;
  const rawInstances = Array.isArray(payload.value) ? payload.value : [];
  const dedup = new Map<string, DynamicsInstance>();

  for (const raw of rawInstances) {
    const instanceUrl = deriveInstanceUrl(raw);
    if (!instanceUrl) {
      continue;
    }

    const id = typeof raw.Id === "string" && raw.Id.trim().length > 0 ? raw.Id : instanceUrl;
    const friendlyName =
      typeof raw.FriendlyName === "string" && raw.FriendlyName.trim().length > 0
        ? raw.FriendlyName.trim()
        : instanceUrl;

    dedup.set(instanceUrl, {
      id,
      friendlyName,
      instanceUrl,
      apiUrl: `${instanceUrl}/api/data/v9.2`,
    });
  }

  return Array.from(dedup.values()).toSorted((a, b) =>
    a.friendlyName.localeCompare(b.friendlyName),
  );
}
