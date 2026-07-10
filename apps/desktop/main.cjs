const { app, BrowserWindow, Menu, dialog, ipcMain, screen, shell } = require("electron");
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const http = require("node:http");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");

const HOST = "127.0.0.1";
const DEFAULT_PORT = Number(process.env.SYNCHROPAGE_DESKTOP_PORT || 8765);
const PORT_SCAN_LIMIT = Number(process.env.SYNCHROPAGE_DESKTOP_PORT_SCAN_LIMIT || 20);
const BACKEND_START_TIMEOUT_MS = Number(process.env.SYNCHROPAGE_BACKEND_START_TIMEOUT_MS || 30_000);
const BACKEND_HEALTH_POLL_INTERVAL_MS = Number(process.env.SYNCHROPAGE_BACKEND_HEALTH_POLL_INTERVAL_MS || 50);
const DEFAULT_WINDOW_WIDTH = 1680;
const DEFAULT_WINDOW_HEIGHT = 920;
const MIN_WINDOW_WIDTH = 1180;
const MIN_WINDOW_HEIGHT = 720;
const WORK_AREA_MARGIN = 24;
const STARTUP_STARTED_AT = Date.now();
const STARTUP_METRICS_ENABLED = process.env.SYNCHROPAGE_STARTUP_METRICS === "1";

let mainWindow = null;
let backendProcess = null;
let backendLogPath = null;
let startupError = null;
let desktopRuntime = {
  dataDir: null,
  configuredDataDir: null,
  dataDirManagedByEnv: false,
  backendDataDir: null,
  oauthStoragePath: null,
  oauthStoragePathExplicit: false,
  configPath: null,
  configValues: {}
};

try {
  desktopRuntime = configureDesktopRuntime();
} catch (error) {
  startupError = error;
}
registerDesktopIpcHandlers();

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  });
}

app.on("ready", async () => {
  logStartupMetric("app-ready");
  Menu.setApplicationMenu(null);
  try {
    if (startupError) throw startupError;
    const webRoot = resolveWebRoot();
    ensureBuiltWebRoot(webRoot);
    const backend = await ensureBackend(webRoot);
    logStartupMetric("backend-ready", { port: backend.port, external: backend.external });
    mainWindow = createMainWindow(backend.url);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    dialog.showErrorBox("SynchroPage failed to start", message);
    app.quit();
  }
});

app.on("window-all-closed", () => {
  app.quit();
});

app.on("before-quit", () => {
  stopBackend();
});

process.on("exit", () => {
  stopBackend();
});

function createMainWindow(url) {
  const bounds = getDefaultWindowBounds();
  const win = new BrowserWindow({
    ...bounds,
    title: "SynchroPage",
    show: false,
    autoHideMenuBar: true,
    backgroundColor: "#f5f6f8",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, "preload.cjs")
    }
  });

  win.webContents.setWindowOpenHandler(({ url: targetUrl }) => {
    if (targetUrl.startsWith(url)) return { action: "allow" };
    shell.openExternal(targetUrl);
    return { action: "deny" };
  });

  win.webContents.on("will-navigate", (event, targetUrl) => {
    if (targetUrl.startsWith(url)) return;
    event.preventDefault();
    shell.openExternal(targetUrl);
  });

  if (process.env.SYNCHROPAGE_DESKTOP_DEVTOOLS === "1") {
    win.webContents.openDevTools({ mode: "detach" });
  }

  logStartupMetric("window-created");
  let hasShownWindow = false;
  const showWindow = (source) => {
    if (hasShownWindow || win.isDestroyed()) return;
    hasShownWindow = true;
    logStartupMetric("window-show", { source });
    win.show();
  };
  const showFallbackTimer = setTimeout(() => showWindow("timeout"), 3000);
  showFallbackTimer.unref?.();
  win.once("ready-to-show", () => {
    clearTimeout(showFallbackTimer);
    logStartupMetric("window-ready-to-show");
    showWindow("ready-to-show");
  });
  win.webContents.once("dom-ready", () => logStartupMetric("dom-ready"));
  win.webContents.once("did-finish-load", () => logStartupMetric("did-finish-load"));
  void win.loadURL(url);
  return win;
}

