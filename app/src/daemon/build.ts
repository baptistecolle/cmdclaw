/**
 * Cross-platform build script for the Bap daemon.
 * Produces standalone executables using `bun build --compile`.
 */

import { platform, arch } from "os";
import { mkdirSync, existsSync } from "fs";

const targets: { os: string; arch: string; bunTarget: string }[] = [
  { os: "darwin", arch: "arm64", bunTarget: "bun-darwin-arm64" },
  { os: "darwin", arch: "x64", bunTarget: "bun-darwin-x64" },
  { os: "linux", arch: "x64", bunTarget: "bun-linux-x64" },
  { os: "linux", arch: "arm64", bunTarget: "bun-linux-arm64" },
  { os: "win32", arch: "x64", bunTarget: "bun-windows-x64" },
];

async function build(): Promise<void> {
  const outputDir = "dist";

  if (!existsSync(outputDir)) {
    mkdirSync(outputDir, { recursive: true });
  }

  const requestedTarget = process.argv[2]; // e.g., "darwin-arm64"
  const filteredTargets = requestedTarget
    ? targets.filter((t) => `${t.os}-${t.arch}` === requestedTarget)
    : targets.filter((t) => t.os === platform() && t.arch === arch());

  if (filteredTargets.length === 0) {
    console.error("No matching targets found");
    process.exit(1);
  }

  for (const target of filteredTargets) {
    const ext = target.os === "win32" ? ".exe" : "";
    const outPath = `${outputDir}/bap-daemon-${target.os}-${target.arch}${ext}`;

    console.log(`Building for ${target.os}-${target.arch}...`);

    const proc = Bun.spawn(
      [
        "bun",
        "build",
        "--compile",
        "--target",
        target.bunTarget,
        "--outfile",
        outPath,
        "src/index.ts",
      ],
      {
        cwd: import.meta.dir,
        stdout: "inherit",
        stderr: "inherit",
      },
    );

    const exitCode = await proc.exited;
    if (exitCode !== 0) {
      console.error(`Build failed for ${target.os}-${target.arch}`);
      process.exit(1);
    }

    console.log(`  -> ${outPath}`);
  }

  console.log("\nBuild complete!");
}

build().catch((err) => {
  console.error("Build error:", err);
  process.exit(1);
});
