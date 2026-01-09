import { Template } from "e2b";

export const template = Template()
  .fromUbuntuImage("22.04")
  // install python and npm
  .aptInstall(['python3', 'npm'])
  // .aptInstall(['curl', 'git', 'ripgrep'])
  // .bunInstall(['@anthropic-ai/claude-agent-sdk', '@anthropic-ai/claude-code'], { g: true })
  .aptInstall(['curl', 'git', 'ripgrep'])
  // Claude Code will be available globally as "claude"
  .npmInstall('@anthropic-ai/claude-code@latest', { g: true })
  .setWorkdir('/app')
  .copy(".claude", "/app/.claude")
  .copy("cli", "/app/cli")
  // .runCmd(`/app/cli/setup.sh`)

