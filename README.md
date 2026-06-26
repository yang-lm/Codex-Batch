# Codex Batch

Codex Batch 是一个跨平台桌面软件，用来把多个项目的需求文档排队交给本机 Codex CLI 执行。它不会要求用户单独填写 API key 或访问地址，而是复用当前系统里已经登录和配置好的 `codex`。

<img width="1180" height="780" alt="image" src="https://github.com/user-attachments/assets/98738bbb-2fea-4a02-b787-45434137424b" />



## 适用场景

- 公司统一分发 Codex 配置或 API key，但用户不知道额度什么时候恢复。
- 多个项目都有需求文档，希望网络或额度恢复后自动继续执行。
- 希望 Codex 的最终总结和执行输出保存在需求文档同级目录，便于追踪。

## 核心功能

- 桌面应用，支持 macOS 和 Windows 打包。
- 选择项目目录和 `.md` 需求文档后加入队列。
- 支持多个项目并行执行，默认并行数为 3，可在界面调整。
- 断网、认证异常、额度不足、429、超时等可重试错误会进入等待状态。
- 等待任务每 2 分钟自动尝试一次。
- 不内置数据库，任务状态只保存到本机 JSON 文件。
- 生成文件管理窗口可查看和删除 Codex 总结与输出文件。
- Codex 最终总结保存为 `需求文件名.codex-summary.md`。
- Codex 原始输出保存为 `需求文件名.codex-output.log`。

## 环境要求

1. 安装 Node.js 20 或更高版本。
2. 安装并登录 Codex CLI。
3. 确保终端里可以执行：

```bash
codex --version
codex exec --help
```

Codex Batch 不保存 API key，也不提供 API key 配置入口。额度、模型、访问地址、认证信息都由本机 Codex CLI 自己读取。

## 本地运行

```bash
npm install
npm run dev
```

开发模式会启动 Vite、编译 Electron 主进程，并打开桌面窗口。

## 构建与打包

`npm run build` 只生成运行所需的 `dist/` 和 `dist-electron/`，不会生成 DMG 或 NSIS 安装包。

```bash
npm run build
```

生成安装包使用：

```bash
npm run dist
```

构建产物会输出到 `release/`。

macOS 默认生成 DMG，Windows 默认生成 NSIS 安装包。

也可以按平台单独打包：

```bash
npm run dist:mac
npm run dist:win
```

## 使用流程

1. 打开 Codex Batch。
2. 点击“项目目录”，选择 Codex 要修改的项目根目录。
3. 点击“需求文档”，选择写有需求的 Markdown 文件。
4. 点击“加入队列”。
5. 任务会自动检测网络并调用：

```bash
codex exec --cd <项目目录> --skip-git-repo-check --ephemeral --output-last-message <总结文件> -
```

实际执行时会显式添加 `--sandbox workspace-write --ask-for-approval never`，确保自动任务可以修改所选项目目录内的文件，不会继承用户 Codex 配置里的只读沙箱。

6. 如果网络不可用或 Codex 暂时没有额度，任务会显示为“等待重试”，并在 2 分钟后自动尝试。
7. 任务完成后，在“文件”页可以显示或删除生成文件。

## 文件位置

每个任务的生成文件都放在需求文档同级目录：

- `<需求文档名>.codex-summary.md`：Codex 最终总结。
- `<需求文档名>.codex-output.log`：Codex 执行过程输出，主要用于排查失败原因。

应用自身状态文件保存在 Electron 的 userData 目录中，界面只暴露生成文件管理，不会在项目内创建数据库或缓存目录。

## 重试策略

以下情况会进入等待并自动重试：

- DNS 检测无法访问常用网络主机。
- Codex 输出中包含 `rate limit`、`quota`、`429`、`network`、`timeout`、`authentication`、`login`、`token` 等可恢复错误标记。
- 如果旧任务因 `read-only sandbox` 写入失败，更新后手动重试即可使用可写沙箱重新执行。
- 应用退出时有任务正在运行，下次启动会恢复为等待重试。

不可识别的非零退出会标记为失败。用户可以在任务列表中手动重试。

## 数据与隐私

- 不使用数据库。
- 不上传任务列表到第三方服务。
- 不读取或保存 API key。
- 需求文档内容只会传给本机 `codex exec` 子进程。
- 任务队列保存在本机应用数据目录的 `state.json`。

## 常见问题

### 为什么不提供 API key 输入框？

需求要求自动读取系统中已有 Codex 信息。Codex Batch 只调用本机 `codex` 命令，认证和配置都由 Codex CLI 管理。

### 为什么任务一直等待？

通常是网络不可用、Codex 未登录、额度不足或服务返回限流。可以打开对应 `.codex-output.log` 查看原始错误。

### 可以同时跑多少个项目？

默认 3 个。界面左侧可以调整为 1 到 8 个。并行数越高，对 Codex 额度和本机资源压力越大。

### 需求文档应该怎么写？

直接用 Markdown 写清楚目标、验收标准、技术约束和需要修改的项目范围。Codex Batch 会把整份文档作为 `codex exec` 的输入。
