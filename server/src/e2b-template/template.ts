import { Template } from "e2b";

export const template = Template()
  .fromUbuntuImage("24.04")
  // Install base dependencies
  .aptInstall(['curl', 'git', 'ripgrep', 'ca-certificates', 'gnupg'])
  // Install Python 3 (Ubuntu 24.04 has Python 3.12)
  .aptInstall(['python3', 'python3-venv', 'python3-pip', 'python-is-python3'])
  // Install Node.js 22.x LTS from NodeSource and update npm to latest
  .runCmd('curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash - && sudo apt-get install -y nodejs')
  .runCmd('sudo npm install -g npm@latest')
  // Claude Code and tsx for running TypeScript CLI tools
  .npmInstall(['@anthropic-ai/claude-code', '@anthropic-ai/claude-agent-sdk', 'tsx'], { g: true })
  .setWorkdir('/app')
  .copy(".claude", "/app/.claude")
  .copy("cli", "/app/cli")
  .runCmd('/app/cli/setup.sh')

