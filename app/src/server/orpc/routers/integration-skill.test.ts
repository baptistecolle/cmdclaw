import { beforeEach, describe, expect, it, vi } from "vitest";

function createProcedureStub() {
  const stub: any = {
    input: vi.fn(() => stub),
    output: vi.fn(() => stub),
    handler: vi.fn((fn: any) => fn),
  };
  return stub;
}

const {
  createCommunityIntegrationSkillMock,
  getOfficialIntegrationSkillIndexMock,
  normalizeIntegrationSkillSlugMock,
  resolveIntegrationSkillForUserMock,
  validateIntegrationSkillFilePathMock,
  dbMock,
} = vi.hoisted(() => {
  const createCommunityIntegrationSkillMock = vi.fn();
  const getOfficialIntegrationSkillIndexMock = vi.fn();
  const normalizeIntegrationSkillSlugMock = vi.fn();
  const resolveIntegrationSkillForUserMock = vi.fn();
  const validateIntegrationSkillFilePathMock = vi.fn();

  const dbMock = {
    query: {
      integrationSkill: {
        findMany: vi.fn(),
      },
    },
  };

  return {
    createCommunityIntegrationSkillMock,
    getOfficialIntegrationSkillIndexMock,
    normalizeIntegrationSkillSlugMock,
    resolveIntegrationSkillForUserMock,
    validateIntegrationSkillFilePathMock,
    dbMock,
  };
});

vi.mock("../middleware", () => ({
  protectedProcedure: createProcedureStub(),
}));

vi.mock("@/server/db/client", () => ({
  db: dbMock,
}));

vi.mock("@/server/services/integration-skill-service", () => ({
  createCommunityIntegrationSkill: createCommunityIntegrationSkillMock,
  getOfficialIntegrationSkillIndex: getOfficialIntegrationSkillIndexMock,
  normalizeIntegrationSkillSlug: normalizeIntegrationSkillSlugMock,
  resolveIntegrationSkillForUser: resolveIntegrationSkillForUserMock,
  validateIntegrationSkillFilePath: validateIntegrationSkillFilePathMock,
}));

import { integrationSkillRouter } from "./integration-skill";
const integrationSkillRouterAny = integrationSkillRouter as any;

function createContext() {
  const insertOnConflictDoUpdateMock = vi.fn().mockResolvedValue(undefined);
  const insertValuesMock = vi.fn(() => ({
    onConflictDoUpdate: insertOnConflictDoUpdateMock,
  }));
  const insertMock = vi.fn(() => ({ values: insertValuesMock }));

  const updateWhereMock = vi.fn().mockResolvedValue(undefined);
  const updateSetMock = vi.fn(() => ({ where: updateWhereMock }));
  const updateMock = vi.fn(() => ({ set: updateSetMock }));

  const deleteWhereMock = vi.fn().mockResolvedValue(undefined);
  const deleteMock = vi.fn(() => ({ where: deleteWhereMock }));

  const context: any = {
    user: { id: "user-1" },
    db: {
      query: {
        integrationSkill: {
          findMany: vi.fn(),
          findFirst: vi.fn(),
        },
        integrationSkillPreference: {
          findFirst: vi.fn(),
        },
      },
      insert: insertMock,
      update: updateMock,
      delete: deleteMock,
    },
    mocks: {
      insertOnConflictDoUpdateMock,
      insertValuesMock,
      updateSetMock,
      updateWhereMock,
      deleteWhereMock,
    },
  };

  return context;
}

