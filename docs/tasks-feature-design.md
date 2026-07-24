# Tasks（任务 / 自动化）功能方案

> 状态：草案 v1 · 待评审
> 一句话：把「本地命令 → 上传/下载 → 远程命令」这类跨本地/远程的动作，做成**可保存、可复用、可参数化的有序任务**。
> **通用、不限场景**——前端发版（本地打包→上传产物→远程 reload）、线上数据库备份（远程 dump→下载）等都只是同一引擎的不同步骤组合，引擎本身不认识任何具体场景。

---

## 1. 目标与非目标

### 目标

- 用一个**通用原语**覆盖：发布部署、备份下载、日志采集、环境初始化、巡检等场景。
- 复用现有能力：SFTP 传输、SSH 远程执行、snippets 变量系统、sync vault。
- 交互对齐 snippets：列表 + 表单编辑 + 运行弹窗，用户零学习成本。
- **暴露给 AI 助手**：作为一个工具组接入现有助手，让它能列出/运行/管理任务，并沿用既有审批与「结果不可信」防线（详见第 8 节）。

### 非目标（明确不做）

- ❌ 条件分支 / 循环 / 并行 —— 一旦加就变成 CI 引擎。复杂逻辑外包给 shell。
- ❌ YAML / DSL 脚本语法 —— 用表单排步骤。
- ❌ 密钥托管、环境变量仓库、webhook 触发、日志留存/回滚编排。
- ❌ 跨任务依赖。

保持一条线：**线性步骤 + 失败即停 + 变量填空**。

---

## 2. 核心概念

一个 **Task（任务）** = 绑定（或运行时选择）一个目标主机的**有序步骤列表**。每个步骤是四种固定类型之一：

| 步骤类型        | 中文     | 作用             | 复用的现有能力                                    |
| --------------- | -------- | ---------------- | ------------------------------------------------- |
| `localCommand`  | 本地命令 | 在本机跑 shell   | 本地 spawn 已有（`pty/mod.rs`），补一次性捕获模式 |
| `upload`        | 上传     | 本地 → 远程      | 现成 SFTP（`src-tauri/src/sftp/transfer.rs`）     |
| `download`      | 下载     | 远程 → 本地      | 现成 SFTP                                         |
| `remoteCommand` | 远程命令 | 目标主机跑 shell | 现成 SSH exec（`src-tauri/src/ssh/exec.rs`）      |

**执行语义**：从上到下依次执行，任一步非零退出/失败即整体中止（除非该步显式勾选「失败继续」）。全程流式输出，可取消。

**引擎是场景无关的**——它不认识「部署」或「备份」，只认识四种步骤的有序组合。任何具体场景都是这些步骤的排列，因此「覆盖更多场景」= 用户自己排步骤 / 我们多给几个模板，**不需要改引擎**。

**场景即组合**（下列全部由同一引擎跑，无一处特判）：

| 场景               | 步骤组合                                                         |
| ------------------ | ---------------------------------------------------------------- |
| **前端发版**       | `本地 pnpm build` → `上传 dist/` → `远程 systemctl reload nginx` |
| **线上数据库备份** | `远程 pg_dump/mysqldump 打包` → `下载到本地备份目录`             |
| **静态资源发布**   | `本地构建` → `上传` → `远程 CDN 刷新脚本`                        |
| **配置下发**       | `上传配置文件` → `远程 reload 服务`                              |
| **日志采集**       | `远程 tar logs` → `下载` → `本地解压`                            |
| **环境初始化**     | `上传初始化脚本` → `远程执行安装`                                |
| **产物归档**       | `本地打包` → `上传到归档服务器`                                  |

> 想覆盖表外的场景，用户在编辑器里自由排 4 种步骤即可；我们只负责把常用的做成一键模板。

---

## 3. 界面设计（重点：看这里决定怎么调）

> 以下是线框图，用于确认交互形态。尺寸/文案后续再定。

Tasks 是活动栏（Activity Bar）新增的第 6 个入口，与 hosts / credentials / snippets / forwards / monitor 并列。图标建议 lucide 的 `Workflow` 或 `ListChecks`。

### 3.1 侧边栏 · 任务列表

沿用 `SnippetsView` 的形态：搜索框 + 扁平列表 + 每项右键菜单（运行/编辑/复制/删除）。

