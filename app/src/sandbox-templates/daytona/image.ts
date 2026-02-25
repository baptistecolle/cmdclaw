import { Image } from "@daytonaio/sdk";

const COMMON_ROOT = "src/sandbox-templates/common";

export const image = Image.debianSlim()
  .addLocalFile(`${COMMON_ROOT}/opencode.json`, "/app/opencode.json")
  .addLocalDir(`${COMMON_ROOT}/plugins`, "/app/.opencode/plugins")
  .addLocalDir(`${COMMON_ROOT}/tools`, "/app/.opencode/tools")
  .addLocalDir(`${COMMON_ROOT}/skills`, "/app/.claude/skills")
  .addLocalFile(`${COMMON_ROOT}/setup.sh`, "/app/setup.sh")
  .runCommands("apt-get update")
  .runCommands("apt-get install -y curl git ripgrep ca-certificates gnupg unzip")
  .runCommands("apt-get install -y python3 python3-venv python3-pip python-is-python3")
  .runCommands("curl -fsSL https://deb.nodesource.com/setup_22.x | bash -")
  .runCommands("apt-get install -y nodejs")
  .runCommands(
    "apt-get install -y libxcb-shm0 libx11-xcb1 libx11-6 libxcb1 libxext6 libxrandr2 libxcomposite1 libxcursor1 libxdamage1 libxfixes3 libxi6 libgtk-3-0 libpangocairo-1.0-0 libpango-1.0-0 libatk1.0-0 libcairo-gobject2 libcairo2 libgdk-pixbuf-2.0-0 libxrender1 libasound2 libfreetype6 libfontconfig1 libdbus-1-3 libnss3 libnspr4 libatk-bridge2.0-0 libdrm2 libxkbcommon0 libatspi2.0-0 libcups2 libxshmfence1 libgbm1",
  )
  .runCommands("npm i -g agent-browser")
  .runCommands("agent-browser install")
  .runCommands("curl -fsSL https://bun.sh/install | bash")
  .runCommands("ln -s $HOME/.bun/bin/bun /usr/local/bin/bun")
  .runCommands("$HOME/.bun/bin/bun install -g opencode-ai tsx")
  .runCommands("ln -s $HOME/.bun/bin/opencode /usr/local/bin/opencode")
  .runCommands("ln -s $HOME/.bun/bin/tsx /usr/local/bin/tsx")
  // Install TypeScript tool runtime deps resolved from /app/.opencode/tools/*.ts
  .runCommands(
    'bash -lc \'cd /app && printf "{\\"name\\":\\"sandbox-runtime\\",\\"private\\":true}\\n" > package.json && bun install @opencode-ai/plugin\'',
  )
  .runCommands("mkdir -p $HOME/.config/opencode /app/.opencode $HOME/.cache/opencode")
  .runCommands("cp /app/opencode.json /app/.opencode/opencode.json")
  .runCommands("chmod +x /app/setup.sh")
  .runCommands("/app/setup.sh")
  .workdir("/app");
