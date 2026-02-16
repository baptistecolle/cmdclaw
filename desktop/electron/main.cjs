const { app, BrowserWindow, dialog } = require("electron");
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const http = require("node:http");
const net = require("node:net");
const path = require("node:path");

let serverProcess = null;
let mainWindow = null;
const desktopRoot = path.resolve(__dirname, "..");
const iconPngPath = path.join(desktopRoot, "build", "icons", "icon-512.png");

app.setName("Bap");

function createWindow(startUrl) {
  const win = new BrowserWindow({
    width: 1400,
    height: 920,
    ...(fs.existsSync(iconPngPath) ? { icon: iconPngPath } : {}),
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  win.loadURL(startUrl);
}

async function getFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close(() => {
        if (address && typeof address === "object") {
          resolve(address.port);
          return;
        }
        reject(new Error("Failed to resolve a free local port"));
      });
    });
  });
}

function waitForServerReady(url, timeoutMs = 20000) {
  const start = Date.now();

  return new Promise((resolve, reject) => {
    const check = () => {
      const req = http.get(url, (res) => {
        res.resume();
        resolve();
      });

      req.on("error", () => {
        if (Date.now() - start >= timeoutMs) {
          reject(new Error(`Timed out waiting for server at ${url}`));
          return;
        }
        setTimeout(check, 250);
      });
    };

    check();
  });
}

function resolveBundledServerEntry() {
  const relativeServerPath = path.join("app-bundle", "standalone", "server.js");

  const candidates = app.isPackaged
    ? [
        path.join(process.resourcesPath, "app.asar.unpacked", relativeServerPath),
        path.join(process.resourcesPath, "app.asar", relativeServerPath),
      ]
    : [path.join(desktopRoot, relativeServerPath)];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  throw new Error(
    `Cannot find bundled Next server. Looked in: ${candidates.join(", ")}. Run: bun run build in /desktop`
  );
}

async function startBundledNextServer() {
  const serverEntry = resolveBundledServerEntry();

  const port = String(process.env.PORT || (await getFreePort()));
  const host = process.env.HOST || "127.0.0.1";
  const startUrl = `http://${host}:${port}`;
  const nodeExecPath =
    app.isPackaged && process.helperExecPath ? process.helperExecPath : process.execPath;

  serverProcess = spawn(nodeExecPath, [serverEntry], {
    cwd: path.dirname(serverEntry),
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: "1",
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

  await waitForServerReady(startUrl);
  return startUrl;
}

app.on("before-quit", () => {
  app.isQuitting = true;
  if (serverProcess) {
    serverProcess.kill("SIGTERM");
  }
});

const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  app.quit();
}

app.on("second-instance", () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) {
      mainWindow.restore();
    }
    mainWindow.focus();
  }
});

app.whenReady().then(async () => {
  try {
    if (process.platform === "darwin" && app.dock && fs.existsSync(iconPngPath)) {
      app.dock.setIcon(iconPngPath);
    }

    const devUrl = process.env.NEXT_DEV_URL;
    const startUrl = devUrl || (await startBundledNextServer());
    createWindow(startUrl);
    mainWindow = BrowserWindow.getAllWindows()[0] || null;

    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        createWindow(startUrl);
        mainWindow = BrowserWindow.getAllWindows()[0] || null;
      }
    });
  } catch (error) {
    const message = error && error.stack ? error.stack : String(error);
    dialog.showErrorBox("Bap failed to start", message);
    app.quit();
  }
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
