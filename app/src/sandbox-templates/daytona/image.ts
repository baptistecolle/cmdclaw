import { Image } from "@daytonaio/sdk";

const COMMON_ROOT = "src/sandbox-templates/common";

export const image = Image.debianSlim()
  .addLocalFile(`${COMMON_ROOT}/opencode.json`, "/app/opencode.json")
  .addLocalDir(`${COMMON_ROOT}/plugins`, "/app/.opencode/plugins")
  .addLocalDir(`${COMMON_ROOT}/skills`, "/app/.claude/skills")
  .addLocalFile(`${COMMON_ROOT}/setup.sh`, "/app/setup.sh")
  .runCommands("apt-get update")
  .runCommands("apt-get install -y curl git ripgrep ca-certificates gnupg unzip")
  .runCommands("apt-get install -y python3 python3-venv python3-pip python-is-python3")
  .runCommands("curl -fsSL https://deb.nodesource.com/setup_22.x | bash -")
  .runCommands("apt-get install -y nodejs")
  .runCommands("npm i -g agent-browser")
  .runCommands("agent-browser install --with-deps")
  .runCommands("curl -fsSL https://bun.sh/install | bash")
  .runCommands("ln -s $HOME/.bun/bin/bun /usr/local/bin/bun")
  .runCommands("$HOME/.bun/bin/bun install -g opencode-ai tsx")
  .runCommands("ln -s $HOME/.bun/bin/opencode /usr/local/bin/opencode")
  .runCommands("ln -s $HOME/.bun/bin/tsx /usr/local/bin/tsx")
  .runCommands("mkdir -p $HOME/.config/opencode /app/.opencode $HOME/.cache/opencode")
  .runCommands("cp /app/opencode.json /app/.opencode/opencode.json")
  .runCommands("chmod +x /app/setup.sh")
  .runCommands("/app/setup.sh")
  .workdir("/app");
