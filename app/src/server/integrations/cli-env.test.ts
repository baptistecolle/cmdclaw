import { beforeEach, describe, expect, it, vi } from "vitest";

const { getValidTokensForUserMock, findIntegrationMock } = vi.hoisted(() => ({
  getValidTokensForUserMock: vi.fn(),
  findIntegrationMock: vi.fn(),
}));

vi.mock("@/server/db/client", () => ({
  db: {
    query: {
      integration: {
        findFirst: findIntegrationMock,
      },
    },
  },
}));

vi.mock("./token-refresh", () => ({
  getValidTokensForUser: getValidTokensForUserMock,
  getValidCustomTokens: vi.fn(),
}));

import { getTokensForIntegrations } from "./cli-env";

describe("getTokensForIntegrations", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getValidTokensForUserMock.mockResolvedValue(new Map());
    findIntegrationMock.mockResolvedValue(null);
  });

  it("loads only requested token integrations", async () => {
    getValidTokensForUserMock.mockResolvedValue(
      new Map([
        ["airtable", "airtable-token"],
        ["github", "github-token"],
      ]),
    );

    const tokens = await getTokensForIntegrations("user-1", ["airtable"]);

    expect(getValidTokensForUserMock).toHaveBeenCalledWith("user-1", ["airtable"]);
    expect(tokens).toEqual({
      AIRTABLE_ACCESS_TOKEN: "airtable-token",
    });
  });
});