```
┌ 任务 ───────────────────── + ┐
│ 🔍 搜索任务                  │
├──────────────────────────────┤
│  ▶  发布前端到生产           │
│      构建并部署到 web-01     │
│  ▶  部署 API                 │
│  ▶  备份数据库               │
│  ▶  采集 Nginx 日志          │
└──────────────────────────────┘
   点 ▶ 直接运行 · 点标题打开编辑
```

**待确认 A**：任务是否要分组/文件夹？v1 建议**扁平**（和 snippets 一致），后续再看。

### 3.2 新建任务 · 模板选择

点 `+` 先选起点，降低上手门槛：

```
新建任务
  ○ 空白任务
  ○ 模板：前端发版       本地 build → 上传构建产物 → 远程 reload
  ○ 模板：数据库备份     远程 dump 打包 → 下载到本地
  ○ 模板：配置下发       上传配置 → 远程 reload
  ○ 模板：采集日志       远程打包日志 → 下载 → 本地解压
```

### 3.3 任务编辑弹窗（核心交互）

```
┌ 编辑任务 ─────────────────────────────────────── ✕ ┐
│ 名称   [ 发布前端到生产                      ]      │
│ 说明   [ 构建并部署到 web-01                 ] 可选 │
│ 目标   ● 固定主机 [ web-01 ▾ ]   ○ 运行时选择      │
│                                                     │
│ 步骤                                      [ + 添加 ▾]│
│ ┌───────────────────────────────────────────────┐ │
│ │ ⠿  ①  本地命令                            ✕    │ │
│ │     工作目录 [ ~/proj/web                 ]    │ │
│ │     命令     [ pnpm build                 ]    │ │
│ ├───────────────────────────────────────────────┤ │
│ │ ⠿  ②  上传                                ✕    │ │
│ │     本地 [ ./dist              ]  📁            │ │
│ │     远程 [ /var/www/app        ]               │ │
│ │     ☑ 仅传变化的文件   □ 失败继续              │ │
│ ├───────────────────────────────────────────────┤ │
│ │ ⠿  ③  远程命令                            ✕    │ │
│ │     命令 [ sudo systemctl reload nginx    ]    │ │
│ └───────────────────────────────────────────────┘ │
│                                                     │
│ ⓘ 变量：{{env}} 将在运行时可填                     │
│                              [ 取消 ]  [ 保存 ]     │
└─────────────────────────────────────────────────────┘
```

- `⠿` 拖拽手柄，可重排步骤（复用 `src/lib/pointerDrag.ts` / `dragPreview.ts`）。
- `+ 添加 ▾` 下拉：本地命令 / 上传 / 下载 / 远程命令。
- 每个步骤卡片按类型渲染不同字段；共有开关：`失败继续`。
- 文本框内可写 `{{变量名:默认值}}`，与 snippets 完全一致的语法。

**待确认 B**：命令输入框用单行还是多行 Monaco？snippets 现在是多行文本，建议一致（多行 textarea）。

### 3.4 运行弹窗（流式输出）

沿用 `BatchRunDialog` 的形态，但按步骤分段：

```
┌ 运行：发布前端到生产 ───────────────────────── ✕ ┐
│ 目标主机 [ web-01 ▾ ]                             │
│ 变量  env [ prod                    ]            │
│                               [ 取消 ]  [ 运行 ▶]│
├───────────────────────────────────────────────────┤
│ ①  本地命令  pnpm build                 ✓ 12.3s  │
│      vite v8 building...                          │
│      ✓ built in 11.8s                             │
│ ②  上传  ./dist → /var/www/app          ⟳ 63%    │
│      ▓▓▓▓▓▓▓▓▓░░░░░  128 / 203 文件              │
│ ③  远程命令  systemctl reload nginx     ⏸ 等待   │
├───────────────────────────────────────────────────┤
│ 用时 12.3s · 第 2/3 步              [ 取消运行 ✕ ] │
└───────────────────────────────────────────────────┘
```

- 每步状态：`等待 ⏸ / 运行 ⟳ / 成功 ✓ / 失败 ✗ / 跳过 ⊘`。
- 命令步骤展示滚动日志；上传/下载步骤展示进度条 + 文件计数。
- 失败即停：后续步骤标记为 `未执行`，弹窗保留供排查。

