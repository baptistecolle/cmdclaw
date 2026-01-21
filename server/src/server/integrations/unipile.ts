import { env } from "@/env";

const getUnipileBaseUrl = () => `https://${env.UNIPILE_DSN}`;
const getAppUrl = () => env.APP_URL ?? "http://localhost:3000";

interface UnipileAccount {
  id: string;
  name: string;
  type: string;
  identifier: string;
  created_at: string;
  sources: Array<{
    status: string;
  }>;
}

interface UnipileProfile {
  provider_id: string;
  display_name: string;
  public_identifier: string;
  headline?: string;
  location?: string;
}

interface HostedAuthResponse {
  url: string;
  code: string;
}

export async function generateLinkedInAuthUrl(
  userId: string,
  redirectUrl: string
): Promise<string> {
  const response = await fetch(
    `${getUnipileBaseUrl()}/api/v1/hosted/accounts/link`,
    {
      method: "POST",
      headers: {
        "X-API-KEY": env.UNIPILE_API_KEY!,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        type: "LINKEDIN",
        api_url: env.UNIPILE_DSN,
        expiresOn: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
        notify_url: `${getAppUrl()}/api/integrations/linkedin/webhook`,
        success_redirect_url: redirectUrl,
        failure_redirect_url: redirectUrl,
        name: userId,
      }),
    }
  );

  if (!response.ok) {
    const error = await response.text();
    console.error("Failed to generate LinkedIn auth URL:", error);
    throw new Error("Failed to generate LinkedIn auth URL");
  }

  const data = (await response.json()) as HostedAuthResponse;
  return data.url;
}

export async function getUnipileAccount(
  accountId: string
): Promise<UnipileAccount> {
  const response = await fetch(
    `${getUnipileBaseUrl()}/api/v1/accounts/${accountId}`,
    {
      headers: {
        "X-API-KEY": env.UNIPILE_API_KEY!,
        Accept: "application/json",
      },
    }
  );

  if (!response.ok) {
    const error = await response.text();
    console.error("Failed to get Unipile account:", error);
    throw new Error("Failed to get Unipile account");
  }

  return response.json();
}

export async function getLinkedInProfile(
  accountId: string
): Promise<UnipileProfile> {
  const response = await fetch(
    `${getUnipileBaseUrl()}/api/v1/users/me?account_id=${accountId}`,
    {
      headers: {
        "X-API-KEY": env.UNIPILE_API_KEY!,
        Accept: "application/json",
      },
    }
  );

  if (!response.ok) {
    const error = await response.text();
    console.error("Failed to get LinkedIn profile:", error);
    throw new Error("Failed to get LinkedIn profile");
  }

  return response.json();
}

export async function deleteUnipileAccount(accountId: string): Promise<void> {
  const response = await fetch(
    `${getUnipileBaseUrl()}/api/v1/accounts/${accountId}`,
    {
      method: "DELETE",
      headers: {
        "X-API-KEY": env.UNIPILE_API_KEY!,
        Accept: "application/json",
      },
    }
  );

  if (!response.ok) {
    const error = await response.text();
    console.error("Failed to delete Unipile account:", error);
    throw new Error("Failed to delete Unipile account");
  }
}