function getDefaultWindowBounds() {
  const { workArea } = screen.getPrimaryDisplay();
  const maxWidth = Math.max(960, workArea.width - WORK_AREA_MARGIN * 2);
  const maxHeight = Math.max(640, workArea.height - WORK_AREA_MARGIN * 2);
  const width = Math.min(DEFAULT_WINDOW_WIDTH, maxWidth);
  const height = Math.min(DEFAULT_WINDOW_HEIGHT, maxHeight);

  return {
    x: Math.round(workArea.x + (workArea.width - width) / 2),
    y: Math.round(workArea.y + (workArea.height - height) / 2),
    width,
    height,
    minWidth: Math.min(MIN_WINDOW_WIDTH, width),
    minHeight: Math.min(MIN_WINDOW_HEIGHT, height)
  };
}

async function ensureBackend(webRoot) {
  for (let offset = 0; offset < PORT_SCAN_LIMIT; offset += 1) {
    const port = DEFAULT_PORT + offset;
    const health = await getBackendHealth(port);
    if (health.ok) {
      return { port, url: `http://${HOST}:${port}/`, external: true };
    }
    const occupied = await isPortOccupied(port);
    if (occupied) continue;

    startBackend(port, webRoot);
    await waitForBackend(port);
    return { port, url: `http://${HOST}:${port}/`, external: false };
  }

  throw new Error(`No available SynchroPage backend port found from ${DEFAULT_PORT} to ${DEFAULT_PORT + PORT_SCAN_LIMIT - 1}.`);
}

function startBackend(port, webRoot) {
  const backendBinary = resolveBackendBinary();
  const env = {
    ...process.env,
    PYTHONUNBUFFERED: "1"
  };
  if (desktopRuntime.backendDataDir && !env.PDF_AGENT_HOME) {
    env.PDF_AGENT_HOME = desktopRuntime.backendDataDir;
  }
  if (desktopRuntime.oauthStoragePath && !env.PDF_AGENT_OPENAI_OAUTH_STORAGE_PATH) {
    if (desktopRuntime.oauthStoragePathExplicit || !env.PDF_AGENT_HOME) {
      env.PDF_AGENT_OPENAI_OAUTH_STORAGE_PATH = desktopRuntime.oauthStoragePath;
    }
  }

  let command;
  let args;
  let cwd;

  if (backendBinary) {
    command = backendBinary;
    args = ["--host", HOST, "--port", String(port), "--web-root", webRoot];
    cwd = path.dirname(backendBinary);
  } else {
    if (app.isPackaged) {
      throw new Error("Packaged app is missing the bundled SynchroPage backend. Rebuild with `npm --prefix apps/desktop run dist`.");
    }
    const repoRoot = resolveRepoRoot();
    const python = process.env.SYNCHROPAGE_PYTHON || "python3";
    command = python;
    args = ["-m", "pdf_agent.server.web_app", "--host", HOST, "--port", String(port), "--web-root", webRoot];
    cwd = repoRoot;
    env.PYTHONPATH = [path.join(repoRoot, "src"), process.env.PYTHONPATH].filter(Boolean).join(path.delimiter);
  }

  backendProcess = spawn(command, args, {
    cwd,
    env,
    stdio: ["ignore", "pipe", "pipe"]
  });

  backendProcess.on("error", (error) => {
    appendBackendLog(`backend process error: ${error.message}\n`);
  });
  backendProcess.stdout.on("data", (chunk) => appendBackendLog(chunk));
  backendProcess.stderr.on("data", (chunk) => appendBackendLog(chunk));
  backendProcess.on("exit", (code, signal) => {
    appendBackendLog(`backend exited: code=${code ?? "null"} signal=${signal ?? "null"}\n`);
    backendProcess = null;
  });
}

function stopBackend() {
  if (!backendProcess) return;
  const child = backendProcess;
  backendProcess = null;
  if (!child.killed) child.kill("SIGTERM");
}

function resolveRepoRoot() {
  return path.resolve(__dirname, "..", "..");
}