**待确认 C**：运行界面用**弹窗**（简单、和 snippets 一致）还是主编辑区的**标签页**（长任务、大量日志更舒服、可后台）？v1 建议弹窗，后续可升级为可停靠面板。

---

## 4. 数据模型

### 4.1 数据库迁移 `src-tauri/migrations/0012_tasks.sql`

步骤是变长有序列表，用 JSON 列存储（sync vault 只按行做指纹，JSON 列天然兼容）。

```sql
-- 用户自定义的自动化任务：本地/远程命令 + 文件传输的有序组合。
-- 属于 sync vault（跨设备同步）。
CREATE TABLE tasks (
  id          TEXT PRIMARY KEY NOT NULL,
  name        TEXT NOT NULL,
  description TEXT,
  host_id     TEXT,            -- 默认目标主机；NULL = 运行时选择
  steps       TEXT NOT NULL,   -- JSON 数组，见 TaskStep
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL,
  deleted_at  TEXT,            -- 软删除，与 snippets 一致
  revision    INTEGER NOT NULL DEFAULT 1
);

CREATE INDEX idx_tasks_name ON tasks (name COLLATE NOCASE);
```

> `host_id` 不加外键约束（主机可能被删），运行时若目标主机不存在则提示重新选择。

### 4.2 领域模型 `src-tauri/src/domain/task.rs`

对齐 `domain/snippet.rs` 的写法（camelCase、`FromRow`）。步骤用 serde 内部标签枚举：

```rust
use serde::{Deserialize, Serialize};
use sqlx::FromRow;

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct Task {
    pub id: String,
    pub name: String,
    pub description: Option<String>,
    pub host_id: Option<String>,
    pub steps: String,          // 存 JSON；对外反序列化为 Vec<TaskStep>
    pub created_at: String,
    pub updated_at: String,
    pub deleted_at: Option<String>,
    pub revision: i64,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskInput {
    pub name: String,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub host_id: Option<String>,
    pub steps: Vec<TaskStep>,   // 存库前序列化成字符串
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum TaskStep {
    LocalCommand  { #[serde(default)] cwd: Option<String>, command: String, #[serde(default)] continue_on_error: bool },
    Upload        { local_path: String, remote_path: String, #[serde(default)] incremental: bool, #[serde(default)] continue_on_error: bool },
    Download      { remote_path: String, local_path: String, #[serde(default)] continue_on_error: bool },
    RemoteCommand { #[serde(default)] cwd: Option<String>, command: String, #[serde(default)] continue_on_error: bool },
}
```

对应 TS（`src/types/models.ts`）：

```ts
export type TaskStep =
  | {
      type: "localCommand";
      cwd?: string;
      command: string;
      continueOnError?: boolean;
    }
  | {
      type: "upload";
      localPath: string;
      remotePath: string;
      incremental?: boolean;
      continueOnError?: boolean;
    }
  | {
      type: "download";
      remotePath: string;
      localPath: string;
      continueOnError?: boolean;
    }
  | {
      type: "remoteCommand";
      cwd?: string;
      command: string;
      continueOnError?: boolean;
    };

export interface TaskInput {
  name: string;
  description?: string;
  hostId?: string;
  steps: TaskStep[];
}
```

---

## 5. 后端

### 5.0 现状盘点：执行原语已就绪 3.5 / 4（已核对源码）

好消息——四类步骤里三类的执行内核**已经存在**，Tasks 主要新增的是「编排层」，不是从零造轮子。

| 步骤                   | 后端现状                                   | 依据                                                  |
| ---------------------- | ------------------------------------------ | ----------------------------------------------------- |
| **远程命令**           | ✅ 完全支持：流式输出 + 退出码 + 取消      | `ssh/exec.rs`、`commands/batch.rs::hosts_run_command` |
| **上传（含递归目录）** | ✅ 完全支持，且比预期强                    | `sftp/transfer.rs`（见下）                            |
| **下载**               | ✅ 同一引擎，双向（源/目的谁本地即定方向） | `commands/sftp.rs::fs_transfer`                       |
| **本地命令**           | ⚠️ 能力在、模式要补                        | `pty/mod.rs`（portable_pty，已用于本地终端）          |

**上传引擎已白送的能力**（`sftp::transfer`）：

- 递归整目录、保留权限、处理软链；
- 跨网络自动压缩传输（`compress = crosses_network && source_is_dir`）；
- **临时暂存 + 失败清理/回退**（`staged_name` / `cleanup_staged`）——即本方案 P2「原子切换」在传输层**已部分具备**。

