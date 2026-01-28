# Bap Daemon Installer for Windows
# Usage: irm https://heybap.com/i.ps1 | iex

$ErrorActionPreference = "Stop"

$REPO = "heybap/bap"
$INSTALL_DIR = "$env:USERPROFILE\.bap"
$BIN_DIR = "$INSTALL_DIR\bin"
$BIN_NAME = "bap-daemon.exe"

function Get-Platform {
    $arch = [System.Runtime.InteropServices.RuntimeInformation]::OSArchitecture
    switch ($arch) {
        "X64" { return "win32-x64" }
        default {
            Write-Error "Unsupported architecture: $arch"
            exit 1
        }
    }
}

function Get-DownloadUrl {
    param([string]$Platform)

    $releases = Invoke-RestMethod -Uri "https://api.github.com/repos/$REPO/releases/latest"
    $asset = $releases.assets | Where-Object { $_.name -like "*bap-daemon-$Platform*" } | Select-Object -First 1

    if (-not $asset) {
        Write-Error "No release found for platform: $Platform"
        exit 1
    }

    return $asset.browser_download_url
}

Write-Host ""
Write-Host "  Installing Bap Daemon..."
Write-Host ""

$platform = Get-Platform
Write-Host "  Platform: $platform"

# Create install directory
New-Item -ItemType Directory -Force -Path $BIN_DIR | Out-Null

# Download binary
Write-Host "  Downloading..."
$downloadUrl = Get-DownloadUrl -Platform $platform
Invoke-WebRequest -Uri $downloadUrl -OutFile "$BIN_DIR\$BIN_NAME"

Write-Host "  Installed to $BIN_DIR\$BIN_NAME"

# Add to PATH if not already there
$currentPath = [Environment]::GetEnvironmentVariable("PATH", "User")
if ($currentPath -notlike "*\.bap\bin*") {
    [Environment]::SetEnvironmentVariable("PATH", "$BIN_DIR;$currentPath", "User")
    Write-Host "  Added to PATH"
}

# Update current session PATH
$env:PATH = "$BIN_DIR;$env:PATH"

Write-Host ""
Write-Host "  Run 'bap-daemon start' to connect your machine."
Write-Host ""

# Start auth flow
& "$BIN_DIR\$BIN_NAME" auth