describe("integrationSkillRouter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    normalizeIntegrationSkillSlugMock.mockImplementation((value: string) =>
      value.trim().toLowerCase(),
    );
    getOfficialIntegrationSkillIndexMock.mockResolvedValue(new Map());
    createCommunityIntegrationSkillMock.mockResolvedValue({
      id: "skill-1",
      slug: "slack",
    });
    resolveIntegrationSkillForUserMock.mockResolvedValue(null);
    validateIntegrationSkillFilePathMock.mockReturnValue(true);
    dbMock.query.integrationSkill.findMany.mockResolvedValue([]);
  });

  it("creates community skill from chat on happy path", async () => {
    const context = createContext();

    const result = await integrationSkillRouterAny.createFromChat({
      input: {
        slug: "  Slack  ",
        title: "Slack Helper",
        description: "Helps with Slack operations",
        files: [{ path: "SKILL.md", content: "body" }],
        setAsPreferred: true,
      },
      context,
    });

    expect(result).toEqual({
      id: "skill-1",
      slug: "slack",
      source: "community",
      setAsPreferred: true,
    });
    expect(createCommunityIntegrationSkillMock).toHaveBeenCalledWith("user-1", {
      slug: "slack",
      title: "Slack Helper",
      description: "Helps with Slack operations",
      files: [{ path: "SKILL.md", content: "body" }],
      setAsPreferred: true,
    });
  });

  it("returns BAD_REQUEST when createFromChat receives an invalid slug", async () => {
    const context = createContext();
    normalizeIntegrationSkillSlugMock.mockReturnValue("");

    await expect(
      integrationSkillRouterAny.createFromChat({
        input: {
          slug: "!!!",
          title: "Bad",
          description: "Bad",
          files: [],
          setAsPreferred: false,
        },
        context,
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST", message: "Invalid slug" });
  });

  it("maps unknown create errors to a generic BAD_REQUEST message", async () => {
    const context = createContext();
    createCommunityIntegrationSkillMock.mockRejectedValue("unexpected");

    await expect(
      integrationSkillRouterAny.createFromChat({
        input: {
          slug: "slack",
          title: "Slack",
          description: "Slack",
          files: [],
          setAsPreferred: false,
        },
        context,
      }),
    ).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: "Failed to create integration skill",
    });
  });

  it("maps Error instances from createFromChat to BAD_REQUEST with the original message", async () => {
    const context = createContext();
    createCommunityIntegrationSkillMock.mockRejectedValue(
      new Error("already exists"),
    );

    await expect(
      integrationSkillRouterAny.createFromChat({
        input: {
          slug: "slack",
          title: "Slack",
          description: "Slack",
          files: [],
          setAsPreferred: false,
        },
        context,
      }),
    ).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: "already exists",
    });
  });

  it("lists by slug with official, preference, and ownership metadata", async () => {
    const context = createContext();
    const now = new Date("2026-01-01T12:00:00.000Z");
    getOfficialIntegrationSkillIndexMock.mockResolvedValue(
      new Map([
        [
          "slack",
          {
            slug: "slack",
            description: "Official Slack skill",
            dirName: "slack",
          },
        ],
      ]),
    );
    context.db.query.integrationSkill.findMany.mockResolvedValue([
      {
        id: "skill-own",
        slug: "slack",
        title: "Mine",
        description: "Mine desc",
        createdByUserId: "user-1",
        createdAt: now,
        updatedAt: now,
        files: [{ id: "file-1" }],
      },
      {
        id: "skill-other",
        slug: "slack",
        title: "Other",
        description: "Other desc",
        createdByUserId: "user-2",
        createdAt: now,
        updatedAt: now,
        files: [{ id: "file-2" }, { id: "file-3" }],
      },
    ]);
    context.db.query.integrationSkillPreference.findFirst.mockResolvedValue({
      preferredSource: "community",
      preferredSkillId: "skill-own",
    });

    const result = await integrationSkillRouterAny.listBySlug({
      input: { slug: "slack" },
      context,
    });
    const findManyArgs =
      context.db.query.integrationSkill.findMany.mock.calls[0]?.[0];
    const orderByResult = findManyArgs.orderBy(
      { createdAt: "createdAt-field" },
      { desc: (value: unknown) => `desc(${String(value)})` },
    );

    expect(result).toEqual({
      slug: "slack",
      official: {
        slug: "slack",
        description: "Official Slack skill",
        dirName: "slack",
      },
      preference: {
        preferredSource: "community",
        preferredSkillId: "skill-own",
      },
      community: [
        {
          id: "skill-own",
          slug: "slack",
          title: "Mine",
          description: "Mine desc",
          createdByUserId: "user-1",
          isOwnedByMe: true,
          createdAt: now,
          updatedAt: now,
          fileCount: 1,
        },
        {
          id: "skill-other",
          slug: "slack",
          title: "Other",
          description: "Other desc",
          createdByUserId: "user-2",
          isOwnedByMe: false,
          createdAt: now,
          updatedAt: now,
          fileCount: 2,
        },
      ],
    });
    expect(orderByResult).toEqual(["desc(createdAt-field)"]);
  });

  it("lists by slug with null official and null preference", async () => {
    const context = createContext();
    getOfficialIntegrationSkillIndexMock.mockResolvedValue(new Map());
    context.db.query.integrationSkill.findMany.mockResolvedValue([]);
    context.db.query.integrationSkillPreference.findFirst.mockResolvedValue(
      null,
    );

    const result = await integrationSkillRouterAny.listBySlug({
      input: { slug: "slack" },
      context,
    });

    expect(result).toEqual({
      slug: "slack",
      official: null,
      preference: null,
      community: [],
    });
  });

  it("gets resolved skill for user and returns null preference when none exists", async () => {
    const context = createContext();
    const resolved = {
      source: "official",
      slug: "slack",
      description: "Official Slack skill",
      dirName: "slack",
    };
    resolveIntegrationSkillForUserMock.mockResolvedValue(resolved);
    context.db.query.integrationSkillPreference.findFirst.mockResolvedValue(
      null,
    );

    const result = await integrationSkillRouterAny.getResolvedForUser({
      input: { slug: "slack" },
      context,
    });

    expect(resolveIntegrationSkillForUserMock).toHaveBeenCalledWith(
      "user-1",
      "slack",
    );
    expect(result).toEqual({
      slug: "slack",
      resolved,
      preference: null,
    });
  });

  it("gets resolved skill for user and includes persisted preference", async () => {
    const context = createContext();
    resolveIntegrationSkillForUserMock.mockResolvedValue({
      source: "community",
      slug: "slack",
      id: "skill-1",
      title: "Community Slack",
      description: "desc",
      files: [{ path: "SKILL.md", content: "..." }],
      createdByUserId: "user-2",
    });
    context.db.query.integrationSkillPreference.findFirst.mockResolvedValue({
      preferredSource: "community",
      preferredSkillId: "skill-1",
    });

    const result = await integrationSkillRouterAny.getResolvedForUser({
      input: { slug: "slack" },
      context,
    });

    expect(result).toEqual({
      slug: "slack",
      resolved: {
        source: "community",
        slug: "slack",
        id: "skill-1",
        title: "Community Slack",
        description: "desc",
        files: [{ path: "SKILL.md", content: "..." }],
        createdByUserId: "user-2",
      },
      preference: {
        preferredSource: "community",
        preferredSkillId: "skill-1",
      },
    });
  });

  it("rejects community preference without preferredSkillId", async () => {
    const context = createContext();

    await expect(
      integrationSkillRouterAny.setPreference({
        input: { slug: "slack", preferredSource: "community" },
        context,
      }),
    ).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: "preferredSkillId is required for community preference",
    });
  });

  it("rejects community preference when selected skill is missing", async () => {
    const context = createContext();
    context.db.query.integrationSkill.findFirst.mockResolvedValue(null);

    await expect(
      integrationSkillRouterAny.setPreference({
        input: {
          slug: "slack",
          preferredSource: "community",
          preferredSkillId: "missing",
        },
        context,
      }),
    ).rejects.toMatchObject({
      code: "NOT_FOUND",
      message: "Community integration skill not found",
    });
  });

  it("rejects official preference when no official skill exists", async () => {
    const context = createContext();
    getOfficialIntegrationSkillIndexMock.mockResolvedValue(new Map());

    await expect(
      integrationSkillRouterAny.setPreference({
        input: { slug: "slack", preferredSource: "official" },
        context,
      }),
    ).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: "No official integration skill exists for slug 'slack'",
    });
  });

  it("saves official preference with null preferredSkillId", async () => {
    const context = createContext();
    getOfficialIntegrationSkillIndexMock.mockResolvedValue(
      new Map([
        ["slack", { slug: "slack", description: "", dirName: "slack" }],
      ]),
    );

    const result = await integrationSkillRouterAny.setPreference({
      input: { slug: "slack", preferredSource: "official" },
      context,
    });

    expect(result).toEqual({ success: true });
    expect(context.mocks.insertValuesMock).toHaveBeenCalledWith({
      userId: "user-1",
      slug: "slack",
      preferredSource: "official",
      preferredSkillId: null,
    });
    expect(context.mocks.insertOnConflictDoUpdateMock).toHaveBeenCalledTimes(1);
  });

  it("saves community preference when selected skill exists", async () => {
    const context = createContext();
    context.db.query.integrationSkill.findFirst.mockResolvedValue({
      id: "skill-1",
    });

    const result = await integrationSkillRouterAny.setPreference({
      input: {
        slug: "slack",
        preferredSource: "community",
        preferredSkillId: "skill-1",
      },
      context,
    });

    expect(result).toEqual({ success: true });
    expect(context.mocks.insertValuesMock).toHaveBeenCalledWith({
      userId: "user-1",
      slug: "slack",
      preferredSource: "community",
      preferredSkillId: "skill-1",
    });
  });

  it("rejects updateCommunitySkill when skill is missing", async () => {
    const context = createContext();
    context.db.query.integrationSkill.findFirst.mockResolvedValue(null);

    await expect(
      integrationSkillRouterAny.updateCommunitySkill({
        input: { id: "missing" },
        context,
      }),
    ).rejects.toMatchObject({
      code: "NOT_FOUND",
      message: "Integration skill not found",
    });
  });

  it("rejects updateCommunitySkill when requester is not the owner", async () => {
    const context = createContext();
    context.db.query.integrationSkill.findFirst.mockResolvedValue({
      id: "skill-1",
      title: "Old",
      description: "Old",
      createdByUserId: "other-user",
    });

    await expect(
      integrationSkillRouterAny.updateCommunitySkill({
        input: { id: "skill-1", title: "New" },
        context,
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN", message: "Not allowed" });
  });

  it("rejects updateCommunitySkill on invalid file path", async () => {
    const context = createContext();
    context.db.query.integrationSkill.findFirst.mockResolvedValue({
      id: "skill-1",
      title: "Old",
      description: "Old",
      createdByUserId: "user-1",
    });
    validateIntegrationSkillFilePathMock.mockImplementation(
      (path: string) => path !== "../bad.md",
    );

    await expect(
      integrationSkillRouterAny.updateCommunitySkill({
        input: {
          id: "skill-1",
          files: [{ path: "../bad.md", content: "bad" }],
        },
        context,
      }),
    ).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: "Invalid file path: ../bad.md",
    });
  });

  it("rejects updateCommunitySkill on duplicate file paths", async () => {
    const context = createContext();
    context.db.query.integrationSkill.findFirst.mockResolvedValue({
      id: "skill-1",
      title: "Old",
      description: "Old",
      createdByUserId: "user-1",
    });

    await expect(
      integrationSkillRouterAny.updateCommunitySkill({
        input: {
          id: "skill-1",
          files: [
            { path: "one.md", content: "1" },
            { path: "one.md", content: "2" },
          ],
        },
        context,
      }),
    ).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: "Duplicate file path: one.md",
    });
  });

  it("updates metadata and files for owned community skill", async () => {
    const context = createContext();
    context.db.query.integrationSkill.findFirst.mockResolvedValue({
      id: "skill-1",
      title: "Old",
      description: "Old",
      createdByUserId: "user-1",
    });

    const result = await integrationSkillRouterAny.updateCommunitySkill({
      input: {
        id: "skill-1",
        title: "New",
        description: "New description",
        files: [{ path: "SKILL.md", content: "updated" }],
      },
      context,
    });

    expect(result).toEqual({ success: true });
    expect(context.mocks.updateSetMock).toHaveBeenCalledWith({
      title: "New",
      description: "New description",
    });
    expect(context.mocks.deleteWhereMock).toHaveBeenCalledTimes(1);
    expect(context.db.insert).toHaveBeenCalledTimes(1);
  });

  it("updates metadata only when files are omitted", async () => {
    const context = createContext();
    context.db.query.integrationSkill.findFirst.mockResolvedValue({
      id: "skill-1",
      title: "Existing Title",
      description: "Existing Description",
      createdByUserId: "user-1",
    });

    const result = await integrationSkillRouterAny.updateCommunitySkill({
      input: {
        id: "skill-1",
        title: "Renamed",
      },
      context,
    });

    expect(result).toEqual({ success: true });
    expect(context.mocks.updateSetMock).toHaveBeenCalledWith({
      title: "Renamed",
      description: "Existing Description",
    });
    expect(context.mocks.deleteWhereMock).not.toHaveBeenCalled();
  });

  it("rejects deleteCommunitySkill when missing or not owned", async () => {
    const context = createContext();
    context.db.query.integrationSkill.findFirst.mockResolvedValueOnce(null);

    await expect(
      integrationSkillRouterAny.deleteCommunitySkill({
        input: { id: "missing" },
        context,
      }),
    ).rejects.toMatchObject({
      code: "NOT_FOUND",
      message: "Integration skill not found",
    });

    context.db.query.integrationSkill.findFirst.mockResolvedValueOnce({
      id: "skill-1",
      createdByUserId: "other-user",
    });

    await expect(
      integrationSkillRouterAny.deleteCommunitySkill({
        input: { id: "skill-1" },
        context,
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN", message: "Not allowed" });
  });

  it("deletes owned community skill by soft-disabling it", async () => {
    const context = createContext();
    context.db.query.integrationSkill.findFirst.mockResolvedValue({
      id: "skill-1",
      createdByUserId: "user-1",
    });

    const result = await integrationSkillRouterAny.deleteCommunitySkill({
      input: { id: "skill-1" },
      context,
    });

    expect(result).toEqual({ success: true });
    expect(context.mocks.updateSetMock).toHaveBeenCalledWith({
      isActive: false,
    });
  });

  it("lists public community skills with default limit when input is omitted", async () => {
    const now = new Date("2026-01-02T00:00:00.000Z");
    dbMock.query.integrationSkill.findMany.mockResolvedValue([
      {
        id: "skill-1",
        slug: "slack",
        title: "Slack Public",
        description: "Public description",
        createdByUserId: "user-1",
        createdAt: now,
        updatedAt: now,
      },
    ]);

    const result = await integrationSkillRouterAny.listPublic({
      input: undefined,
    });
    const findManyArgs =
      dbMock.query.integrationSkill.findMany.mock.calls[0]?.[0];
    const orderByResult = findManyArgs.orderBy(
      { createdAt: "createdAt-field" },
      { desc: (value: unknown) => `desc(${String(value)})` },
    );

    expect(dbMock.query.integrationSkill.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ limit: 50 }),
    );
    expect(orderByResult).toEqual(["desc(createdAt-field)"]);
    expect(result).toEqual([
      {
        id: "skill-1",
        slug: "slack",
        title: "Slack Public",
        description: "Public description",
        createdByUserId: "user-1",
        createdAt: now,
        updatedAt: now,
      },
    ]);
  });

  it("lists public community skills using normalized slug and custom limit", async () => {
    normalizeIntegrationSkillSlugMock.mockReturnValue("github");
    dbMock.query.integrationSkill.findMany.mockResolvedValue([]);

    await integrationSkillRouterAny.listPublic({
      input: { slug: "  GitHub  ", limit: 10 },
    });

    expect(normalizeIntegrationSkillSlugMock).toHaveBeenCalledWith(
      "  GitHub  ",
    );
    expect(dbMock.query.integrationSkill.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ limit: 10 }),
    );
  });
});
