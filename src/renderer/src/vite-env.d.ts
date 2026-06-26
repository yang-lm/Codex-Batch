/// <reference types="vite/client" />

import type { AppSettings, RuntimeSnapshot } from "../../electron/types";

declare global {
  interface Window {
    codexBatch: {
      getSnapshot: () => Promise<RuntimeSnapshot>;
      selectProject: () => Promise<string | undefined>;
      selectRequirement: () => Promise<string | undefined>;
      addTask: (projectDir: string, requirementPath: string) => Promise<void>;
      retryTask: (taskId: string) => Promise<void>;
      pauseTask: (taskId: string) => Promise<void>;
      removeTask: (taskId: string) => Promise<void>;
      revealPath: (targetPath: string) => Promise<void>;
      deleteFile: (targetPath: string) => Promise<RuntimeSnapshot>;
      updateSettings: (settings: Partial<AppSettings>) => Promise<RuntimeSnapshot>;
      onSnapshot: (callback: (snapshot: RuntimeSnapshot) => void) => () => void;
    };
  }
}
