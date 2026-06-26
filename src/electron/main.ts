import { app, BrowserWindow, dialog, ipcMain, shell } from "electron";
import fs from "node:fs/promises";
import path from "node:path";
import { Runner } from "./runner";
import { Store } from "./store";
import { AppSettings } from "./types";

let mainWindow: BrowserWindow | undefined;
let runner: Runner;
let store: Store;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1180,
    height: 780,
    minWidth: 960,
    minHeight: 640,
    title: "Codex Batch",
    backgroundColor: "#f7f3ed",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  if (!app.isPackaged && process.env.CODEX_BATCH_DEV_SERVER === "1") {
    void mainWindow.loadURL("http://127.0.0.1:5173");
  } else {
    void mainWindow.loadFile(path.join(__dirname, "../dist/index.html"));
  }

  mainWindow.on("closed", () => {
    mainWindow = undefined;
  });
}

function registerIpc() {
  ipcMain.handle("snapshot:get", () => runner.snapshot());

  ipcMain.handle("dialog:project", async () => {
    const result = await dialog.showOpenDialog(mainWindow!, {
      title: "选择项目目录",
      properties: ["openDirectory", "createDirectory"]
    });
    return result.canceled ? undefined : result.filePaths[0];
  });

  ipcMain.handle("dialog:requirement", async () => {
    const result = await dialog.showOpenDialog(mainWindow!, {
      title: "选择需求 Markdown 文档",
      properties: ["openFile"],
      filters: [{ name: "Markdown", extensions: ["md", "markdown"] }]
    });
    return result.canceled ? undefined : result.filePaths[0];
  });

  ipcMain.handle("task:add", async (_event, projectDir: string, requirementPath: string) => {
    if (!projectDir || !requirementPath) {
      throw new Error("需要选择项目目录和需求文档。");
    }
    const [projectStat, requirementStat] = await Promise.all([fs.stat(projectDir), fs.stat(requirementPath)]);
    if (!projectStat.isDirectory()) {
      throw new Error("项目路径不是目录。");
    }
    if (!requirementStat.isFile()) {
      throw new Error("需求文档不是文件。");
    }
    return runner.enqueue(projectDir, requirementPath);
  });

  ipcMain.handle("task:retry", (_event, taskId: string) => runner.retry(taskId));
  ipcMain.handle("task:pause", (_event, taskId: string) => runner.pause(taskId));
  ipcMain.handle("task:remove", (_event, taskId: string) => runner.remove(taskId));

  ipcMain.handle("path:reveal", async (_event, targetPath: string) => {
    shell.showItemInFolder(targetPath);
  });

  ipcMain.handle("file:delete", async (_event, targetPath: string) => {
    await fs.unlink(targetPath);
    return runner.snapshot();
  });

  ipcMain.handle("settings:update", (_event, settings: Partial<AppSettings>) => {
    const next: Partial<AppSettings> = {};
    if (typeof settings.maxParallel === "number") {
      next.maxParallel = Math.min(8, Math.max(1, Math.floor(settings.maxParallel)));
    }
    if (typeof settings.retryIntervalMs === "number") {
      next.retryIntervalMs = Math.min(900_000, Math.max(30_000, Math.floor(settings.retryIntervalMs)));
    }
    store.updateSettings(next);
    return runner.snapshot();
  });
}

app.whenReady().then(() => {
  store = new Store();
  store.load();
  runner = new Runner(store, () => mainWindow);
  registerIpc();
  createWindow();
  runner.start();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on("before-quit", () => {
  runner?.stopAll();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
