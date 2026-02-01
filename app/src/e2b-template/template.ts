import { Template } from "e2b";

export const template = Template()
  .fromUbuntuImage("24.04")
  // Install base dependencies
  .aptInstall(['curl', 'git', 'ripgrep', 'ca-certificates', 'gnupg', 'unzip'])
  // Install Python 3 (Ubuntu 24.04 has Python 3.12)
  .aptInstall(['python3', 'python3-venv', 'python3-pip', 'python-is-python3'])
  // Install Node.js 22.x LTS (needed for packages with node shebang)
  .runCmd('curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash - && sudo apt-get install -y nodejs')
  // Install bun and create symlinks in /usr/local/bin for PATH availability
  .runCmd('curl -fsSL https://bun.sh/install | bash')
  .runCmd('sudo ln -s $HOME/.bun/bin/bun /usr/local/bin/bun')
  // OpenCode server and tsx for running TypeScript CLI tools
  .runCmd('$HOME/.bun/bin/bun install -g opencode-ai tsx')
  .runCmd('sudo ln -s $HOME/.bun/bin/opencode /usr/local/bin/opencode')
  .runCmd('sudo ln -s $HOME/.bun/bin/tsx /usr/local/bin/tsx')
  .setWorkdir('/app')
  // Copy OpenCode config and plugins
  .copy("opencode.json", "/app/opencode.json")
  .runCmd('mkdir -p /app/.opencode/plugins')
  .copy("plugins/integration-permissions.ts", "/app/.opencode/plugins/integration-permissions.ts")
  // Copy skills into .claude/skills
  .runCmd('mkdir -p /app/.claude')
  .copyItems([{ src: "skills/", dest: "/app/.claude/skills/" }])
  // Copy setup script
  .copy("setup.sh", "/app/setup.sh")
  // allow to install packages from pip
  .runCmd('mkdir -p $HOME/.config/pip && echo -e "[global]\nbreak-system-packages = true" > $HOME/.config/pip/pip.conf')
  .runCmd('/app/setup.sh')

