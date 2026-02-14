const { app, BrowserWindow } = require("electron");
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

let serverProcess = null;

function createWindow(startUrl) {
  const win = new BrowserWindow({
    width: 1400,
    height: 920,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  win.loadURL(startUrl);
}

function getFreePort() {
  return 3412;
}

function startBundledNextServer() {
  const desktopRoot = path.resolve(__dirname, "..");
  const serverEntry = path.join(desktopRoot, "app-bundle", "standalone", "server.js");

  if (!fs.existsSync(serverEntry)) {
    throw new Error(
      `Cannot find bundled Next server at ${serverEntry}. Run: bun run build in /desktop`
    );
  }

  const port = String(process.env.PORT || getFreePort());
  const host = process.env.HOST || "127.0.0.1";

  serverProcess = spawn(process.execPath, [serverEntry], {
    cwd: path.dirname(serverEntry),
    env: {
      ...process.env,
      NODE_ENV: "production",
      PORT: port,
      HOSTNAME: host,
    },
    stdio: "inherit",
  });

  serverProcess.on("exit", (code, signal) => {
    serverProcess = null;
    if (!app.isQuitting) {
      console.error(`Bundled server exited (code=${code}, signal=${signal})`);
    }
  });

  return `http://${host}:${port}`;
}

app.on("before-quit", () => {
  app.isQuitting = true;
  if (serverProcess) {
    serverProcess.kill("SIGTERM");
  }
});

app.whenReady().then(() => {
  const devUrl = process.env.NEXT_DEV_URL;
  const startUrl = devUrl || startBundledNextServer();
  createWindow(startUrl);

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow(startUrl);
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
