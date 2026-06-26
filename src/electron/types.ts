export type TaskStatus = "queued" | "waiting" | "running" | "completed" | "failed" | "paused";

export interface Task {
  id: string;
  projectDir: string;
  requirementPath: string;
  requirementName: string;
  status: TaskStatus;
  createdAt: string;
  updatedAt: string;
  attempts: number;
  lastAttemptAt?: string;
  nextAttemptAt?: string;
  completedAt?: string;
  summaryPath?: string;
  lastMessage?: string;
  lastOutput?: string;
  pid?: number;
}

export interface AppSettings {
  retryIntervalMs: number;
  maxParallel: number;
}

export interface AppState {
  tasks: Task[];
  settings: AppSettings;
}

export interface ManagedFile {
  taskId: string;
  path: string;
  name: string;
  kind: "summary" | "output";
  bytes: number;
  modifiedAt: string;
}

export interface RuntimeSnapshot {
  tasks: Task[];
  managedFiles: ManagedFile[];
  settings: AppSettings;
  storagePath: string;
}
