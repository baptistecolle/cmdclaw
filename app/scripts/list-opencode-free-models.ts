import { fetchOpencodeFreeModels } from "../src/lib/zen-models";

function isJsonOutput(argv: string[]): boolean {
  return argv.includes("--json");
}

async function main(): Promise<void> {
  const models = await fetchOpencodeFreeModels();

  if (isJsonOutput(process.argv.slice(2))) {
    console.log(JSON.stringify(models, null, 2));
    return;
  }

  if (models.length === 0) {
    console.log("No free OpenCode models found.");
    return;
  }

  console.log(`OpenCode free models (${models.length}):`);
  for (const model of models) {
    console.log(`- ${model.name} (${model.id})`);
  }
}

main().catch((error) => {
  console.error("Failed to fetch OpenCode free models:", error);
  process.exit(1);
});