function resolveWebRoot() {
  if (app.isPackaged) return path.join(process.resourcesPath, "web-dist");
  return path.resolve(__dirname, "..", "web", "dist");
}

function resolveBackendBinary() {
  const candidates = [];
  if (process.env.SYNCHROPAGE_BACKEND_BINARY) candidates.push(process.env.SYNCHROPAGE_BACKEND_BINARY);
  if (app.isPackaged) candidates.push(path.join(process.resourcesPath, "backend", "synchropage-backend"));
  candidates.push(path.resolve(__dirname, "bin", "synchropage-backend"));
  for (const candidate of candidates) {
    const executable = resolveBackendExecutable(candidate);
    if (executable) return executable;
  }
  return null;
}

function resolveBackendExecutable(candidate) {
  if (!candidate || !fs.existsSync(candidate)) return null;
  const stat = fs.statSync(candidate);
  if (stat.isFile()) return candidate;
  if (!stat.isDirectory()) return null;
  const nestedExecutable = path.join(candidate, "synchropage-backend");
  if (fs.existsSync(nestedExecutable) && fs.statSync(nestedExecutable).isFile()) {
    return nestedExecutable;
  }
  return null;
}

function configureDesktopRuntime() {
  const config = readDesktopConfig();
  const envDataDirSetting = firstPathSetting(
    { value: process.env.SYNCHROPAGE_DESKTOP_DATA_DIR, baseDir: process.cwd() }
  );
  const configuredDataDirSetting = firstPathSetting(
    { value: config.values.dataDir, baseDir: config.baseDir },
    { value: objectValue(config.values.desktop).dataDir, baseDir: config.baseDir }
  );
  const dataDirSetting = firstPathSetting(
    envDataDirSetting,
    configuredDataDirSetting
  );
  const dataDir = dataDirSetting ? resolveConfiguredPath(dataDirSetting) : null;
  const configuredDataDir = configuredDataDirSetting ? resolveConfiguredPath(configuredDataDirSetting) : null;
  if (dataDir) {
    fs.mkdirSync(dataDir, { recursive: true });
    app.setPath("userData", dataDir);
    const logsDir = path.join(dataDir, "logs");
    fs.mkdirSync(logsDir, { recursive: true });
    if (typeof app.setAppLogsPath === "function") {
      app.setAppLogsPath(logsDir);
    } else {
      app.setPath("logs", logsDir);
    }
  }

  const backendDataDirSetting = firstPathSetting(
    { value: process.env.SYNCHROPAGE_BACKEND_DATA_DIR, baseDir: process.cwd() },
    { value: config.values.backendDataDir, baseDir: config.baseDir },
    { value: objectValue(config.values.backend).dataDir, baseDir: config.baseDir }
  );
  const backendDataDir = backendDataDirSetting
    ? resolveConfiguredPath(backendDataDirSetting)
    : dataDir
      ? path.join(dataDir, "backend")
      : null;
  if (backendDataDir) fs.mkdirSync(backendDataDir, { recursive: true });

  const oauthStoragePathSetting = firstPathSetting(
    { value: process.env.PDF_AGENT_OPENAI_OAUTH_STORAGE_PATH, baseDir: process.cwd() },
    { value: config.values.oauthStoragePath, baseDir: config.baseDir },
    { value: objectValue(config.values.backend).oauthStoragePath, baseDir: config.baseDir }
  );
  const oauthStoragePath = oauthStoragePathSetting
    ? resolveConfiguredPath(oauthStoragePathSetting)
    : backendDataDir
      ? path.join(backendDataDir, "openai_oauth.json")
      : null;

  return {
    dataDir,
    configuredDataDir,
    dataDirManagedByEnv: Boolean(envDataDirSetting),
    backendDataDir,
    oauthStoragePath,
    oauthStoragePathExplicit: Boolean(oauthStoragePathSetting),
    configPath: config.path,
    configValues: config.values
  };
}

