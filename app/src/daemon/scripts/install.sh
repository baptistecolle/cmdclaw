#!/usr/bin/env bash
# CmdClaw Daemon Installer
# Usage: curl -fsSL https://cmdclaw.com/i | sh
set -euo pipefail

REPO="cmdclaw/cmdclaw"
INSTALL_DIR="$HOME/.cmdclaw"
BIN_NAME="cmdclaw-daemon"

# Detect OS and architecture
detect_platform() {
  local os arch

  case "$(uname -s)" in
    Linux*)  os="linux" ;;
    Darwin*) os="darwin" ;;
    *)       echo "Unsupported OS: $(uname -s)"; exit 1 ;;
  esac

  case "$(uname -m)" in
    x86_64|amd64) arch="x64" ;;
    aarch64|arm64) arch="arm64" ;;
    *)             echo "Unsupported architecture: $(uname -m)"; exit 1 ;;
  esac

  echo "${os}-${arch}"
}

# Get latest release URL from GitHub
get_download_url() {
  local platform="$1"
  local url

  url=$(curl -fsSL "https://api.github.com/repos/${REPO}/releases/latest" \
    | grep "browser_download_url.*cmdclaw-daemon-${platform}" \
    | head -1 \
    | cut -d '"' -f 4)

  if [ -z "$url" ]; then
    echo "No release found for platform: ${platform}" >&2
    exit 1
  fi

  echo "$url"
}

main() {
  echo ""
  echo "  Installing CmdClaw Daemon..."
  echo ""

  local platform
  platform=$(detect_platform)
  echo "  Platform: ${platform}"

  # Create install directory
  mkdir -p "${INSTALL_DIR}/bin"

  # Download binary
  echo "  Downloading..."
  local download_url
  download_url=$(get_download_url "$platform")

  curl -fsSL "$download_url" -o "${INSTALL_DIR}/bin/${BIN_NAME}"
  chmod +x "${INSTALL_DIR}/bin/${BIN_NAME}"

  echo "  Installed to ${INSTALL_DIR}/bin/${BIN_NAME}"

  # Add to PATH if not already there
  local shell_profile=""
  if [ -f "$HOME/.zshrc" ]; then
    shell_profile="$HOME/.zshrc"
  elif [ -f "$HOME/.bashrc" ]; then
    shell_profile="$HOME/.bashrc"
  elif [ -f "$HOME/.profile" ]; then
    shell_profile="$HOME/.profile"
  fi

  local path_entry="export PATH=\"\$HOME/.cmdclaw/bin:\$PATH\""

  if [ -n "$shell_profile" ]; then
    if ! grep -q ".cmdclaw/bin" "$shell_profile" 2>/dev/null; then
      echo "" >> "$shell_profile"
      echo "# CmdClaw Daemon" >> "$shell_profile"
      echo "$path_entry" >> "$shell_profile"
      echo "  Added to PATH in ${shell_profile}"
    fi
  fi

  # Make available in current session
  export PATH="$HOME/.cmdclaw/bin:$PATH"

  echo ""
  echo "  Run 'cmdclaw-daemon start' to connect your machine."
  echo ""

  # Start auth flow
  "${INSTALL_DIR}/bin/${BIN_NAME}" auth
}

main
