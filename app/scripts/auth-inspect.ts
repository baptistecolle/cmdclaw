import {
  DEFAULT_SERVER_URL,
  createRpcClient,
  getConfigPathForServerUrl,
  loadConfig,
} from "./lib/cli-shared";

type ParsedArgs = {
  serverUrl?: string;
  token?: string;
  help: boolean;
};

function parseArgs(argv: string[]): ParsedArgs {
  const args: ParsedArgs = { help: false };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    switch (arg) {
      case "--server":
      case "-s":
        args.serverUrl = argv[i + 1];
        i += 1;
        break;
      case "--token":
      case "-t":
        args.token = argv[i + 1];
        i += 1;
        break;
      case "--help":
      case "-h":
        args.help = true;
        break;
      default:
        throw new Error(`Unknown flag: ${arg}`);
    }
  }

  return args;
}

function printHelp(): void {
  console.log("\nUsage: bun run auth:inspect [options]\n");
  console.log("Options:");
  console.log("  -s, --server <url>   Override server URL");
  console.log("  -t, --token <token>  Override auth token");
  console.log("  -h, --help           Show help\n");
}

async function main(): Promise<void> {
  let args: ParsedArgs;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    printHelp();
    process.exit(1);
    return;
  }

  if (args.help) {
    printHelp();
    process.exit(0);
  }

  const serverUrl = args.serverUrl || process.env.BAP_SERVER_URL || DEFAULT_SERVER_URL;
  const config = loadConfig(serverUrl);
  const token = args.token || config?.token;

  console.log("Auth source:");
  console.log(`  server: ${serverUrl}`);
  console.log(
    `  token from: ${args.token ? "--token" : config?.token ? getConfigPathForServerUrl(serverUrl) : "none"}`,
  );

  if (!token) {
    console.error("\nNo token found. Run `bun run chat --auth` first.");
    process.exit(1);
  }

  const client = createRpcClient(serverUrl, token);

  try {
    const [me, integrations, customIntegrations] = await Promise.all([
      client.user.me(),
      client.integration.list(),
      client.integration.listCustomIntegrations(),
    ]);

    console.log("\nCurrent user:");
    console.log(`  id: ${me.id}`);
    console.log(`  email: ${me.email}`);
    console.log(`  name: ${me.name ?? "-"}`);
    console.log(`  onboardedAt: ${me.onboardedAt ?? "-"}`);

    console.log(`\nBuilt-in integrations (${integrations.length}):`);
    if (integrations.length === 0) {
      console.log("  (none)");
    } else {
      for (const item of integrations) {
        console.log(
          `  - ${item.type} | enabled=${item.enabled} | displayName=${item.displayName ?? "-"}`,
        );
      }
    }

    console.log(`\nCustom integrations (${customIntegrations.length}):`);
    if (customIntegrations.length === 0) {
      console.log("  (none)");
    } else {
      for (const item of customIntegrations) {
        console.log(
          `  - ${item.slug} | enabled=${item.enabled} | connected=${item.connected} | name=${item.name}`,
        );
      }
    }

    console.log("\nNote: chat and workflow CLIs both use the same token/config source by default.");
  } catch (error) {
    console.error("\nAuth inspect failed:");
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

void main();
