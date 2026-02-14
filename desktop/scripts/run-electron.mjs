import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const appName = process.env.DESKTOP_APP_NAME || "Bap";
const electronBinary = require("electron");

function setPlistKey(plistPath, key, value) {
  const setResult = spawnSync(
    "/usr/libexec/PlistBuddy",
    ["-c", `Set :${key} ${value}`, plistPath],
    { stdio: "ignore" }
  );

  if (setResult.status === 0) {
    return;
  }

  spawnSync(
    "/usr/libexec/PlistBuddy",
    ["-c", `Add :${key} string ${value}`, plistPath],
    { stdio: "ignore" }
  );
}

function patchMacAppName(binaryPath, name) {
  if (process.platform !== "darwin") {
    return;
  }

  const plistPath = path.resolve(binaryPath, "..", "..", "Info.plist");
  if (!fs.existsSync(plistPath)) {
    return;
  }

  setPlistKey(plistPath, "CFBundleName", name);
  setPlistKey(plistPath, "CFBundleDisplayName", name);
}

patchMacAppName(electronBinary, appName);

if (process.env.ELECTRON_PATCH_ONLY === "1") {
  process.exit(0);
}

const child = spawn(electronBinary, [".", ...process.argv.slice(2)], {
  stdio: "inherit",
  env: process.env,
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }

  process.exit(code ?? 0);
});
