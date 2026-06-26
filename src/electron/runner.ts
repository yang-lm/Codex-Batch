import { BrowserWindow } from "electron";
import { spawn, ChildProcessWithoutNullStreams } from "node:child_process";
import fs from "node:fs";
import dns from "node:dns/promises";
import path from "node:path";
import { Store } from "./store";
import { RuntimeSnapshot, Task } from "./types";

const NETWORK_HOSTS = ["api.openai.com", "chatgpt.com", "github.com"];

export class Runner {
  private readonly children = new Map<string, ChildProcessWithoutNullStreams>();
  private timer?: NodeJS.Timeout;

  constructor(
    private readonly store: Store,
    private getWindow: () => BrowserWindow | undefined
  ) {}

  start() {
    this.recoverInterruptedTasks();
    this.schedule(500);
  }

  stopAll() {
    if (this.timer) {
      clearTimeout(this.timer);
    }
    for (const child of this.children.values()) {
      child.kill();
    }
    this.children.clear();
  }

  enqueue(projectDir: string, requirementPath: string) {
    const now = new Date().toISOString();
    const task: Task = {
      id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
      projectDir,
      requirementPath,
      requirementName: path.basename(requirementPath),
      status: "queued",
      createdAt: now,
      updatedAt: now,
      attempts: 0
    };
    this.store.upsertTask(task);
    this.emit();
    this.schedule(100);
    return task;
  }

  retry(taskId: string) {
    const task = this.findTask(taskId);
    if (!task || task.status === "running") {
      return;
    }
    task.status = "queued";
    task.nextAttemptAt = undefined;
    task.lastMessage = undefined;
    task.updatedAt = new Date().toISOString();
    this.store.upsertTask(task);
    this.emit();
    this.schedule(100);
  }

  pause(taskId: string) {
    const task = this.findTask(taskId);
    if (!task) {
      return;
    }
    const child = this.children.get(taskId);
    if (child) {
      child.kill();
      this.children.delete(taskId);
    }
    task.status = "paused";
    task.pid = undefined;
    task.updatedAt = new Date().toISOString();
    this.store.upsertTask(task);
    this.emit();
  }

  remove(taskId: string) {
    const child = this.children.get(taskId);
    if (child) {
      child.kill();
      this.children.delete(taskId);
    }
    this.store.removeTask(taskId);
    this.emit();
  }

  snapshot(): RuntimeSnapshot {
    return {
      ...this.store.snapshot(),
      managedFiles: this.store.listManagedFiles(),
      storagePath: this.store.storagePath
    };
  }

  private async tick() {
    const running = this.store.tasks().filter((task) => task.status === "running").length;
    const slots = Math.max(0, this.store.snapshot().settings.maxParallel - running);
    if (slots === 0) {
      this.schedule();
      return;
    }

    const now = Date.now();
    const ready = this.store
      .tasks()
      .filter((task) => task.status === "queued" || (task.status === "waiting" && (!task.nextAttemptAt || Date.parse(task.nextAttemptAt) <= now)))
      .slice(0, slots);

    if (ready.length === 0) {
      this.schedule();
      return;
    }

    const online = await this.hasNetwork();
    if (!online) {
      for (const task of ready) {
        this.markWaiting(task, "网络不可用，等待 2 分钟后重试。");
      }
      this.schedule();
      return;
    }

    for (const task of ready) {
      this.runTask(task);
    }
    this.schedule();
  }

