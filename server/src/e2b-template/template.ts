import { Template } from "e2b";


// Build the template
export const template = Template()
  .fromBunImage()
  .runCmd(`bun install @anthropic-ai/claude-agent-sdk @anthropic-ai/claude-code`)
  .setWorkdir('/app')
  .copy(".claude", "/app/.claude")
  .copy("cli", "/app/cli")