**唯一缺口 = 本地命令的「一次性执行」模式**：本地进程 spawn 能力已存在（`portable_pty`，连 Tauri 权限、退出事件、kill 都有），但那是给终端的**交互式 PTY**。任务需要的是「指定 cwd 跑一条命令 → 捕获 stdout/stderr + 退出码 → 非零即停」，这段需新写，但很小（`tokio::process::Command` capture 或复用 portable_pty 等 exit）。

**真正的后端主体 = 编排层**：把上述原语串起来（顺序执行、失败即停、服务端变量替换、把各步输出/进度归一成一条 `TaskRunEvent` 流、`request_id` 统一取消）。这是本功能新增代码的重心，模式照 `batch.rs`。

### 5.1 Repository `src-tauri/src/repository/task_repo.rs`

照抄 `snippet_repo.rs`：`normalize` / `validate_id` / `list` / `get` / `create` / `update` / `delete`（软删除）。额外做：

- 序列化/反序列化 `steps`；
- 逐字段长度上限校验（命令 ≤ 32KB，路径 ≤ 4KB，步骤数 ≤ 50 等）；
- 至少 1 个步骤。

### 5.2 CRUD 命令 `src-tauri/src/commands/tasks.rs`

镜像 `commands/snippets.rs`：`tasks_list / tasks_create / tasks_update / tasks_delete`，在 `src-tauri/src/lib.rs` 的 `generate_handler!` 注册。

### 5.3 运行命令（流式 + 可取消）

复用 `commands/batch.rs` 的 `Channel<Event>` + `request_id` 取消模式：

```rust
#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct TaskRunEvent {
    step_index: usize,
    // "start" | "log" | "progress" | "done" | "error" | "skipped"
    status: String,
    #[serde(skip_serializing_if = "Option::is_none")] chunk: Option<String>,      // 命令输出片段
    #[serde(skip_serializing_if = "Option::is_none")] done_files: Option<u64>,    // 传输进度
    #[serde(skip_serializing_if = "Option::is_none")] total_files: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")] exit_code: Option<i32>,
    #[serde(skip_serializing_if = "Option::is_none")] message: Option<String>,
}

#[tauri::command]
pub async fn tasks_run(
    app: AppHandle,
    state: State<'_, AppState>,
    id: String,
    host_id: String,                 // 运行时最终确定的目标
    variables: HashMap<String, String>,
    request_id: String,
    on_event: Channel<TaskRunEvent>,
) -> AppResult<()> { /* ... */ }

#[tauri::command]
pub async fn tasks_cancel(state: State<'_, AppState>, request_id: String) -> AppResult<()>;
```

**执行流程**：

1. 载入 task，解析 `steps`，对每个命令/路径字段做变量替换（服务端替换，避免前端漏替）。
2. 建立到 `host_id` 的 SSH 会话（复用 `ssh::establish` / `Hop`，含跳板机）。
3. 逐步执行：
   - `localCommand` → `tokio::process::Command`，流式转发 stdout/stderr。
   - `remoteCommand` → `ssh::exec` 流式。
   - `upload` / `download` → `sftp::transfer`，进度回调转成 `TaskRunEvent`。
4. 非零退出/错误 → 若 `continue_on_error` 则标记继续，否则中止并把剩余步骤标 `skipped`。
5. 取消：`request_id` 存入 state 的取消表（参照 `batch_cancels`），中断当前步骤。

### 5.4 命令超时

每个命令步骤沿用 batch 的 5 分钟量级默认超时（可后续做成每步可配）。

---

## 6. 前端结构 `src/features/tasks/`

对齐 snippets 目录：

```
src/features/tasks/
  TasksView.tsx          侧边栏列表（照 SnippetsView）
  TaskFormDialog.tsx     编辑弹窗（步骤构建器）
  TaskRunDialog.tsx      运行弹窗（流式输出）
  TaskStepCard.tsx       单个步骤卡片（按 type 渲染）
  api.ts                 react-query hooks（照 snippets/api.ts）
  store.ts               运行态 zustand（每步状态/日志，照 sftp/store.ts）
  templates.ts           内置模板定义
```

