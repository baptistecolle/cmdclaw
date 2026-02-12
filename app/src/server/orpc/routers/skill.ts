import { ORPCError } from "@orpc/server";
import { z } from "zod";
import { protectedProcedure } from "../middleware";
import { skill, skillFile, skillDocument } from "@/server/db/schema";
import { eq, and, count } from "drizzle-orm";
import {
  uploadToS3,
  deleteFromS3,
  getPresignedDownloadUrl,
  generateStorageKey,
  ensureBucket,
} from "@/server/storage/s3-client";
import { validateFileUpload } from "@/server/storage/validation";

// Helper to generate a valid skill slug (lowercase, numbers, hyphens only)
function toSkillSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 64);
}

// Generate default SKILL.md content
function generateSkillMd(
  displayName: string,
  slug: string,
  description: string,
): string {
  return `---
name: ${slug}
description: ${description}
---

# ${displayName}

Add your skill instructions here...
`;
}

// List user's skills
const list = protectedProcedure.handler(async ({ context }) => {
  const skills = await context.db.query.skill.findMany({
    where: eq(skill.userId, context.user.id),
    with: {
      files: true,
    },
    orderBy: (skill, { desc }) => [desc(skill.createdAt)],
  });

  return skills.map((s) => ({
    id: s.id,
    name: s.name,
    displayName: s.displayName,
    description: s.description,
    icon: s.icon,
    enabled: s.enabled,
    fileCount: s.files.length,
    createdAt: s.createdAt,
    updatedAt: s.updatedAt,
  }));
});

// Get a single skill with all files and documents
const get = protectedProcedure
  .input(z.object({ id: z.string() }))
  .handler(async ({ input, context }) => {
    const result = await context.db.query.skill.findFirst({
      where: and(eq(skill.id, input.id), eq(skill.userId, context.user.id)),
      with: {
        files: true,
        documents: true,
      },
    });

    if (!result) {
      throw new ORPCError("NOT_FOUND", { message: "Skill not found" });
    }

    return {
      id: result.id,
      name: result.name,
      displayName: result.displayName,
      description: result.description,
      icon: result.icon,
      enabled: result.enabled,
      files: result.files.map((f) => ({
        id: f.id,
        path: f.path,
        content: f.content,
        createdAt: f.createdAt,
        updatedAt: f.updatedAt,
      })),
      documents: result.documents.map((d) => ({
        id: d.id,
        filename: d.filename,
        mimeType: d.mimeType,
        sizeBytes: d.sizeBytes,
        description: d.description,
        createdAt: d.createdAt,
      })),
      createdAt: result.createdAt,
      updatedAt: result.updatedAt,
    };
  });

// Create a new skill
const create = protectedProcedure
  .input(
    z.object({
      displayName: z.string().min(1).max(128),
      description: z.string().min(1).max(1024),
      icon: z.string().max(64).optional(),
    }),
  )
  .handler(async ({ input, context }) => {
    const slug = toSkillSlug(input.displayName);

    if (!slug) {
      throw new ORPCError("BAD_REQUEST", { message: "Invalid skill name" });
    }

    // Create skill
    const [newSkill] = await context.db
      .insert(skill)
      .values({
        userId: context.user.id,
        name: slug,
        displayName: input.displayName,
        description: input.description,
        icon: input.icon,
      })
      .returning();

    // Create default SKILL.md file
    await context.db.insert(skillFile).values({
      skillId: newSkill.id,
      path: "SKILL.md",
      content: generateSkillMd(input.displayName, slug, input.description),
    });

    return {
      id: newSkill.id,
      name: newSkill.name,
      displayName: newSkill.displayName,
      description: newSkill.description,
      icon: newSkill.icon,
    };
  });

// Update skill metadata
const update = protectedProcedure
  .input(
    z.object({
      id: z.string(),
      name: z.string().min(1).max(64).optional(), // slug
      displayName: z.string().min(1).max(128).optional(),
      description: z.string().min(1).max(1024).optional(),
      icon: z.string().max(64).nullish(),
      enabled: z.boolean().optional(),
    }),
  )
  .handler(async ({ input, context }) => {
    const updates: Partial<typeof skill.$inferInsert> = {};

    if (input.name !== undefined) {
      updates.name = toSkillSlug(input.name);
      if (!updates.name) {
        throw new ORPCError("BAD_REQUEST", { message: "Invalid skill name" });
      }
    }
    if (input.displayName !== undefined) {
      updates.displayName = input.displayName;
    }
    if (input.description !== undefined) {
      updates.description = input.description;
    }
    if (input.icon !== undefined) {
      updates.icon = input.icon;
    }
    if (input.enabled !== undefined) {
      updates.enabled = input.enabled;
    }

    const result = await context.db
      .update(skill)
      .set(updates)
      .where(and(eq(skill.id, input.id), eq(skill.userId, context.user.id)))
      .returning({ id: skill.id });

    if (result.length === 0) {
      throw new ORPCError("NOT_FOUND", { message: "Skill not found" });
    }

    return { success: true };
  });

// Delete a skill
const deleteSkill = protectedProcedure
  .input(z.object({ id: z.string() }))
  .handler(async ({ input, context }) => {
    const result = await context.db
      .delete(skill)
      .where(and(eq(skill.id, input.id), eq(skill.userId, context.user.id)))
      .returning({ id: skill.id });

    if (result.length === 0) {
      throw new ORPCError("NOT_FOUND", { message: "Skill not found" });
    }

    return { success: true };
  });

