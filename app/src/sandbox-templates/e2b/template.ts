import { Template } from "e2b";

const COMMON_ROOT = "common";

export const template = Template({
  fileContextPath: "src/sandbox-templates",
})
  .fromUbuntuImage("24.04")
  // Install base dependencies
  .aptInstall(["curl", "git", "ripgrep", "ca-certificates", "gnupg", "unzip"])
  // Install Python 3 (Ubuntu 24.04 has Python 3.12)
  .aptInstall(["python3", "python3-venv", "python3-pip", "python-is-python3"])
  // Install Node.js 22.x LTS (needed for packages with node shebang)
  .runCmd(
    "curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash - && sudo apt-get install -y nodejs",
  )
  // Install agent-browser and preload Chromium
  .npmInstall(["agent-browser"], { g: true })
  .runCmd("agent-browser install --with-deps")
  // Install bun and create symlinks in /usr/local/bin for PATH availability
  .runCmd("curl -fsSL https://bun.sh/install | bash")
  .runCmd("sudo ln -s $HOME/.bun/bin/bun /usr/local/bin/bun")
  // OpenCode server and tsx for running TypeScript CLI tools
  .runCmd("$HOME/.bun/bin/bun install -g opencode-ai tsx")
  .runCmd("sudo ln -s $HOME/.bun/bin/opencode /usr/local/bin/opencode")
  .runCmd("sudo ln -s $HOME/.bun/bin/tsx /usr/local/bin/tsx")
  .setWorkdir("/app")
  // Copy OpenCode config and plugins
  .copy(`${COMMON_ROOT}/opencode.json`, "/app/opencode.json")
  .runCmd("mkdir -p /app/.opencode/plugins")
  .copy(`${COMMON_ROOT}/plugins`, "/app/.opencode/plugins")
  // Prewarm OpenCode runtime/plugin deps to avoid 3-5s lazy install on first health request
  .runCmd("mkdir -p $HOME/.config/opencode /app/.opencode $HOME/.cache/opencode")
  .runCmd("cp /app/opencode.json /app/.opencode/opencode.json")
  .runCmd(
    'bash -lc \'set -euo pipefail; opencode serve --hostname 127.0.0.1 --port 4096 > /tmp/opencode-prewarm.log 2>&1 & pid=$!; ok=0; for i in $(seq 1 120); do if curl -fsS http://127.0.0.1:4096/health >/dev/null 2>&1; then ok=1; break; fi; sleep 0.25; done; kill $pid || true; wait $pid || true; test "$ok" = "1"\'',
  )
  // Copy skills into .claude/skills
  .runCmd("mkdir -p /app/.claude")
  .copy(`${COMMON_ROOT}/skills`, "/app/.claude/skills")
  // Copy setup script
  .copy(`${COMMON_ROOT}/setup.sh`, "/app/setup.sh")
  // allow to install packages from pip
  .runCmd(
    'mkdir -p $HOME/.config/pip && echo -e "[global]\nbreak-system-packages = true" > $HOME/.config/pip/pip.conf',
  )
  .runCmd("/app/setup.sh");