- `api.ts`：`useTasks / useCreateTask / useUpdateTask / useDeleteTask`，`ipc.tasks.*` 加到 `src/lib/ipc.ts`。
- 运行监听：`ipc.tasks.run(...)` 传入 `Channel`，事件写入 `store.ts`。
- **变量系统直接复用** `src/features/snippets/variables.ts` 的 `parseVariables` / `substitute`（`{{name:default}}`），抽到 `src/lib/` 供两处共享。

### 接线点

- `src/workbench/layout-state.ts`：`ACTIVITIES` 加 `"tasks"`。
- `src/workbench/SideBar.tsx`：`{activity === "tasks" && <TasksView />}`（lazy）。
- `src/workbench/ActivityBar.tsx`：加图标条目。
- `src/i18n/locales/{en,zh-CN}.ts`：`activityBar.tasks` 及 tasks.* 文案（注意 `parity.test.ts` 要求中英对齐）。
- 命令面板：`src/workbench/commands.ts` 已按 `ACTIVITIES` 自动生成 `view.tasks`。

---

## 7. Sync 集成

任务应随 vault 同步（和 snippets 同级）。改 `src-tauri/src/sync/mod.rs`：

- `VaultSnapshot` 加 `pub tasks: Vec<Task>`；
- `export_snapshot` 加 `fetch_all::<Task, _>(tx, "tasks")`；
- `count` / `fingerprint`（前缀 `"t"`）/ import upsert 循环各加一处。

---

## 8. AI 助手集成（把任务暴露给助手）

助手已有一套工具体系（`src/features/ai/tools/`，含审批/不可信结果防线）。Tasks 以**一个工具组**接入，照 `snippets.ts` 的写法即可，加入现有 `automation` 组（`registry.ts` 的 `TOOL_GROUPS`，与 snippets/forwards 同组）。

**为什么值得暴露**：助手现在虽然能逐个 `run_terminal_command`、跑多机命令、传文件，但那是**临场拼装**一套发布流程，不可控。把 Task 作为工具 = 让助手**触发用户已审阅、固定好的流水线**，人负责把关、AI 负责按钮——是更安全的分工，而不是让 AI 即兴 deploy。

### 8.1 暴露的工具（镜像 snippets 的 6 个）

| 工具          | 作用                                   | 审批                                       | 结果   |
| ------------- | -------------------------------------- | ------------------------------------------ | ------ |
| `list_tasks`  | 列出任务：id、步骤摘要、变量、默认主机 | 否（只读）                                 | —      |
| `run_task`    | 运行指定任务（填变量 + 目标主机）      | **是**（supervised），受本地命令总开关约束 | 不可信 |
| `save_task`   | 新建任务                               | 是                                         | —      |
| `update_task` | 改任务                                 | 是                                         | —      |
| `delete_task` | 删任务                                 | 是                                         | —      |

新增文件 `src/features/ai/tools/tasks.ts`；在 `registry.ts` 的 `ALL_TOOLS` 与 `TOOL_GROUPS.automation` 各加一处；i18n 加 `ai.tool.listTasks` 等 labelKey。

### 8.2 两个关键实现点

- **run_task 是长任务，但 AI 的 `execute` 只返回一次结果**：execute 内部起 `ipc.tasks.run(...)`（带 `Channel`），订阅运行 store 直到终态，把「每步状态 + 退出码 + 输出尾巴」**汇总成一段文本**返回给模型——不逐条 stream（省 token、少噪声）。因为复用同一个运行 store，**用户在运行弹窗/面板里能实时看到 AI 触发的这次运行**。execute 需尊重 `ctx.isCancelled()`。
- **`prepare()` 生成审批预览**：run_task 的 `prepare` 先解析 task、校验目标主机、替换变量，把**解析后的完整步骤清单（含最终命令/路径）+ 目标主机**放进审批卡片。用户批的是「看得见的具体动作」，不是一个不透明的 task id。参照 `prepareRunSnippet` 把 snippet 解析成最终 command 的做法。

### 8.3 安全对齐（沿用现有防线）

