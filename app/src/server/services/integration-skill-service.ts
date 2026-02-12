import { and, desc, eq, inArray } from "drizzle-orm";
import { promises as fs } from "node:fs";
import path from "node:path";
import { db } from "@/server/db/client";
import {
  customIntegration,
  integrationSkill,
  integrationSkillFile,
  integrationSkillPreference,
  integrationTypeEnum,
  type integrationSkillSourceEnum,
} from "@/server/db/schema";

type SkillSource = (typeof integrationSkillSourceEnum.enumValues)[number];

export type OfficialIntegrationSkill = {
  slug: string;
  description: string;
  dirName: string;
};

export type ResolvedIntegrationSkill =
  | {
      source: "official";
      slug: string;
      description: string;
      dirName: string;
    }
  | {
      source: "community";
      slug: string;
      id: string;
      title: string;
      description: string;
      files: Array<{ path: string; content: string }>;
      createdByUserId: string | null;
    };

let cachedOfficialSkills: Map<string, OfficialIntegrationSkill> | null = null;
let cacheTimeMs = 0;
const OFFICIAL_SKILLS_CACHE_TTL_MS = 30_000;

function extractFrontmatterValue(markdown: string, key: string): string | null {
  const match = markdown.match(new RegExp(`^${key}:\\s*(.+)$`, "m"));
  if (!match?.[1]) {
    return null;
  }
  return match[1].trim().replace(/^['"]|['"]$/g, "");
}

export function normalizeIntegrationSkillSlug(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 64);
}

export function validateIntegrationSkillFilePath(filePath: string): boolean {
  if (!filePath || filePath.length > 256) {
    return false;
  }
  if (filePath.startsWith("/") || filePath.includes("..")) {
    return false;
  }
  return true;
}

export async function isKnownIntegrationSlug(slug: string): Promise<boolean> {
  const builtInSlugs = new Set(integrationTypeEnum.enumValues);
  if (builtInSlugs.has(slug as (typeof integrationTypeEnum.enumValues)[number])) {
    return true;
  }

  const custom = await db.query.customIntegration.findFirst({
    where: eq(customIntegration.slug, slug),
  });
  return !!custom;
}

export type CreateCommunityIntegrationSkillInput = {
  slug: string;
  title: string;
  description: string;
  files?: Array<{ path: string; content: string }>;
  setAsPreferred?: boolean;
};

function buildSkillMd(slug: string, title: string, description: string): string {
  return `---
name: ${slug}
description: ${description}
---

# ${title}

## Overview

Integration skill for ${title}.
`;
}

export async function createCommunityIntegrationSkill(
  userId: string,
  input: CreateCommunityIntegrationSkillInput,
): Promise<{ id: string; slug: string }> {
  const slug = normalizeIntegrationSkillSlug(input.slug);
  if (!slug) {
    throw new Error("Invalid slug");
  }
  const known = await isKnownIntegrationSlug(slug);
  if (!known) {
    throw new Error(`Unknown integration slug '${slug}'`);
  }

  const files = input.files ?? [];
  const seenPaths = new Set<string>();
  for (const file of files) {
    if (!validateIntegrationSkillFilePath(file.path)) {
      throw new Error(`Invalid file path: ${file.path}`);
    }
    if (seenPaths.has(file.path)) {
      throw new Error(`Duplicate file path: ${file.path}`);
    }
    seenPaths.add(file.path);
  }

  const [created] = await db
    .insert(integrationSkill)
    .values({
      slug,
      title: input.title,
      description: input.description,
      source: "community",
      visibility: "public",
      createdByUserId: userId,
      isActive: true,
    })
    .returning();

  const fileRows = [...files];
  if (!seenPaths.has("SKILL.md")) {
    fileRows.push({
      path: "SKILL.md",
      content: buildSkillMd(slug, input.title, input.description),
    });
  }
  if (fileRows.length > 0) {
    await db.insert(integrationSkillFile).values(
      fileRows.map((file) => ({
        integrationSkillId: created.id,
        path: file.path,
        content: file.content,
      })),
    );
  }

  if (input.setAsPreferred) {
    await db
      .insert(integrationSkillPreference)
      .values({
        userId,
        slug,
        preferredSource: "community",
        preferredSkillId: created.id,
      })
      .onConflictDoUpdate({
        target: [integrationSkillPreference.userId, integrationSkillPreference.slug],
        set: {
          preferredSource: "community",
          preferredSkillId: created.id,
          updatedAt: new Date(),
        },
      });
  }

  return { id: created.id, slug: created.slug };
}

export async function getOfficialIntegrationSkillIndex(): Promise<
  Map<string, OfficialIntegrationSkill>
> {
  const now = Date.now();
  if (cachedOfficialSkills && now - cacheTimeMs < OFFICIAL_SKILLS_CACHE_TTL_MS) {
    return cachedOfficialSkills;
  }

  const result = new Map<string, OfficialIntegrationSkill>();
  const skillsRoot = path.join(process.cwd(), "src", "e2b-template", "skills");

  let entries: Array<import("node:fs").Dirent> = [];
  try {
    entries = await fs.readdir(skillsRoot, { withFileTypes: true });
  } catch {
    cachedOfficialSkills = result;
    cacheTimeMs = now;
    return result;
  }

  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }
    const skillMdPath = path.join(skillsRoot, entry.name, "SKILL.md");
    try {
      const content = await fs.readFile(skillMdPath, "utf8");
      const frontmatterName = extractFrontmatterValue(content, "name");
      const description = extractFrontmatterValue(content, "description") ?? "";
      const slug = normalizeIntegrationSkillSlug(frontmatterName ?? entry.name);
      if (!slug) {
        continue;
      }
      result.set(slug, {
        slug,
        description,
        dirName: entry.name,
      });
    } catch {
      continue;
    }
  }

  cachedOfficialSkills = result;
  cacheTimeMs = now;
  return result;
}

