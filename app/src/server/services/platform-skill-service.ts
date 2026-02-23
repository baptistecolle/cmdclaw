import { promises as fs } from "node:fs";
import path from "node:path";

const SKILLS_ROOT = path.join(process.cwd(), "src", "sandbox-templates/common", "skills");

const NON_SELECTABLE_SKILL_DIRS = new Set(["_test-utils"]);

// Integration-backed skills are intentionally excluded from the chat skill selector.
const INTEGRATION_SKILL_DIRS = new Set([
  "airtable",
  "discord",
  "github",
  "google-calendar",
  "google-docs",
  "google-drive",
  "google-gmail",
  "google-sheets",
  "hubspot",
  "linear",
  "linkedin",
  "notion",
  "reddit",
  "salesforce",
  "slack",
  "twitter",
]);

export type PlatformSkillOption = {
  slug: string;
  title: string;
  description: string;
};

function extractFrontmatterValue(markdown: string, key: string): string | null {
  const match = markdown.match(new RegExp(`^${key}:\\s*(.+)$`, "m"));
  if (!match?.[1]) {
    return null;
  }
  return match[1].trim().replace(/^['"]|['"]$/g, "");
}

function formatSkillTitle(slug: string): string {
  return slug
    .split("-")
    .filter(Boolean)
    .map((part) => part[0]?.toUpperCase() + part.slice(1))
    .join(" ");
}

export async function listSelectablePlatformSkills(): Promise<PlatformSkillOption[]> {
  let entries: Array<import("node:fs").Dirent> = [];
  try {
    entries = await fs.readdir(SKILLS_ROOT, { withFileTypes: true });
  } catch {
    return [];
  }

  const skillDirs = entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .filter((dirName) => !NON_SELECTABLE_SKILL_DIRS.has(dirName))
    .filter((dirName) => !INTEGRATION_SKILL_DIRS.has(dirName));

  const skills = await Promise.all(
    skillDirs.map(async (dirName) => {
      const skillMdPath = path.join(SKILLS_ROOT, dirName, "SKILL.md");
      try {
        const markdown = await fs.readFile(skillMdPath, "utf8");
        const description = extractFrontmatterValue(markdown, "description") ?? "";
        return {
          slug: dirName,
          title: formatSkillTitle(dirName),
          description,
        } satisfies PlatformSkillOption;
      } catch {
        return {
          slug: dirName,
          title: formatSkillTitle(dirName),
          description: "",
        } satisfies PlatformSkillOption;
      }
    }),
  );

  return skills.toSorted((a, b) => a.title.localeCompare(b.title));
}

export async function resolveSelectedPlatformSkillSlugs(
  selectedSkillSlugs: string[] | undefined,
): Promise<string[] | undefined> {
  if (!selectedSkillSlugs || selectedSkillSlugs.length === 0) {
    return undefined;
  }

  const normalized = Array.from(
    new Set(
      selectedSkillSlugs.map((slug) => slug.trim().toLowerCase()).filter((slug) => slug.length > 0),
    ),
  );
  if (normalized.length === 0) {
    return undefined;
  }

  const skills = await listSelectablePlatformSkills();
  const available = new Set(skills.map((skill) => skill.slug));
  const valid = normalized.filter((slug) => available.has(slug));
  if (valid.length === 0) {
    return undefined;
  }

  return valid;
}