  private runTask(task: Task) {
    const now = new Date().toISOString();
    const summaryPath = this.buildSummaryPath(task.requirementPath);
    const outputPath = this.buildOutputPath(task.requirementPath);
    const prompt = this.buildPrompt(task.requirementPath, summaryPath);

    task.status = "running";
    task.attempts += 1;
    task.lastAttemptAt = now;
    task.nextAttemptAt = undefined;
    task.summaryPath = summaryPath;
    task.lastOutput = outputPath;
    task.updatedAt = now;
    this.store.upsertTask(task);
    this.emit();

    const child = spawn(
      "codex",
      [
        "exec",
        "--cd",
        task.projectDir,
        "--skip-git-repo-check",
        "--sandbox",
        "workspace-write",
        "--ask-for-approval",
        "never",
        "--ephemeral",
        "--color",
        "never",
        "--output-last-message",
        summaryPath,
        "-"
      ],
      {
        cwd: task.projectDir,
        env: this.buildChildEnv()
      }
    );

    task.pid = child.pid;
    this.store.upsertTask(task);
    this.children.set(task.id, child);

    const outputStream = fs.createWriteStream(outputPath, { flags: "a" });
    outputStream.write(`Started: ${now}\nProject: ${task.projectDir}\nRequirement: ${task.requirementPath}\n\n`);
    child.stdout.pipe(outputStream, { end: false });
    child.stderr.pipe(outputStream, { end: false });
    child.stdin.write(prompt);
    child.stdin.end();

    child.on("error", (error) => {
      outputStream.write(`\nProcess error: ${error.message}\n`);
    });

    child.on("close", (code) => {
      outputStream.write(`\nFinished: ${new Date().toISOString()}\nExit code: ${code ?? "unknown"}\n`);
      outputStream.end();
      this.children.delete(task.id);
      const current = this.findTask(task.id);
      if (!current || current.status === "paused") {
        this.emit();
        return;
      }
      current.pid = undefined;
      current.updatedAt = new Date().toISOString();

      if (code === 0) {
        current.status = "completed";
        current.completedAt = current.updatedAt;
        current.lastMessage = "已完成，Codex 总结已保存。";
      } else if (this.isRetryableOutput(outputPath)) {
        this.markWaiting(current, "Codex 暂不可用或额度不足，等待 2 分钟后重试。");
        return;
      } else {
        current.status = "failed";
        current.lastMessage = `执行失败，退出码 ${code ?? "unknown"}。`;
      }

      this.store.upsertTask(current);
      this.emit();
      this.schedule(500);
    });
  }

  private buildPrompt(requirementPath: string, summaryPath: string) {
    const requirement = fs.readFileSync(requirementPath, "utf8");
    return [
      "请分析并完成下面需求文档中的项目需求。",
      "你需要直接在当前项目目录中实现、验证并在最终回复中给出简洁总结。",
      `最终总结会由 Codex Batch 保存到: ${summaryPath}`,
      "需求文档内容如下:",
      "",
      requirement
    ].join("\n");
  }

  private buildSummaryPath(requirementPath: string) {
    const parsed = path.parse(requirementPath);
    return path.join(parsed.dir, `${parsed.name}.codex-summary.md`);
  }

  private buildOutputPath(requirementPath: string) {
    const parsed = path.parse(requirementPath);
    return path.join(parsed.dir, `${parsed.name}.codex-output.log`);
  }

  private markWaiting(task: Task, message: string) {
    task.status = "waiting";
    task.pid = undefined;
    task.lastMessage = message;
    task.nextAttemptAt = new Date(Date.now() + this.store.snapshot().settings.retryIntervalMs).toISOString();
    task.updatedAt = new Date().toISOString();
    this.store.upsertTask(task);
    this.emit();
  }

  private isRetryableOutput(outputPath: string) {
    try {
      const output = fs.readFileSync(outputPath, "utf8").toLowerCase();
      return [
        "rate limit",
        "quota",
        "insufficient_quota",
        "too many requests",
        "429",
        "network",
        "timeout",
        "timed out",
        "econnreset",
        "enotfound",
        "authentication",
        "unauthorized",
        "login",
        "token",
        "read-only sandbox",
        "writing is blocked by read-only sandbox"
      ].some((marker) => output.includes(marker));
    } catch {
      return true;
    }
  }

  private async hasNetwork() {
    for (const host of NETWORK_HOSTS) {
      try {
        await dns.lookup(host);
        return true;
      } catch {
        continue;
      }
    }
    return false;
  }

  private buildChildEnv() {
    const extraPaths =
      process.platform === "win32"
        ? []
        : ["/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", "/bin", `${process.env.HOME ?? ""}/.local/bin`].filter(Boolean);
    return {
      ...process.env,
      PATH: [...extraPaths, process.env.PATH ?? ""].join(path.delimiter)
    };
  }

  private schedule(delay = this.store.snapshot().settings.retryIntervalMs) {
    if (this.timer) {
      clearTimeout(this.timer);
    }
    this.timer = setTimeout(() => {
      void this.tick();
    }, delay);
  }

  private findTask(taskId: string) {
    return this.store.tasks().find((task) => task.id === taskId);
  }

  private emit() {
    this.getWindow()?.webContents.send("snapshot", this.snapshot());
  }

  private recoverInterruptedTasks() {
    for (const task of this.store.tasks()) {
      if (task.status === "running") {
        task.status = "waiting";
        task.pid = undefined;
        task.lastMessage = "应用上次退出时任务仍在运行，已排队等待重试。";
        task.nextAttemptAt = new Date(Date.now() + 3_000).toISOString();
        task.updatedAt = new Date().toISOString();
        this.store.upsertTask(task);
      }
    }
  }
}