function readDesktopConfig() {
  const configPathSetting = firstPathSetting(
    { value: process.env.SYNCHROPAGE_DESKTOP_CONFIG, baseDir: process.cwd() }
  );
  const configPath = configPathSetting ? resolveConfiguredPath(configPathSetting) : defaultDesktopConfigPath();
  if (!fs.existsSync(configPath)) {
    return { values: {}, baseDir: path.dirname(configPath), path: configPath };
  }

  const raw = fs.readFileSync(configPath, "utf8");
  const parsed = JSON.parse(raw);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`SynchroPage desktop config must be a JSON object: ${configPath}`);
  }
  return { values: parsed, baseDir: path.dirname(configPath), path: configPath };
}

function defaultDesktopConfigPath() {
  return path.join(defaultUserDataPath(), "desktop-config.json");
}

function registerDesktopIpcHandlers() {
  ipcMain.handle("synchropage:storage-config:get", () => desktopStorageConfigPayload());
  ipcMain.handle("synchropage:storage-config:choose-data-dir", async () => {
    const options = {
      title: "Choose SynchroPage data folder",
      defaultPath: desktopRuntime.configuredDataDir || desktopRuntime.dataDir || app.getPath("userData"),
      properties: ["openDirectory", "createDirectory"],
      securityScopedBookmarks: true
    };
    const result = mainWindow ? await dialog.showOpenDialog(mainWindow, options) : await dialog.showOpenDialog(options);
    if (result.canceled || !result.filePaths[0]) {
      return desktopStorageConfigPayload({ canceled: true });
    }
    const nextDataDir = path.resolve(result.filePaths[0]);
    saveDesktopConfig({ ...desktopRuntime.configValues, dataDir: nextDataDir });
    desktopRuntime.configuredDataDir = nextDataDir;
    desktopRuntime.dataDirManagedByEnv = Boolean(process.env.SYNCHROPAGE_DESKTOP_DATA_DIR);
    return desktopStorageConfigPayload();
  });
  ipcMain.handle("synchropage:storage-config:reset-data-dir", () => {
    const nextValues = { ...desktopRuntime.configValues };
    delete nextValues.dataDir;
    if (objectValue(nextValues.desktop).dataDir) {
      nextValues.desktop = { ...nextValues.desktop };
      delete nextValues.desktop.dataDir;
    }
    saveDesktopConfig(nextValues);
    desktopRuntime.configuredDataDir = null;
    desktopRuntime.dataDirManagedByEnv = Boolean(process.env.SYNCHROPAGE_DESKTOP_DATA_DIR);
    return desktopStorageConfigPayload();
  });
  ipcMain.handle("synchropage:storage-config:restart", () => {
    app.relaunch();
    app.quit();
    return { ok: true };
  });
}

function saveDesktopConfig(values) {
  const configPath = desktopRuntime.configPath || defaultDesktopConfigPath();
  const normalized = pruneEmptyObjects(values);
  const content = `${JSON.stringify(normalized, null, 2)}\n`;
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  const tmpPath = path.join(path.dirname(configPath), `${path.basename(configPath)}.tmp.${Date.now()}`);
  fs.writeFileSync(tmpPath, content, "utf8");
  fs.renameSync(tmpPath, configPath);
  desktopRuntime.configPath = configPath;
  desktopRuntime.configValues = normalized;
}

function pruneEmptyObjects(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const output = {};
  for (const [key, child] of Object.entries(value)) {
    if (child && typeof child === "object" && !Array.isArray(child)) {
      const pruned = pruneEmptyObjects(child);
      if (Object.keys(pruned).length) output[key] = pruned;
    } else if (child !== undefined) {
      output[key] = child;
    }
  }
  return output;
}

function desktopStorageConfigPayload(extra = {}) {
  const currentDataDir = app.isReady() ? app.getPath("userData") : desktopRuntime.dataDir;
  const configuredDataDir = desktopRuntime.configuredDataDir;
  const desiredDataDir = desktopRuntime.dataDirManagedByEnv
    ? desktopRuntime.dataDir
    : configuredDataDir || defaultUserDataPath();
  const pendingDataDir = desiredDataDir && currentDataDir && path.resolve(desiredDataDir) !== path.resolve(currentDataDir)
    ? desiredDataDir
    : null;
  return {
    available: true,
    currentDataDir: currentDataDir || null,
    configuredDataDir,
    pendingDataDir,
    backendDataDir: desktopRuntime.backendDataDir,
    oauthStoragePath: desktopRuntime.oauthStoragePath,
    configPath: desktopRuntime.configPath,
    dataDirManagedByEnv: desktopRuntime.dataDirManagedByEnv,
    restartRequired: Boolean(pendingDataDir),
    ...extra
  };
}

