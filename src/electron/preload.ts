import { contextBridge, ipcRenderer } from "electron";
import { AppSettings, RuntimeSnapshot } from "./types";

contextBridge.exposeInMainWorld("codexBatch", {
  getSnapshot: (): Promise<RuntimeSnapshot> => ipcRenderer.invoke("snapshot:get"),
  selectProject: (): Promise<string | undefined> => ipcRenderer.invoke("dialog:project"),
  selectRequirement: (): Promise<string | undefined> => ipcRenderer.invoke("dialog:requirement"),
  addTask: (projectDir: string, requirementPath: string) => ipcRenderer.invoke("task:add", projectDir, requirementPath),
  retryTask: (taskId: string) => ipcRenderer.invoke("task:retry", taskId),
  pauseTask: (taskId: string) => ipcRenderer.invoke("task:pause", taskId),
  removeTask: (taskId: string) => ipcRenderer.invoke("task:remove", taskId),
  revealPath: (targetPath: string) => ipcRenderer.invoke("path:reveal", targetPath),
  deleteFile: (targetPath: string) => ipcRenderer.invoke("file:delete", targetPath),
  updateSettings: (settings: Partial<AppSettings>) => ipcRenderer.invoke("settings:update", settings),
  onSnapshot: (callback: (snapshot: RuntimeSnapshot) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, snapshot: RuntimeSnapshot) => callback(snapshot);
    ipcRenderer.on("snapshot", listener);
    return () => ipcRenderer.removeListener("snapshot", listener);
  }
});
