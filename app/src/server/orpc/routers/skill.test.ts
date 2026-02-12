import { ORPCError } from "@orpc/server";
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
  uploadToS3Mock,
  deleteFromS3Mock,
  getPresignedDownloadUrlMock,
  generateStorageKeyMock,
  ensureBucketMock,
  validateFileUploadMock,
} = vi.hoisted(() => ({
  uploadToS3Mock: vi.fn(),
  deleteFromS3Mock: vi.fn(),
  getPresignedDownloadUrlMock: vi.fn(),
  generateStorageKeyMock: vi.fn(),
  ensureBucketMock: vi.fn(),
  validateFileUploadMock: vi.fn(),
}));

vi.mock("../middleware", () => ({
  protectedProcedure: createProcedureStub(),
}));

vi.mock("@/server/storage/s3-client", () => ({
  uploadToS3: uploadToS3Mock,
  deleteFromS3: deleteFromS3Mock,
  getPresignedDownloadUrl: getPresignedDownloadUrlMock,
  generateStorageKey: generateStorageKeyMock,
  ensureBucket: ensureBucketMock,
}));

vi.mock("@/server/storage/validation", () => ({
  validateFileUpload: validateFileUploadMock,
}));

import { skillRouter } from "./skill";

const skillRouterAny = skillRouter as any;

function createContext() {
  const insertReturningMock = vi.fn();
  const insertValuesMock = vi.fn(() => ({ returning: insertReturningMock }));
  const insertMock = vi.fn(() => ({ values: insertValuesMock }));

  const updateReturningMock = vi.fn();
  const updateWhereMock = vi.fn(() => ({ returning: updateReturningMock }));
  const updateSetMock = vi.fn(() => ({ where: updateWhereMock }));
  const updateMock = vi.fn(() => ({ set: updateSetMock }));

  const deleteReturningMock = vi.fn();
  const deleteWhereMock = vi.fn(() => ({ returning: deleteReturningMock }));
  const deleteMock = vi.fn(() => ({ where: deleteWhereMock }));

  const selectWhereMock = vi.fn();
  const selectFromMock = vi.fn(() => ({ where: selectWhereMock }));
  const selectMock = vi.fn(() => ({ from: selectFromMock }));

  const context: any = {
    user: { id: "user-1" },
    db: {
      query: {
        skill: {
          findMany: vi.fn(),
          findFirst: vi.fn(),
        },
        skillFile: {
          findFirst: vi.fn(),
        },
        skillDocument: {
          findFirst: vi.fn(),
        },
      },
      insert: insertMock,
      update: updateMock,
      delete: deleteMock,
      select: selectMock,
    },
    mocks: {
      insertReturningMock,
      insertValuesMock,
      updateSetMock,
      updateReturningMock,
      deleteReturningMock,
      selectWhereMock,
    },
  };

  return context;
}