function defaultUserDataPath() {
  if (process.platform === "darwin") {
    return path.join(os.homedir(), "Library", "Application Support", "SynchroPage");
  }
  if (process.platform === "win32") {
    return path.join(process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming"), "SynchroPage");
  }
  return path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config"), "SynchroPage");
}

function firstPathSetting(...settings) {
  for (const setting of settings) {
    if (setting && typeof setting.value === "string" && setting.value.trim()) {
      return { value: setting.value.trim(), baseDir: setting.baseDir };
    }
  }
  return null;
}

function resolveConfiguredPath(setting) {
  const expanded = expandEnvVars(expandHome(setting.value));
  return path.resolve(setting.baseDir || process.cwd(), expanded);
}

function expandHome(value) {
  if (value === "~") return os.homedir();
  if (value.startsWith("~/") || value.startsWith("~\\")) {
    return path.join(os.homedir(), value.slice(2));
  }
  return value;
}

function expandEnvVars(value) {
  return value.replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}|\$([A-Za-z_][A-Za-z0-9_]*)/g, (match, braced, bare) => {
    const name = braced || bare;
    return process.env[name] || match;
  });
}

function objectValue(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function ensureBuiltWebRoot(webRoot) {
  if (fs.existsSync(path.join(webRoot, "index.html"))) return;
  throw new Error(`Built web UI not found at ${webRoot}. Run \`npm --prefix apps/web run build\` first.`);
}

async function waitForBackend(port) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < BACKEND_START_TIMEOUT_MS) {
    if (backendProcess?.exitCode !== null && backendProcess?.exitCode !== undefined) break;
    const health = await getBackendHealth(port);
    if (health.ok) return;
    await delay(BACKEND_HEALTH_POLL_INTERVAL_MS);
  }
  throw new Error(`SynchroPage backend did not become healthy on ${HOST}:${port}. See ${getBackendLogPath()} for details.`);
}

function getBackendHealth(port) {
  return new Promise((resolve) => {
    const request = http.get(
      {
        host: HOST,
        port,
        path: "/api/health",
        timeout: 1000
      },
      (response) => {
        let body = "";
        response.setEncoding("utf8");
        response.on("data", (chunk) => {
          body += chunk;
        });
        response.on("end", () => {
          try {
            const parsed = JSON.parse(body);
            resolve({ ok: response.statusCode === 200 && parsed?.service === "pdf-agent" });
          } catch {
            resolve({ ok: false });
          }
        });
      }
    );
    request.on("timeout", () => {
      request.destroy();
      resolve({ ok: false });
    });
    request.on("error", () => resolve({ ok: false }));
  });
}

function isPortOccupied(port) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host: HOST, port });
    socket.setTimeout(500);
    socket.on("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.on("timeout", () => {
      socket.destroy();
      resolve(false);
    });
    socket.on("error", () => resolve(false));
  });
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function logStartupMetric(label, detail = {}) {
  if (!STARTUP_METRICS_ENABLED) return;
  const elapsedMs = Date.now() - STARTUP_STARTED_AT;
  console.error(JSON.stringify({
    type: "synchropage-startup-metric",
    label,
    elapsedMs,
    ...detail
  }));
}

function getBackendLogPath() {
  if (backendLogPath) return backendLogPath;
  const logDir = app.getPath("logs");
  fs.mkdirSync(logDir, { recursive: true });
  backendLogPath = path.join(logDir, "backend.log");
  return backendLogPath;
}

function appendBackendLog(value) {
  const text = Buffer.isBuffer(value) ? value.toString("utf8") : String(value);
  const line = `[${new Date().toISOString()}] ${text}`;
  fs.appendFile(getBackendLogPath(), line, () => {});
}
