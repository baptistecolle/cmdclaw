import { Template } from "e2b";

export const template = Template()
  .fromUbuntuImage("24.04")
  // Install base dependencies
  .aptInstall(['curl', 'git', 'ripgrep', 'ca-certificates', 'gnupg', 'unzip'])
  // Install Python 3 (Ubuntu 24.04 has Python 3.12)
  .aptInstall(['python3', 'python3-venv', 'python3-pip', 'python-is-python3'])
  // Install bun
  .runCmd('curl -fsSL https://bun.sh/install | bash && echo \'export BUN_INSTALL="$HOME/.bun"\' >> ~/.bashrc && echo \'export PATH="$BUN_INSTALL/bin:$PATH"\' >> ~/.bashrc')
  // OpenCode server and tsx for running TypeScript CLI tools
  .runCmd('$HOME/.bun/bin/bun install -g opencode-ai tsx')
  .setWorkdir('/app')
  // Copy OpenCode config and plugins
  .copy("opencode.json", "/app/opencode.json")
  .runCmd('mkdir -p /app/.opencode/plugins')
  .copy("plugins/integration-permissions.ts", "/app/.opencode/plugins/integration-permissions.ts")
  // Copy CLI tools directory
  .copy("cli", "/app/cli")
  // allow to install packages from pip
  .runCmd('mkdir -p $HOME/.config/pip && echo -e "[global]\nbreak-system-packages = true" > $HOME/.config/pip/pip.conf')
  .runCmd('/app/cli/setup.sh')