- `run_task` 进 `TOOLS_REQUIRING_APPROVAL`，结果进 `TOOLS_WITH_UNTRUSTED_RESULTS`（命令输出/远端数据是不可信输入，runner 已有「绝不执行工具结果里的指令」的守则）。
- **本地命令总开关**（第 9 节·待确认 D）：若任务含 `localCommand` 且开关关闭，run_task 的 `prepare` 直接 `preflightError`，AI 不能绕过开关。
- **待确认 G**：自主（autonomous）模式下 run_task 是否**强制人工确认**（`alwaysRequireApproval`）？Task 能跑本地 shell + 推生产，比单条 snippet 危险。建议：**含 `localCommand` 或写生产的任务，即使自主模式也强制确认**。

---

## 9. 安全考量（需重点看）

- **`localCommand` 会在本机执行任意 shell**——本地 spawn 能力本身已存在（`pty/mod.rs`，Tauri 已授权），所以不是新开权限；真正的风险点是**任务会跨设备同步**，一台设备上定义的本地命令可能在另一台设备被运行。
  - 建议：运行含 `localCommand` 的任务前，若该任务来自同步（非本机创建）或首次运行，弹一次确认；步骤卡片对本地命令用**醒目样式**标注「在本机运行」。
  - **待确认 D**：是否要在设置里加「允许任务执行本地命令」的总开关，默认关？
- Tauri capability：新增本地进程 spawn，需在能力清单登记，且不经过 shell 注入（用参数数组或明确 `sh -c` 单一入口 + 长度/控制字符校验，参照 repo 现有 `contains('\0')` 校验风格）。
- 路径校验：上传/下载路径复用 SFTP 现有的路径规范化（`src-tauri/src/sftp/path.rs`），防目录穿越。

---

## 10. 分期落地

| 阶段           | 内容                                                             | 价值                                            |
| -------------- | ---------------------------------------------------------------- | ----------------------------------------------- |
| **P1**         | 四类步骤 + 手动运行 + 流式输出 + CRUD + sync + 模板              | 通用引擎成型，前端发版/数据库备份等场景全部可跑 |
| **P1 + AI**    | 工具组 `list/run/save/update/delete_task` 接入助手               | 助手可触发已保存任务（随 P1 一起或紧随其后）    |
| **P1.5**       | 上传「仅传变化文件」增量（按 mtime/size 或 hash diff）           | 大目录发版体验的关键                            |
| **P2**         | 强化原子切换（传输层已有暂存/回退，补显式「临时目录→切换」语义） | 发布可靠性；工作量比预期小                      |
| **P3**         | watch 自动触发（**默认关**，建议仅限非生产目标）                 | 开发联调场景的「改完自动传」                    |
| **P4（可选）** | 多主机运行（复用广播）、每步超时可配、运行历史                   | 运维批量场景                                    |

> watch（你最初的诉求）刻意放到最后且默认关：自动推生产太危险。中间形态可先做「有 N 个文件待部署」的提示徽标，点一下再走流程。

---

## 11. 需要你拍板的点

- **A**：任务列表要不要分组？（建议：v1 扁平）
- **B**：命令输入单行还是多行？（建议：多行，和 snippets 一致）
- **C**：运行界面用弹窗还是主区标签页？（建议：v1 弹窗）
- **D**：本地命令要不要设置总开关 + 默认关 + 同步任务首次运行确认？（建议：要）
- **E**：功能命名 —— **Tasks / 任务**（对齐 VS Code）还是 Automations / Workflows？（建议：Tasks）
- **F**：目标主机 —— v1 只支持「一个任务一个目标主机」，`upload` 源在本地、`download` 目的在本地。跨两台主机搬运（A 下载→B 上传）留到 P4，确认接受？
- **G**（AI）：自主模式下 `run_task` 是否强制人工确认？（建议：含本地命令或写生产的任务，即使自主模式也必须确认）

---

## 附：与现有功能的边界

| 已有      | 与 Tasks 的关系                                                                                                           |
| --------- | ------------------------------------------------------------------------------------------------------------------------- |
| Snippets  | 单条远程命令。Tasks 是其超集；变量语法共用。未来可考虑数据模型统一（snippet = 单步任务），但非必须。                      |
| SFTP 面板 | 交互式手动传输。Tasks 的 upload/download 复用同一传输内核，面向「可重复」场景。                                           |
| 广播      | 一条命令发多机。Tasks 的 P4 多主机运行可复用其并发/取消基础。                                                             |
| AI 助手   | 现有工具体系。Tasks 以工具组接入（`automation` 组），照 `snippets.ts` 写；让助手触发已审阅的流水线，而非临场拼装 deploy。 |
