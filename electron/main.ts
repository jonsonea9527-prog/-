import path from "node:path";
import { app, BrowserWindow, dialog, shell } from "electron";
import { startDesktopServerWithFallback, type DesktopServerProcess } from "../src/desktop/serverProcess.ts";
import {
  getDesktopProcessCwd,
  getDesktopServerEntryPath,
  getDesktopUserDataDir
} from "../src/desktop/runtimePaths.ts";

const desktopPort = 3000;

let mainWindow: BrowserWindow | null = null;
let serverProcess: DesktopServerProcess | null = null;

function createWindow(url: string) {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 920,
    minWidth: 1100,
    minHeight: 760,
    backgroundColor: "#0b1020",
    webPreferences: {
      contextIsolation: true,
      sandbox: true
    }
  });

  mainWindow.webContents.setWindowOpenHandler(({ url: targetUrl }) => {
    void shell.openExternal(targetUrl);
    return { action: "deny" };
  });

  mainWindow.webContents.on("will-navigate", (event, targetUrl) => {
    if (targetUrl !== mainWindow?.webContents.getURL()) {
      event.preventDefault();
      void shell.openExternal(targetUrl);
    }
  });

  void mainWindow.loadURL(url);
  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

async function showStartupError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  await dialog.showErrorBox("启动失败", `桌面程序未能成功启动内部服务：\n${message}`);
}

async function startDesktopApp() {
  const appPath = app.getAppPath();
  const cwd = getDesktopProcessCwd({
    isPackaged: app.isPackaged,
    appPath
  });
  const dataDir = getDesktopUserDataDir({
    isPackaged: app.isPackaged,
    cwd,
    userDataPath: app.getPath("userData")
  });
  const serverEntryPath = getDesktopServerEntryPath({
    isPackaged: app.isPackaged,
    appPath
  });

  try {
    serverProcess = await startDesktopServerWithFallback({
      cwd,
      dataDir,
      isPackaged: app.isPackaged,
      port: desktopPort,
      appRoot: appPath,
      serverEntryPath
    });

    const url = await serverProcess.readyUrl;
    createWindow(url);
  } catch (error) {
    await serverProcess?.stop().catch(() => undefined);
    serverProcess = null;
    await showStartupError(error);
    app.quit();
  }
}

app.whenReady().then(() => {
  void startDesktopApp().catch(async (error) => {
    await showStartupError(error);
    app.quit();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("before-quit", async () => {
  if (serverProcess) {
    await serverProcess.stop().catch(() => undefined);
    serverProcess = null;
  }
});

app.on("activate", () => {
  if (!mainWindow && serverProcess) {
    void serverProcess.readyUrl.then((url) => {
      if (!mainWindow) {
        createWindow(url);
      }
    });
  }
});
