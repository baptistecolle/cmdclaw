import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const desktopRoot = path.resolve(__dirname, "..");
const appRoot = path.resolve(desktopRoot, "../app");

const standaloneSrc = path.join(appRoot, ".next", "standalone");
const staticSrc = path.join(appRoot, ".next", "static");
const publicSrc = path.join(appRoot, "public");

const bundleRoot = path.join(desktopRoot, "app-bundle");
const standaloneDest = path.join(bundleRoot, "standalone");

async function exists(targetPath) {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function copyIfExists(src, dest) {
  if (await exists(src)) {
    await fs.mkdir(path.dirname(dest), { recursive: true });
    await fs.cp(src, dest, { recursive: true });
  }
}

if (!(await exists(standaloneSrc))) {
  throw new Error(
    `Missing Next standalone output at ${standaloneSrc}. Run desktop build (it sets NEXT_PRIVATE_STANDALONE=true for app build).`
  );
}

await fs.rm(bundleRoot, { recursive: true, force: true });
await fs.mkdir(bundleRoot, { recursive: true });

await fs.cp(standaloneSrc, standaloneDest, { recursive: true });
await copyIfExists(staticSrc, path.join(standaloneDest, ".next", "static"));
await copyIfExists(publicSrc, path.join(standaloneDest, "public"));

console.log("Desktop app bundle prepared:", standaloneDest);