async function getCommunitySkillById(skillId: string) {
  return db.query.integrationSkill.findFirst({
    where: and(
      eq(integrationSkill.id, skillId),
      eq(integrationSkill.source, "community"),
      eq(integrationSkill.isActive, true),
      eq(integrationSkill.visibility, "public"),
    ),
    with: {
      files: true,
    },
  });
}

async function getLatestCommunitySkillBySlug(slug: string) {
  return db.query.integrationSkill.findFirst({
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
}

export async function resolveIntegrationSkillForUser(
  userId: string,
  slug: string,
): Promise<ResolvedIntegrationSkill | null> {
  const normalizedSlug = normalizeIntegrationSkillSlug(slug);
  if (!normalizedSlug) {
    return null;
  }

  const officialSkills = await getOfficialIntegrationSkillIndex();
  const official = officialSkills.get(normalizedSlug);

  const pref = await db.query.integrationSkillPreference.findFirst({
    where: and(
      eq(integrationSkillPreference.userId, userId),
      eq(integrationSkillPreference.slug, normalizedSlug),
    ),
  });

  const buildOfficial = (): ResolvedIntegrationSkill | null =>
    official
      ? {
          source: "official",
          slug: official.slug,
          description: official.description,
          dirName: official.dirName,
        }
      : null;

  if (!pref) {
    const defaultOfficial = buildOfficial();
    if (defaultOfficial) {
      return defaultOfficial;
    }
    const latestCommunity = await getLatestCommunitySkillBySlug(normalizedSlug);
    if (!latestCommunity) {
      return null;
    }
    return {
      source: "community",
      slug: latestCommunity.slug,
      id: latestCommunity.id,
      title: latestCommunity.title,
      description: latestCommunity.description,
      files: latestCommunity.files.map((file) => ({
        path: file.path,
        content: file.content,
      })),
      createdByUserId: latestCommunity.createdByUserId,
    };
  }

  if (pref.preferredSource === "official") {
    return buildOfficial();
  }

  let communityChoice = pref.preferredSkillId
    ? await getCommunitySkillById(pref.preferredSkillId)
    : null;
  if (!communityChoice) {
    communityChoice = await getLatestCommunitySkillBySlug(normalizedSlug);
  }

  if (communityChoice) {
    return {
      source: "community",
      slug: communityChoice.slug,
      id: communityChoice.id,
      title: communityChoice.title,
      description: communityChoice.description,
      files: communityChoice.files.map((file) => ({
        path: file.path,
        content: file.content,
      })),
      createdByUserId: communityChoice.createdByUserId,
    };
  }

  return buildOfficial();
}

export async function resolvePreferredCommunitySkillsForUser(
  userId: string,
  allowedSlugs?: string[],
): Promise<Array<Extract<ResolvedIntegrationSkill, { source: "community" }>>> {
  const whereClauses = [
    eq(integrationSkillPreference.userId, userId),
    eq(integrationSkillPreference.preferredSource, "community" as SkillSource),
  ];
  if (allowedSlugs && allowedSlugs.length > 0) {
    const normalized = allowedSlugs.map(normalizeIntegrationSkillSlug).filter(Boolean);
    if (normalized.length === 0) {
      return [];
    }
    whereClauses.push(inArray(integrationSkillPreference.slug, normalized));
  }

  const prefs = await db
    .select()
    .from(integrationSkillPreference)
    .where(and(...whereClauses))
    .orderBy(desc(integrationSkillPreference.updatedAt));

  const out: Array<Extract<ResolvedIntegrationSkill, { source: "community" }>> = [];
  for (const pref of prefs) {
    const resolved = await resolveIntegrationSkillForUser(userId, pref.slug);
    if (resolved?.source === "community") {
      out.push(resolved);
    }
  }

  return out;
}
