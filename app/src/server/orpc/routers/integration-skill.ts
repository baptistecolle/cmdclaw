import { ORPCError } from "@orpc/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { protectedProcedure } from "../middleware";
import {
  integrationSkill,
  integrationSkillFile,
  integrationSkillPreference,
} from "@/server/db/schema";
import { db } from "@/server/db/client";
import {
  createCommunityIntegrationSkill,
  getOfficialIntegrationSkillIndex,
  normalizeIntegrationSkillSlug,
  resolveIntegrationSkillForUser,
  validateIntegrationSkillFilePath,
} from "@/server/services/integration-skill-service";

const createFromChat = protectedProcedure
  .input(
    z.object({
      slug: z.string().min(1).max(64),
      title: z.string().min(1).max(128),
      description: z.string().min(1).max(1000),
      files: z
        .array(
          z.object({
            path: z.string().min(1).max(256),
            content: z.string(),
          }),
        )
        .max(50)
        .default([]),
      setAsPreferred: z.boolean().default(false),
    }),
  )
  .handler(async ({ input, context }) => {
    const slug = normalizeIntegrationSkillSlug(input.slug);
    if (!slug) throw new ORPCError("BAD_REQUEST", { message: "Invalid slug" });
    try {
      const created = await createCommunityIntegrationSkill(context.user.id, {
        slug,
        title: input.title,
        description: input.description,
        files: input.files,
        setAsPreferred: input.setAsPreferred,
      });

      return {
        id: created.id,
        slug: created.slug,
        source: "community" as const,
        setAsPreferred: input.setAsPreferred,
      };
    } catch (error) {
      throw new ORPCError("BAD_REQUEST", {
        message: error instanceof Error ? error.message : "Failed to create integration skill",
      });
    }
  });

const listBySlug = protectedProcedure
  .input(z.object({ slug: z.string().min(1).max(64) }))
  .handler(async ({ input, context }) => {
    const slug = normalizeIntegrationSkillSlug(input.slug);
    const officialIndex = await getOfficialIntegrationSkillIndex();
    const official = officialIndex.get(slug) ?? null;

    const community = await context.db.query.integrationSkill.findMany({
      where: and(
        eq(integrationSkill.slug, slug),
        eq(integrationSkill.source, "community"),
        eq(integrationSkill.isActive, true),
        eq(integrationSkill.visibility, "public"),
      ),
      with: {
        files: true,
      },
      orderBy: (table, { desc }) => [desc(table.createdAt)],
    });

    const pref = await context.db.query.integrationSkillPreference.findFirst({
      where: and(
        eq(integrationSkillPreference.userId, context.user.id),
        eq(integrationSkillPreference.slug, slug),
      ),
    });

    return {
      slug,
      official: official
        ? {
            slug: official.slug,
            description: official.description,
            dirName: official.dirName,
          }
        : null,
      preference: pref
        ? {
            preferredSource: pref.preferredSource,
            preferredSkillId: pref.preferredSkillId,
          }
        : null,
      community: community.map((skill) => ({
        id: skill.id,
        slug: skill.slug,
        title: skill.title,
        description: skill.description,
        createdByUserId: skill.createdByUserId,
        isOwnedByMe: skill.createdByUserId === context.user.id,
        createdAt: skill.createdAt,
        updatedAt: skill.updatedAt,
        fileCount: skill.files.length,
      })),
    };
  });

const getResolvedForUser = protectedProcedure
  .input(z.object({ slug: z.string().min(1).max(64) }))
  .handler(async ({ input, context }) => {
    const slug = normalizeIntegrationSkillSlug(input.slug);
    const resolved = await resolveIntegrationSkillForUser(context.user.id, slug);

    const pref = await context.db.query.integrationSkillPreference.findFirst({
      where: and(
        eq(integrationSkillPreference.userId, context.user.id),
        eq(integrationSkillPreference.slug, slug),
      ),
    });

    return {
      slug,
      resolved,
      preference: pref
        ? {
            preferredSource: pref.preferredSource,
            preferredSkillId: pref.preferredSkillId,
          }
        : null,
    };
  });