// Add a file to a skill
const addFile = protectedProcedure
  .input(
    z.object({
      skillId: z.string(),
      path: z.string().min(1).max(256),
      content: z.string(),
    }),
  )
  .handler(async ({ input, context }) => {
    // Verify ownership
    const existingSkill = await context.db.query.skill.findFirst({
      where: and(
        eq(skill.id, input.skillId),
        eq(skill.userId, context.user.id),
      ),
    });

    if (!existingSkill) {
      throw new ORPCError("NOT_FOUND", { message: "Skill not found" });
    }

    const [newFile] = await context.db
      .insert(skillFile)
      .values({
        skillId: input.skillId,
        path: input.path,
        content: input.content,
      })
      .returning();

    return {
      id: newFile.id,
      path: newFile.path,
    };
  });

// Update a file
const updateFile = protectedProcedure
  .input(
    z.object({
      id: z.string(),
      content: z.string(),
    }),
  )
  .handler(async ({ input, context }) => {
    // Get the file and verify ownership through skill
    const existingFile = await context.db.query.skillFile.findFirst({
      where: eq(skillFile.id, input.id),
      with: {
        skill: true,
      },
    });

    if (!existingFile || existingFile.skill.userId !== context.user.id) {
      throw new ORPCError("NOT_FOUND", { message: "File not found" });
    }

    await context.db
      .update(skillFile)
      .set({ content: input.content })
      .where(eq(skillFile.id, input.id));

    return { success: true };
  });

// Delete a file
const deleteFile = protectedProcedure
  .input(z.object({ id: z.string() }))
  .handler(async ({ input, context }) => {
    // Get the file and verify ownership through skill
    const existingFile = await context.db.query.skillFile.findFirst({
      where: eq(skillFile.id, input.id),
      with: {
        skill: true,
      },
    });

    if (!existingFile || existingFile.skill.userId !== context.user.id) {
      throw new ORPCError("NOT_FOUND", { message: "File not found" });
    }

    // Don't allow deleting SKILL.md
    if (existingFile.path === "SKILL.md") {
      throw new ORPCError("BAD_REQUEST", { message: "Cannot delete SKILL.md" });
    }

    await context.db.delete(skillFile).where(eq(skillFile.id, input.id));

    return { success: true };
  });

// ========== DOCUMENT ROUTES ==========

// Upload a document
const uploadDocument = protectedProcedure
  .input(
    z.object({
      skillId: z.string(),
      filename: z.string().min(1).max(256),
      mimeType: z.string(),
      content: z.string(), // Base64-encoded file content
      description: z.string().max(1024).optional(),
    }),
  )
  .handler(async ({ input, context }) => {
    // Verify skill ownership
    const existingSkill = await context.db.query.skill.findFirst({
      where: and(
        eq(skill.id, input.skillId),
        eq(skill.userId, context.user.id),
      ),
    });

    if (!existingSkill) {
      throw new ORPCError("NOT_FOUND", { message: "Skill not found" });
    }

    // Decode base64 content
    const fileBuffer = Buffer.from(input.content, "base64");
    const sizeBytes = fileBuffer.length;

    // Get current document count
    const [{ value: docCount }] = await context.db
      .select({ value: count() })
      .from(skillDocument)
      .where(eq(skillDocument.skillId, input.skillId));

    // Validate
    validateFileUpload(input.filename, input.mimeType, sizeBytes, docCount);

    // Ensure bucket exists and upload to S3
    await ensureBucket();
    const storageKey = generateStorageKey(
      context.user.id,
      input.skillId,
      input.filename,
    );
    await uploadToS3(storageKey, fileBuffer, input.mimeType);

    // Save metadata to database
    const [newDocument] = await context.db
      .insert(skillDocument)
      .values({
        skillId: input.skillId,
        filename: input.filename,
        mimeType: input.mimeType,
        sizeBytes,
        storageKey,
        description: input.description,
      })
      .returning();

    return {
      id: newDocument.id,
      filename: newDocument.filename,
      mimeType: newDocument.mimeType,
      sizeBytes: newDocument.sizeBytes,
    };
  });

// Get download URL for a document
const getDocumentUrl = protectedProcedure
  .input(z.object({ id: z.string() }))
  .handler(async ({ input, context }) => {
    // Get document and verify ownership through skill
    const document = await context.db.query.skillDocument.findFirst({
      where: eq(skillDocument.id, input.id),
      with: { skill: true },
    });

    if (!document || document.skill.userId !== context.user.id) {
      throw new ORPCError("NOT_FOUND", { message: "Document not found" });
    }

    const url = await getPresignedDownloadUrl(document.storageKey);

    return { url, filename: document.filename };
  });

// Delete a document
const deleteDocument = protectedProcedure
  .input(z.object({ id: z.string() }))
  .handler(async ({ input, context }) => {
    // Get document and verify ownership through skill
    const document = await context.db.query.skillDocument.findFirst({
      where: eq(skillDocument.id, input.id),
      with: { skill: true },
    });

    if (!document || document.skill.userId !== context.user.id) {
      throw new ORPCError("NOT_FOUND", { message: "Document not found" });
    }

    // Delete from S3
    await deleteFromS3(document.storageKey);

    // Delete from database
    await context.db
      .delete(skillDocument)
      .where(eq(skillDocument.id, input.id));

    return { success: true };
  });

export const skillRouter = {
  list,
  get,
  create,
  update,
  delete: deleteSkill,
  addFile,
  updateFile,
  deleteFile,
  uploadDocument,
  getDocumentUrl,
  deleteDocument,
};
