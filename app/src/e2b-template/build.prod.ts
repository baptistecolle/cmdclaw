import { config } from "dotenv";
import { Template, defaultBuildLogger } from "e2b";
import { template } from "./template";
import path from "path";

// Load .env from parent directory
config({ path: path.join(process.cwd(), ".env") });

async function main() {
  console.log("Building production template...");

  const result = await Template.build(template, {
    alias: "bap-agent-prod",
    cpuCount: 2,
    memoryMB: 2048,
    onBuildLogs: defaultBuildLogger(),
    ...(process.env.E2B_ACCESS_TOKEN && {
      apiKey: process.env.E2B_ACCESS_TOKEN,
    }),
  });

  console.log("\nTemplate built successfully!");
  console.log("Template ID:", result.templateId);
  console.log("Alias: bap-agent");
  console.log("\nUse with: Sandbox.create('bap-agent')");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