describe("skillRouter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    generateStorageKeyMock.mockReturnValue("skills/user-1/skill-1/doc.pdf");
    getPresignedDownloadUrlMock.mockResolvedValue(
      "https://example.com/presigned-url",
    );
  });

  it("lists user skills and maps file counts", async () => {
    const context = createContext();
    const now = new Date("2024-01-01T00:00:00.000Z");
    context.db.query.skill.findMany.mockResolvedValue([
      {
        id: "skill-1",
        name: "my-skill",
        displayName: "My Skill",
        description: "desc",
        icon: "rocket",
        enabled: true,
        files: [{ id: "f1" }, { id: "f2" }],
        createdAt: now,
        updatedAt: now,
      },
    ]);

    const result = await skillRouterAny.list({ context });

    expect(result).toEqual([
      {
        id: "skill-1",
        name: "my-skill",
        displayName: "My Skill",
        description: "desc",
        icon: "rocket",
        enabled: true,
        fileCount: 2,
        createdAt: now,
        updatedAt: now,
      },
    ]);
  });

  it("gets a skill with files and documents", async () => {
    const context = createContext();
    const now = new Date("2024-02-02T00:00:00.000Z");
    context.db.query.skill.findFirst.mockResolvedValue({
      id: "skill-1",
      name: "my-skill",
      displayName: "My Skill",
      description: "desc",
      icon: null,
      enabled: false,
      files: [
        {
          id: "file-1",
          path: "SKILL.md",
          content: "content",
          createdAt: now,
          updatedAt: now,
        },
      ],
      documents: [
        {
          id: "doc-1",
          filename: "doc.pdf",
          mimeType: "application/pdf",
          sizeBytes: 42,
          description: "spec",
          createdAt: now,
        },
      ],
      createdAt: now,
      updatedAt: now,
    });

    const result = await skillRouterAny.get({
      input: { id: "skill-1" },
      context,
    });

    expect(result.id).toBe("skill-1");
    expect(result.files).toEqual([
      {
        id: "file-1",
        path: "SKILL.md",
        content: "content",
        createdAt: now,
        updatedAt: now,
      },
    ]);
    expect(result.documents).toEqual([
      {
        id: "doc-1",
        filename: "doc.pdf",
        mimeType: "application/pdf",
        sizeBytes: 42,
        description: "spec",
        createdAt: now,
      },
    ]);
  });

  it("returns NOT_FOUND when getting an unknown skill", async () => {
    const context = createContext();
    context.db.query.skill.findFirst.mockResolvedValue(null);

    await expect(
      skillRouterAny.get({
        input: { id: "skill-missing" },
        context,
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("creates a skill and seeds a default SKILL.md file", async () => {
    const context = createContext();
    context.mocks.insertReturningMock.mockResolvedValue([
      {
        id: "skill-1",
        name: "my-skill",
        displayName: "My Skill",
        description: "A test skill",
        icon: "sparkles",
      },
    ]);

    const result = await skillRouterAny.create({
      input: {
        displayName: "My Skill",
        description: "A test skill",
        icon: "sparkles",
      },
      context,
    });

    expect(result).toEqual({
      id: "skill-1",
      name: "my-skill",
      displayName: "My Skill",
      description: "A test skill",
      icon: "sparkles",
    });

    expect(context.mocks.insertValuesMock).toHaveBeenCalledTimes(2);
    expect(context.mocks.insertValuesMock.mock.calls[0][0]).toMatchObject({
      userId: "user-1",
      name: "my-skill",
      displayName: "My Skill",
      description: "A test skill",
    });
    expect(context.mocks.insertValuesMock.mock.calls[1][0]).toMatchObject({
      skillId: "skill-1",
      path: "SKILL.md",
    });
    expect(context.mocks.insertValuesMock.mock.calls[1][0].content).toContain(
      "name: my-skill",
    );
    expect(context.mocks.insertValuesMock.mock.calls[1][0].content).toContain(
      "# My Skill",
    );
  });

  it("returns BAD_REQUEST when create receives a name that cannot produce a slug", async () => {
    const context = createContext();

    await expect(
      skillRouterAny.create({
        input: {
          displayName: "***",
          description: "desc",
        },
        context,
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("updates an existing skill", async () => {
    const context = createContext();
    context.mocks.updateReturningMock.mockResolvedValue([{ id: "skill-1" }]);

    const result = await skillRouterAny.update({
      input: {
        id: "skill-1",
        name: "Renamed Skill",
        description: "new",
        icon: null,
        enabled: false,
      },
      context,
    });

    expect(result).toEqual({ success: true });
    expect(context.mocks.updateSetMock).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "renamed-skill",
        description: "new",
        icon: null,
        enabled: false,
      }),
    );
  });

  it("returns BAD_REQUEST when update receives an invalid slug name", async () => {
    const context = createContext();

    await expect(
      skillRouterAny.update({
        input: { id: "skill-1", name: "!!!" },
        context,
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("returns NOT_FOUND when updating a missing skill", async () => {
    const context = createContext();
    context.mocks.updateReturningMock.mockResolvedValue([]);

    await expect(
      skillRouterAny.update({
        input: { id: "skill-missing", description: "nope" },
        context,
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("deletes an existing skill", async () => {
    const context = createContext();
    context.mocks.deleteReturningMock.mockResolvedValue([{ id: "skill-1" }]);

    const result = await skillRouterAny.delete({
      input: { id: "skill-1" },
      context,
    });

    expect(result).toEqual({ success: true });
  });

  it("returns NOT_FOUND when deleting a missing skill", async () => {
    const context = createContext();
    context.mocks.deleteReturningMock.mockResolvedValue([]);

    await expect(
      skillRouterAny.delete({
        input: { id: "skill-missing" },
        context,
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("adds a file when skill is owned by the user", async () => {
    const context = createContext();
    context.db.query.skill.findFirst.mockResolvedValue({
      id: "skill-1",
      userId: "user-1",
    });
    context.mocks.insertReturningMock.mockResolvedValue([
      { id: "file-1", path: "notes.md" },
    ]);

    const result = await skillRouterAny.addFile({
      input: {
        skillId: "skill-1",
        path: "notes.md",
        content: "hello",
      },
      context,
    });

    expect(result).toEqual({ id: "file-1", path: "notes.md" });
  });

  it("returns NOT_FOUND when adding a file to a missing skill", async () => {
    const context = createContext();
    context.db.query.skill.findFirst.mockResolvedValue(null);

    await expect(
      skillRouterAny.addFile({
        input: {
          skillId: "skill-missing",
          path: "notes.md",
          content: "hello",
        },
        context,
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("updates a file when the parent skill is owned by the user", async () => {
    const context = createContext();
    context.db.query.skillFile.findFirst.mockResolvedValue({
      id: "file-1",
      path: "notes.md",
      skill: { userId: "user-1" },
    });

    const result = await skillRouterAny.updateFile({
      input: {
        id: "file-1",
        content: "new content",
      },
      context,
    });

    expect(result).toEqual({ success: true });
    expect(context.mocks.updateSetMock).toHaveBeenCalledWith({
      content: "new content",
    });
  });

  it("returns NOT_FOUND when updating a file not owned by user", async () => {
    const context = createContext();
    context.db.query.skillFile.findFirst.mockResolvedValue({
      id: "file-1",
      path: "notes.md",
      skill: { userId: "another-user" },
    });

    await expect(
      skillRouterAny.updateFile({
        input: { id: "file-1", content: "new content" },
        context,
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("deletes a non-SKILL.md file", async () => {
    const context = createContext();
    context.db.query.skillFile.findFirst.mockResolvedValue({
      id: "file-1",
      path: "notes.md",
      skill: { userId: "user-1" },
    });

    const result = await skillRouterAny.deleteFile({
      input: { id: "file-1" },
      context,
    });

    expect(result).toEqual({ success: true });
  });

  it("returns BAD_REQUEST when deleting SKILL.md", async () => {
    const context = createContext();
    context.db.query.skillFile.findFirst.mockResolvedValue({
      id: "file-1",
      path: "SKILL.md",
      skill: { userId: "user-1" },
    });

    await expect(
      skillRouterAny.deleteFile({
        input: { id: "file-1" },
        context,
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("returns NOT_FOUND when deleting a missing file", async () => {
    const context = createContext();
    context.db.query.skillFile.findFirst.mockResolvedValue(null);

    await expect(
      skillRouterAny.deleteFile({
        input: { id: "file-missing" },
        context,
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("uploads a document and stores metadata", async () => {
    const context = createContext();
    context.db.query.skill.findFirst.mockResolvedValue({
      id: "skill-1",
      userId: "user-1",
    });
    context.mocks.selectWhereMock.mockResolvedValue([{ value: 2 }]);
    context.mocks.insertReturningMock.mockResolvedValue([
      {
        id: "doc-1",
        filename: "doc.pdf",
        mimeType: "application/pdf",
        sizeBytes: 4,
      },
    ]);

    const result = await skillRouterAny.uploadDocument({
      input: {
        skillId: "skill-1",
        filename: "doc.pdf",
        mimeType: "application/pdf",
        content: Buffer.from("test").toString("base64"),
        description: "My doc",
      },
      context,
    });

    expect(validateFileUploadMock).toHaveBeenCalledWith(
      "doc.pdf",
      "application/pdf",
      4,
      2,
    );
    expect(ensureBucketMock).toHaveBeenCalledTimes(1);
    expect(generateStorageKeyMock).toHaveBeenCalledWith(
      "user-1",
      "skill-1",
      "doc.pdf",
    );
    expect(uploadToS3Mock).toHaveBeenCalledWith(
      "skills/user-1/skill-1/doc.pdf",
      expect.any(Buffer),
      "application/pdf",
    );
    expect(result).toEqual({
      id: "doc-1",
      filename: "doc.pdf",
      mimeType: "application/pdf",
      sizeBytes: 4,
    });
  });

  it("returns NOT_FOUND when uploading a document for an unknown skill", async () => {
    const context = createContext();
    context.db.query.skill.findFirst.mockResolvedValue(null);

    await expect(
      skillRouterAny.uploadDocument({
        input: {
          skillId: "skill-missing",
          filename: "doc.pdf",
          mimeType: "application/pdf",
          content: Buffer.from("test").toString("base64"),
        },
        context,
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("propagates upload validation errors", async () => {
    const context = createContext();
    context.db.query.skill.findFirst.mockResolvedValue({
      id: "skill-1",
      userId: "user-1",
    });
    context.mocks.selectWhereMock.mockResolvedValue([{ value: 20 }]);
    validateFileUploadMock.mockImplementation(() => {
      throw new ORPCError("BAD_REQUEST", { message: "too many documents" });
    });

    await expect(
      skillRouterAny.uploadDocument({
        input: {
          skillId: "skill-1",
          filename: "doc.pdf",
          mimeType: "application/pdf",
          content: Buffer.from("test").toString("base64"),
        },
        context,
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });

    expect(ensureBucketMock).not.toHaveBeenCalled();
    expect(uploadToS3Mock).not.toHaveBeenCalled();
  });

  it("gets a presigned URL for a document owned by the user", async () => {
    const context = createContext();
    context.db.query.skillDocument.findFirst.mockResolvedValue({
      id: "doc-1",
      filename: "doc.pdf",
      storageKey: "skills/user-1/skill-1/doc.pdf",
      skill: { userId: "user-1" },
    });

    const result = await skillRouterAny.getDocumentUrl({
      input: { id: "doc-1" },
      context,
    });

    expect(getPresignedDownloadUrlMock).toHaveBeenCalledWith(
      "skills/user-1/skill-1/doc.pdf",
    );
    expect(result).toEqual({
      url: "https://example.com/presigned-url",
      filename: "doc.pdf",
    });
  });

  it("returns NOT_FOUND when getting URL for a document not owned by the user", async () => {
    const context = createContext();
    context.db.query.skillDocument.findFirst.mockResolvedValue({
      id: "doc-1",
      filename: "doc.pdf",
      storageKey: "skills/other/doc.pdf",
      skill: { userId: "another-user" },
    });

    await expect(
      skillRouterAny.getDocumentUrl({
        input: { id: "doc-1" },
        context,
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("deletes a document from storage and database", async () => {
    const context = createContext();
    context.db.query.skillDocument.findFirst.mockResolvedValue({
      id: "doc-1",
      storageKey: "skills/user-1/skill-1/doc.pdf",
      skill: { userId: "user-1" },
    });

    const result = await skillRouterAny.deleteDocument({
      input: { id: "doc-1" },
      context,
    });

    expect(deleteFromS3Mock).toHaveBeenCalledWith(
      "skills/user-1/skill-1/doc.pdf",
    );
    expect(result).toEqual({ success: true });
  });

  it("returns NOT_FOUND when deleting a missing document", async () => {
    const context = createContext();
    context.db.query.skillDocument.findFirst.mockResolvedValue(null);

    await expect(
      skillRouterAny.deleteDocument({
        input: { id: "doc-missing" },
        context,
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});
