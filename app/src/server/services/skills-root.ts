import { promises as fs } from "node:fs";
import path from "node:path";

const SKILLS_RELATIVE_PATH = ["src", "sandbox-templates", "common", "skills"] as const;

let cachedSkillsRoot: string | null | undefined;

function buildCandidateRoots(): string[] {
  return [
    path.join(process.cwd(), ...SKILLS_RELATIVE_PATH),
    path.join(process.cwd(), "app", ...SKILLS_RELATIVE_PATH),
  ];
}

export async function resolveSkillsRoot(logPrefix: string): Promise<string | null> {
  if (cachedSkillsRoot !== undefined) {
    return cachedSkillsRoot;
  }

  const candidates = buildCandidateRoots();
  const checks = await Promise.all(
    candidates.map(async (candidate) => {
      try {
        const stats = await fs.stat(candidate);
        return stats.isDirectory();
      } catch {
        return false;
      }
    }),
  );

  const firstValidIndex = checks.findIndex((isValid) => isValid);
  if (firstValidIndex >= 0) {
    cachedSkillsRoot = candidates[firstValidIndex] ?? null;
    return cachedSkillsRoot;
  }

  console.error(`${logPrefix} Unable to resolve skills root directory`, {
    cwd: process.cwd(),
    candidates,
  });
  cachedSkillsRoot = null;
  return null;
}
