import { describe, expect, it } from "vitest";
import { getOAuthConfig } from "./config";

function encodeBase64Url(value: string): string {
  return Buffer.from(value, "utf8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

describe("OAuth config", () => {
  it("includes compose scope for Gmail draft creation", () => {
    const config = getOAuthConfig("gmail");

    expect(config.scopes).toContain("https://www.googleapis.com/auth/gmail.compose");
  });

  it("uses Dynamics scopes without mixing in Microsoft Graph resource scopes", () => {
    const config = getOAuthConfig("dynamics");

    expect(config.scopes).not.toContain("User.Read");
    expect(config.scopes).toContain("https://globaldisco.crm.dynamics.com/user_impersonation");
  });

  it("extracts Dynamics user info from token claims", async () => {
    const config = getOAuthConfig("dynamics");
    const token = [
      encodeBase64Url(JSON.stringify({ alg: "none", typ: "JWT" })),
      encodeBase64Url(
        JSON.stringify({
          oid: "user-oid-123",
          preferred_username: "user@contoso.com",
          email: "user@contoso.com",
        }),
      ),
      "signature",
    ].join(".");

    const userInfo = await config.getUserInfo(token);

    expect(userInfo).toEqual({
      id: "user-oid-123",
      displayName: "user@contoso.com",
      metadata: {
        userPrincipalName: "user@contoso.com",
        email: "user@contoso.com",
      },
    });
  });
});
