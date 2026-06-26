import React, { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  Archive,
  CheckCircle2,
  Clock3,
  FileText,
  FolderOpen,
  Loader2,
  Pause,
  Play,
  Plus,
  RotateCcw,
  Settings,
  Trash2,
  WifiOff
} from "lucide-react";
import type { ManagedFile, RuntimeSnapshot, Task, TaskStatus } from "../../electron/types";
import "./styles.css";

const initialSnapshot: RuntimeSnapshot = {
  tasks: [],
  managedFiles: [],
  settings: { retryIntervalMs: 120_000, maxParallel: 3 },
  storagePath: ""
};

const statusMeta: Record<TaskStatus, { label: string; className: string; icon: React.ReactNode }> = {
  queued: { label: "排队中", className: "queued", icon: <Clock3 size={16} /> },
  waiting: { label: "等待重试", className: "waiting", icon: <WifiOff size={16} /> },
  running: { label: "执行中", className: "running", icon: <Loader2 size={16} className="spin" /> },
  completed: { label: "已完成", className: "completed", icon: <CheckCircle2 size={16} /> },
  failed: { label: "失败", className: "failed", icon: <Archive size={16} /> },
  paused: { label: "已暂停", className: "paused", icon: <Pause size={16} /> }
};

function App() {
  const [snapshot, setSnapshot] = useState(initialSnapshot);
  const [projectDir, setProjectDir] = useState("");
  const [requirementPath, setRequirementPath] = useState("");
  const [message, setMessage] = useState("");
  const [activeView, setActiveView] = useState<"tasks" | "files">("tasks");

  useEffect(() => {
    void window.codexBatch.getSnapshot().then(setSnapshot);
    return window.codexBatch.onSnapshot(setSnapshot);
  }, []);

  const counts = useMemo(() => {
    return snapshot.tasks.reduce(
      (acc, task) => {
        acc[task.status] += 1;
        return acc;
      },
      { queued: 0, waiting: 0, running: 0, completed: 0, failed: 0, paused: 0 } as Record<TaskStatus, number>
    );
  }, [snapshot.tasks]);

  async function chooseProject() {
    const selected = await window.codexBatch.selectProject();
    if (selected) {
      setProjectDir(selected);
    }
  }

  async function chooseRequirement() {
    const selected = await window.codexBatch.selectRequirement();
    if (selected) {
      setRequirementPath(selected);
    }
  }

  async function addTask() {
    setMessage("");
    try {
      await window.codexBatch.addTask(projectDir, requirementPath);
      setRequirementPath("");
      setMessage("任务已加入队列。");
      setSnapshot(await window.codexBatch.getSnapshot());
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "添加任务失败。");
    }
  }

  async function updateParallel(value: number) {
    const next = await window.codexBatch.updateSettings({ maxParallel: value });
    setSnapshot(next);
  }

  async function deleteFile(file: ManagedFile) {
    const next = await window.codexBatch.deleteFile(file.path);
    setSnapshot(next);
  }

  return (
    <main className="app-shell">
      <section className="topbar">
        <div>
          <h1>Codex Batch</h1>
          <p>选择项目和需求文档，等待网络与 Codex 额度可用后自动执行。</p>
        </div>
        <div className="status-strip" aria-label="任务统计">
          <Stat label="执行中" value={counts.running} />
          <Stat label="等待" value={counts.waiting + counts.queued} />
          <Stat label="完成" value={counts.completed} />
        </div>
      </section>

      <section className="creator">
        <div className="field">
          <label>项目目录</label>
          <button className="path-picker" onClick={chooseProject} title="选择项目目录">
            <FolderOpen size={18} />
            <span>{projectDir || "选择 Codex 要修改的项目目录"}</span>
          </button>
        </div>
        <div className="field">
          <label>需求文档</label>
          <button className="path-picker" onClick={chooseRequirement} title="选择需求 Markdown 文档">
            <FileText size={18} />
            <span>{requirementPath || "选择写有需求的 .md 文件"}</span>
          </button>
        </div>
        <button className="primary" onClick={addTask} disabled={!projectDir || !requirementPath} title="加入执行队列">
          <Plus size={18} />
          加入队列
        </button>
      </section>

      {message ? <div className="notice">{message}</div> : null}

      <section className="workspace">
        <aside className="sidebar">
          <button className={activeView === "tasks" ? "nav active" : "nav"} onClick={() => setActiveView("tasks")}>
            <Play size={18} />
            任务
          </button>
          <button className={activeView === "files" ? "nav active" : "nav"} onClick={() => setActiveView("files")}>
            <Archive size={18} />
            文件
          </button>
          <div className="settings-panel">
            <div className="settings-title">
              <Settings size={16} />
              并行数
            </div>
            <input
              type="range"
              min="1"
              max="8"
              value={snapshot.settings.maxParallel}
              onChange={(event) => void updateParallel(Number(event.target.value))}
            />
            <strong>{snapshot.settings.maxParallel}</strong>
            <span>等待间隔固定为 {Math.round(snapshot.settings.retryIntervalMs / 1000)} 秒。</span>
          </div>
        </aside>

        <section className="content">
          {activeView === "tasks" ? <TaskList tasks={snapshot.tasks} /> : <FileList files={snapshot.managedFiles} onDelete={deleteFile} />}
        </section>
      </section>
    </main>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="stat">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function TaskList({ tasks }: { tasks: Task[] }) {
  if (tasks.length === 0) {
    return (
      <div className="empty">
        <FileText size={34} />
        <h2>还没有任务</h2>
        <p>选择项目目录和需求文档后加入队列。</p>
      </div>
    );
  }

  return (
    <div className="task-list">
      {tasks.map((task) => (
        <TaskRow key={task.id} task={task} />
      ))}
    </div>
  );
}

function TaskRow({ task }: { task: Task }) {
  const meta = statusMeta[task.status];
  const nextRetry = task.nextAttemptAt ? new Date(task.nextAttemptAt).toLocaleString() : "";
  return (
    <article className="task-row">
      <div className="task-main">
        <div className={`badge ${meta.className}`}>
          {meta.icon}
          {meta.label}
        </div>
        <h2>{task.requirementName}</h2>
        <p className="path">{task.projectDir}</p>
        <p className="path">{task.requirementPath}</p>
        {task.lastMessage ? <p className="task-message">{task.lastMessage}</p> : null}
        {nextRetry ? <p className="task-message">下次尝试：{nextRetry}</p> : null}
      </div>
      <div className="task-meta">
        <span>尝试 {task.attempts} 次</span>
        <span>{new Date(task.updatedAt).toLocaleString()}</span>
        <div className="actions">
          {task.status === "running" ? (
            <IconButton title="暂停" onClick={() => void window.codexBatch.pauseTask(task.id)} icon={<Pause size={17} />} />
          ) : (
            <IconButton title="重试" onClick={() => void window.codexBatch.retryTask(task.id)} icon={<RotateCcw size={17} />} />
          )}
          {task.summaryPath ? <IconButton title="显示总结" onClick={() => void window.codexBatch.revealPath(task.summaryPath!)} icon={<FileText size={17} />} /> : null}
          <IconButton title="移除任务" onClick={() => void window.codexBatch.removeTask(task.id)} icon={<Trash2 size={17} />} />
        </div>
      </div>
    </article>
  );
}

function FileList({ files, onDelete }: { files: ManagedFile[]; onDelete: (file: ManagedFile) => void }) {
  if (files.length === 0) {
    return (
      <div className="empty">
        <Archive size={34} />
        <h2>暂无生成文件</h2>
        <p>任务完成或失败后，这里会列出总结和输出文件。</p>
      </div>
    );
  }

  return (
    <div className="file-list">
      {files.map((file) => (
        <article className="file-row" key={file.path}>
          <div>
            <div className="file-kind">{file.kind === "summary" ? "总结" : "输出"}</div>
            <h2>{file.name}</h2>
            <p className="path">{file.path}</p>
          </div>
          <div className="task-meta">
            <span>{formatBytes(file.bytes)}</span>
            <span>{new Date(file.modifiedAt).toLocaleString()}</span>
            <div className="actions">
              <IconButton title="显示文件" onClick={() => void window.codexBatch.revealPath(file.path)} icon={<FolderOpen size={17} />} />
              <IconButton title="删除文件" onClick={() => onDelete(file)} icon={<Trash2 size={17} />} />
            </div>
          </div>
        </article>
      ))}
    </div>
  );
}

function IconButton({ title, onClick, icon }: { title: string; onClick: () => void; icon: React.ReactNode }) {
  return (
    <button className="icon-button" onClick={onClick} title={title} aria-label={title}>
      {icon}
    </button>
  );
}

function formatBytes(bytes: number) {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

createRoot(document.getElementById("root")!).render(<App />);