const setPreference = protectedProcedure
  .input(
    z.object({
      slug: z.string().min(1).max(64),
      preferredSource: z.enum(["official", "community"]),
      preferredSkillId: z.string().optional(),
    }),
  )
  .handler(async ({ input, context }) => {
    const slug = normalizeIntegrationSkillSlug(input.slug);

    if (input.preferredSource === "community") {
      if (!input.preferredSkillId) {
        throw new ORPCError("BAD_REQUEST", {
          message: "preferredSkillId is required for community preference",
        });
      }

      const selected = await context.db.query.integrationSkill.findFirst({
        where: and(
          eq(integrationSkill.id, input.preferredSkillId),
          eq(integrationSkill.slug, slug),
          eq(integrationSkill.source, "community"),
          eq(integrationSkill.isActive, true),
          eq(integrationSkill.visibility, "public"),
        ),
      });
      if (!selected) {
        throw new ORPCError("NOT_FOUND", {
          message: "Community integration skill not found",
        });
      }
    }

    if (input.preferredSource === "official") {
      const officialIndex = await getOfficialIntegrationSkillIndex();
      if (!officialIndex.has(slug)) {
        throw new ORPCError("BAD_REQUEST", {
          message: `No official integration skill exists for slug '${slug}'`,
        });
      }
    }

    await context.db
      .insert(integrationSkillPreference)
      .values({
        userId: context.user.id,
        slug,
        preferredSource: input.preferredSource,
        preferredSkillId:
          input.preferredSource === "community" ? (input.preferredSkillId ?? null) : null,
      })
      .onConflictDoUpdate({
        target: [integrationSkillPreference.userId, integrationSkillPreference.slug],
        set: {
          preferredSource: input.preferredSource,
          preferredSkillId:
            input.preferredSource === "community" ? (input.preferredSkillId ?? null) : null,
          updatedAt: new Date(),
        },
      });

    return { success: true };
  });

const updateCommunitySkill = protectedProcedure
  .input(
    z.object({
      id: z.string(),
      title: z.string().min(1).max(128).optional(),
      description: z.string().min(1).max(1000).optional(),
      files: z
        .array(
          z.object({
            path: z.string().min(1).max(256),
            content: z.string(),
          }),
        )
        .max(50)
        .optional(),
    }),
  )
  .handler(async ({ input, context }) => {
    const existing = await context.db.query.integrationSkill.findFirst({
      where: and(
        eq(integrationSkill.id, input.id),
        eq(integrationSkill.source, "community"),
        eq(integrationSkill.isActive, true),
      ),
    });
    if (!existing) {
      throw new ORPCError("NOT_FOUND", {
        message: "Integration skill not found",
      });
    }
    if (existing.createdByUserId !== context.user.id) {
      throw new ORPCError("FORBIDDEN", { message: "Not allowed" });
    }

    if (input.title !== undefined || input.description !== undefined) {
      await context.db
        .update(integrationSkill)
        .set({
          title: input.title ?? existing.title,
          description: input.description ?? existing.description,
        })
        .where(eq(integrationSkill.id, existing.id));
    }

    if (input.files) {
      const seen = new Set<string>();
      for (const file of input.files) {
        if (!validateIntegrationSkillFilePath(file.path)) {
          throw new ORPCError("BAD_REQUEST", {
            message: `Invalid file path: ${file.path}`,
          });
        }
        if (seen.has(file.path)) {
          throw new ORPCError("BAD_REQUEST", {
            message: `Duplicate file path: ${file.path}`,
          });
        }
        seen.add(file.path);
      }

      await context.db
        .delete(integrationSkillFile)
        .where(eq(integrationSkillFile.integrationSkillId, existing.id));
      await context.db.insert(integrationSkillFile).values(
        input.files.map((file) => ({
          integrationSkillId: existing.id,
          path: file.path,
          content: file.content,
        })),
      );
    }

    return { success: true };
  });

const deleteCommunitySkill = protectedProcedure
  .input(z.object({ id: z.string() }))
  .handler(async ({ input, context }) => {
    const existing = await context.db.query.integrationSkill.findFirst({
      where: and(
        eq(integrationSkill.id, input.id),
        eq(integrationSkill.source, "community"),
        eq(integrationSkill.isActive, true),
      ),
    });
    if (!existing) {
      throw new ORPCError("NOT_FOUND", {
        message: "Integration skill not found",
      });
    }
    if (existing.createdByUserId !== context.user.id) {
      throw new ORPCError("FORBIDDEN", { message: "Not allowed" });
    }

    await context.db
      .update(integrationSkill)
      .set({ isActive: false })
      .where(eq(integrationSkill.id, existing.id));

    return { success: true };
  });

const listPublic = protectedProcedure
  .input(
    z
      .object({
        slug: z.string().min(1).max(64).optional(),
        limit: z.number().int().min(1).max(100).default(50),
      })
      .optional(),
  )
  .handler(async ({ input }) => {
    const slug = input?.slug ? normalizeIntegrationSkillSlug(input.slug) : undefined;
    const limit = input?.limit ?? 50;

    const filters = [
      eq(integrationSkill.source, "community"),
      eq(integrationSkill.visibility, "public"),
      eq(integrationSkill.isActive, true),
    ];
    if (slug) {
      filters.push(eq(integrationSkill.slug, slug));
    }

    const rows = await db.query.integrationSkill.findMany({
      where: and(...filters),
      orderBy: (table, { desc }) => [desc(table.createdAt)],
      limit,
    });

    return rows.map((row) => ({
      id: row.id,
      slug: row.slug,
      title: row.title,
      description: row.description,
      createdByUserId: row.createdByUserId,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    }));
  });

export const integrationSkillRouter = {
  createFromChat,
  listBySlug,
  getResolvedForUser,
  setPreference,
  updateCommunitySkill,
  deleteCommunitySkill,
  listPublic,
};
