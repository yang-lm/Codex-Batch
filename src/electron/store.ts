import { app } from "electron";
import fs from "node:fs";
import path from "node:path";
import { AppState, ManagedFile, Task } from "./types";

const defaultState: AppState = {
  tasks: [],
  settings: {
    retryIntervalMs: 120_000,
    maxParallel: 3
  }
};

export class Store {
  private readonly dataDir: string;
  private readonly dataPath: string;
  private state: AppState = structuredClone(defaultState);

  constructor() {
    this.dataDir = app.getPath("userData");
    this.dataPath = path.join(this.dataDir, "state.json");
  }

  get storagePath() {
    return this.dataPath;
  }

  load() {
    fs.mkdirSync(this.dataDir, { recursive: true });
    if (!fs.existsSync(this.dataPath)) {
      this.save();
      return;
    }

    try {
      const parsed = JSON.parse(fs.readFileSync(this.dataPath, "utf8")) as Partial<AppState>;
      this.state = {
        ...structuredClone(defaultState),
        ...parsed,
        settings: {
          ...defaultState.settings,
          ...(parsed.settings ?? {})
        },
        tasks: Array.isArray(parsed.tasks) ? parsed.tasks : []
      };
    } catch {
      const backup = path.join(this.dataDir, `state.corrupt-${Date.now()}.json`);
      fs.renameSync(this.dataPath, backup);
      this.state = structuredClone(defaultState);
      this.save();
    }
  }

  snapshot() {
    return structuredClone(this.state);
  }

  tasks() {
    return this.state.tasks;
  }

  upsertTask(task: Task) {
    const index = this.state.tasks.findIndex((item) => item.id === task.id);
    if (index >= 0) {
      this.state.tasks[index] = task;
    } else {
      this.state.tasks.unshift(task);
    }
    this.save();
  }

  removeTask(taskId: string) {
    this.state.tasks = this.state.tasks.filter((task) => task.id !== taskId);
    this.save();
  }

  updateSettings(settings: Partial<AppState["settings"]>) {
    this.state.settings = {
      ...this.state.settings,
      ...settings
    };
    this.save();
  }

  listManagedFiles(): ManagedFile[] {
    return this.state.tasks.flatMap((task) => {
      const candidates: Array<ManagedFile | undefined> = [
        task.summaryPath ? this.toManagedFile(task, task.summaryPath, "summary") : undefined,
        task.lastOutput ? this.toManagedFile(task, task.lastOutput, "output") : undefined
      ];
      return candidates.filter((file): file is ManagedFile => Boolean(file));
    });
  }

  private toManagedFile(task: Task, filePath: string, kind: ManagedFile["kind"]): ManagedFile | undefined {
    try {
      const stat = fs.statSync(filePath);
      return {
        taskId: task.id,
        path: filePath,
        name: path.basename(filePath),
        kind,
        bytes: stat.size,
        modifiedAt: stat.mtime.toISOString()
      };
    } catch {
      return undefined;
    }
  }

  private save() {
    fs.mkdirSync(this.dataDir, { recursive: true });
    fs.writeFileSync(this.dataPath, JSON.stringify(this.state, null, 2), "utf8");
  }
}
