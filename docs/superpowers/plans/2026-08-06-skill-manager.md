# 本地 Skill 管理器实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 构建一个可扫描、查看、暂停、恢复、备份和安全删除本地 Skill 的 Tauri 2 桌面应用。

**Architecture:** 应用代码位于 `app/`。React + TypeScript 实现三栏界面，通过类型化适配器调用 Tauri Command；Rust 按领域模型、路径安全、Skill 仓储和备份仓储拆分，独占所有文件读写权限。破坏性操作使用临时目录、校验和原子重命名保证源数据安全。

**Tech Stack:** Tauri 2、React、TypeScript、Vite、Vitest、Testing Library、Rust、serde、serde_yaml、walkdir、sha2、tempfile

## Global Constraints

- 默认只扫描 `~/.cursor/skills`、`~/.claude/skills`、`~/.codex/skills`。
- Rust 只允许操作三个 Skill 根目录、应用停用目录和备份目录。
- 删除前必须成功创建 `before_delete` 备份。
- 恢复和暂停遇到目标冲突时停止，不覆盖、不合并。
- 符号链接不递归跟随到允许目录外。
- 所有面向用户的错误使用简洁中文。
- 首版不实现编辑、在线市场、云同步、自动更新、ZIP 导入导出和批量操作。
- 当前工作区不是 Git 仓库，执行计划时不创建提交。

## 文件结构

```text
app/
├── package.json                         # 前端依赖与验证脚本
├── vite.config.ts                       # Vite/Vitest 配置
├── src/
│   ├── App.tsx                          # 页面组合与全局交互
│   ├── App.test.tsx                     # 关键用户流程测试
│   ├── api/skillApi.ts                  # Tauri Command 类型化适配器
│   ├── components/
│   │   ├── Sidebar.tsx                  # 来源和状态筛选
│   │   ├── SkillList.tsx                # 搜索与 Skill 列表
│   │   ├── SkillDetail.tsx              # 详情和操作入口
│   │   ├── BackupList.tsx               # 备份历史与恢复
│   │   └── ConfirmDialog.tsx             # 二次确认
│   ├── hooks/useSkills.ts               # 刷新、筛选和命令状态
│   ├── model/skill.ts                    # 前端领域类型
│   ├── styles.css                        # 三栏桌面布局
│   └── test/setup.ts                     # jest-dom 初始化
└── src-tauri/
    ├── Cargo.toml                        # Rust 依赖
    ├── capabilities/default.json         # 最小 Tauri 权限
    └── src/
        ├── lib.rs                        # Command 注册与 AppState
        ├── commands.rs                   # Tauri Command 薄适配层
        ├── error.rs                      # 结构化错误
        ├── model.rs                      # Skill/Backup/PauseRecord
        ├── paths.rs                      # 根目录与路径白名单
        ├── skill_repository.rs           # 扫描、详情、暂停和恢复
        └── backup_repository.rs          # 备份、删除和备份恢复
```

---

### Task 1: 初始化 Tauri 应用和测试基线

**Files:**
- Create: `app/`
- Modify: `app/package.json`
- Modify: `app/vite.config.ts`
- Create: `app/src/test/setup.ts`
- Test: `app/src/App.test.tsx`

**Interfaces:**
- Produces: `npm run test`、`npm run typecheck`、`npm run tauri build`

- [ ] **Step 1: 创建 Tauri React TypeScript 工程**

Run:

```bash
npm create tauri-app@latest app -- --template react-ts --manager npm
```

Expected: `app/package.json`、`app/src/` 和 `app/src-tauri/` 已生成。

- [ ] **Step 2: 安装前端测试依赖**

Run:

```bash
npm install
npm install --save-dev vitest jsdom @testing-library/react @testing-library/jest-dom @testing-library/user-event
```

Expected: 命令退出码为 0，依赖写入 `app/package.json`。

- [ ] **Step 3: 配置测试脚本和环境**

在 `package.json` 增加：

```json
{
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "tsc --noEmit"
  }
}
```

在 `vite.config.ts` 的 `defineConfig` 中增加：

```ts
test: {
  environment: "jsdom",
  setupFiles: ["./src/test/setup.ts"],
  css: true,
}
```

创建 `src/test/setup.ts`：

```ts
import "@testing-library/jest-dom/vitest";
```

- [ ] **Step 4: 写并运行渲染冒烟测试**

```tsx
import { render, screen } from "@testing-library/react";
import App from "./App";

it("renders the application title", () => {
  render(<App />);
  expect(screen.getByText("Skill Manager")).toBeInTheDocument();
});
```

Run: `npm run test`

Expected: PASS。

---

### Task 2: 建立 Rust 领域模型、错误和路径边界

**Files:**
- Create: `app/src-tauri/src/model.rs`
- Create: `app/src-tauri/src/error.rs`
- Create: `app/src-tauri/src/paths.rs`
- Modify: `app/src-tauri/src/lib.rs`
- Modify: `app/src-tauri/Cargo.toml`
- Test: `app/src-tauri/src/paths.rs`

**Interfaces:**
- Produces: `Provider`、`SkillStatus`、`SkillSummary`、`SkillDetail`、`BackupRecord`、`AppError`
- Produces: `AppPaths::discover(app_data_dir, home_dir)`、`AppPaths::assert_allowed(path)`

- [ ] **Step 1: 添加 Rust 依赖**

Run:

```bash
cargo add serde_yaml walkdir sha2 thiserror uuid --features uuid/v4
cargo add chrono --features serde
cargo add tempfile --dev
```

Expected: `Cargo.toml` 包含上述依赖。

- [ ] **Step 2: 先写路径白名单失败测试**

```rust
#[test]
fn rejects_path_outside_managed_roots() {
    let temp = tempfile::tempdir().unwrap();
    let paths = AppPaths::for_test(temp.path());
    let outside = temp.path().parent().unwrap().join("outside");
    assert!(matches!(
        paths.assert_allowed(&outside),
        Err(AppError::PathOutsideManagedRoots { .. })
    ));
}

#[test]
fn accepts_skill_and_app_data_paths() {
    let temp = tempfile::tempdir().unwrap();
    let paths = AppPaths::for_test(temp.path());
    assert!(paths.assert_allowed(&paths.skill_roots[0]).is_ok());
    assert!(paths.assert_allowed(&paths.disabled_dir).is_ok());
    assert!(paths.assert_allowed(&paths.backups_dir).is_ok());
}
```

Run: `cargo test paths`

Expected: FAIL，因为类型尚不存在。

- [ ] **Step 3: 实现模型、错误和路径服务**

`Provider` 使用 `cursor | claude | codex` 的 serde 小写表示；`SkillStatus` 使用 `active | paused`。所有前端字段使用 `#[serde(rename_all = "camelCase")]`。

`AppError` 至少包含：

```rust
#[derive(Debug, thiserror::Error)]
pub enum AppError {
    #[error("路径不在允许的管理目录内：{path}")]
    PathOutsideManagedRoots { path: String },
    #[error("目标位置已存在：{path}")]
    TargetConflict { path: String },
    #[error("未找到 Skill：{id}")]
    SkillNotFound { id: String },
    #[error("文件操作失败：{message}")]
    Io { message: String },
    #[error("备份校验失败：{id}")]
    BackupVerificationFailed { id: String },
}
```

`AppPaths::assert_allowed` 对不存在的目标路径规范化其最近存在父目录，再拼回相对部分，最后检查是否位于任一白名单根目录中。

- [ ] **Step 4: 运行 Rust 测试**

Run: `cargo test paths`

Expected: PASS。

---

### Task 3: 扫描和解析 Skill

**Files:**
- Create: `app/src-tauri/src/skill_repository.rs`
- Modify: `app/src-tauri/src/model.rs`
- Test: `app/src-tauri/src/skill_repository.rs`

**Interfaces:**
- Consumes: `AppPaths`、`AppError`
- Produces: `SkillRepository::scan() -> Result<Vec<SkillSummary>, AppError>`
- Produces: `SkillRepository::detail(skill_id) -> Result<SkillDetail, AppError>`

- [ ] **Step 1: 写扫描失败测试**

在临时目录创建 Cursor、Claude、Codex 三个根目录，并创建：

```text
cursor/brainstorming/SKILL.md
claude/tdd-test/SKILL.md
codex/broken/SKILL.md
```

前两个文件包含合法 frontmatter，第三个包含非法 YAML。断言：

```rust
let skills = repository.scan().unwrap();
assert_eq!(skills.len(), 3);
assert_eq!(skills[0].provider, Provider::Cursor);
assert!(skills.iter().find(|s| s.name == "broken").unwrap().warnings.len() == 1);
```

Run: `cargo test skill_repository`

Expected: FAIL，因为仓储尚不存在。

- [ ] **Step 2: 实现扫描和详情**

实现规则：

1. 只读取根目录直接子目录。
2. 不跟随符号链接递归。
3. 名称优先取 frontmatter `name`，否则取目录名。
4. 描述优先取 frontmatter `description`，否则为空字符串。
5. YAML 解析失败不丢弃 Skill，写入中文警告。
6. `detail` 返回 `SKILL.md` 原文和排序后的相对文件清单。
7. 稳定 ID 为 `sha256(provider + ":" + original_path)` 的十六进制字符串。

- [ ] **Step 3: 运行扫描测试**

Run: `cargo test skill_repository`

Expected: PASS。

---

### Task 4: 暂停和恢复

**Files:**
- Modify: `app/src-tauri/src/skill_repository.rs`
- Modify: `app/src-tauri/src/model.rs`
- Test: `app/src-tauri/src/skill_repository.rs`

**Interfaces:**
- Produces: `pause(skill_id) -> Result<SkillDetail, AppError>`
- Produces: `resume(skill_id) -> Result<SkillDetail, AppError>`
- Persists: `paused-index.json`

- [ ] **Step 1: 写暂停、恢复和冲突测试**

```rust
let paused = repository.pause(&skill_id).unwrap();
assert_eq!(paused.status, SkillStatus::Paused);
assert!(!original_path.exists());
assert!(paused.current_path.exists());

let resumed = repository.resume(&skill_id).unwrap();
assert_eq!(resumed.status, SkillStatus::Active);
assert!(original_path.exists());
```

另建同名目标目录，断言 `resume` 返回 `AppError::TargetConflict` 且停用目录保持不变。

Run: `cargo test pause`

Expected: FAIL。

- [ ] **Step 2: 实现暂停索引和安全移动**

实现 `atomic_write_json`：序列化到同目录临时文件，`sync_all` 后 `rename`。暂停流程先移动，再写索引；索引写入失败时立即将目录移回。恢复流程先移动回原路径，再更新索引；索引失败时将目录移回停用区。

跨文件系统时复制到临时目录，按相对路径和 SHA-256 校验后再删除源目录。

- [ ] **Step 3: 运行暂停恢复测试**

Run: `cargo test pause`

Expected: PASS。

---

### Task 5: 备份、删除和恢复备份

**Files:**
- Create: `app/src-tauri/src/backup_repository.rs`
- Modify: `app/src-tauri/src/model.rs`
- Test: `app/src-tauri/src/backup_repository.rs`

**Interfaces:**
- Produces: `create_backup(skill_id, reason) -> Result<BackupRecord, AppError>`
- Produces: `list_backups() -> Result<Vec<BackupRecord>, AppError>`
- Produces: `restore_backup(backup_id) -> Result<SkillDetail, AppError>`
- Produces: `delete_skill(skill_id) -> Result<BackupRecord, AppError>`

- [ ] **Step 1: 写删除安全性测试**

```rust
let backup = backups.delete_skill(&skill_id).unwrap();
assert_eq!(backup.reason, BackupReason::BeforeDelete);
assert!(!skill_path.exists());
assert!(backup.archive_path.exists());
```

注入一个返回复制错误的文件操作器，再断言：

```rust
assert!(backups.delete_skill(&skill_id).is_err());
assert!(skill_path.exists());
```

Run: `cargo test backup_repository`

Expected: FAIL。

- [ ] **Step 2: 实现版本化目录备份**

备份写入 `backups/<skill-id>/<timestamp>-<backup-id>/`。先复制到 `.tmp-<backup-id>`，生成按相对路径排序的 SHA-256 清单并汇总为 `checksum`，校验后重命名，再原子更新 `backup-index.json`。

`delete_skill` 只能调用 `create_backup(..., BeforeDelete)`，成功后才删除源目录。删除暂停项时同步移除 `paused-index.json` 记录。

- [ ] **Step 3: 实现恢复冲突保护**

恢复前重新计算备份校验值。目标存在时返回 `TargetConflict`；否则复制到目标同级临时目录，校验后原子重命名。

- [ ] **Step 4: 运行备份测试**

Run: `cargo test backup_repository`

Expected: PASS。

---

### Task 6: 暴露最小 Tauri Command

**Files:**
- Create: `app/src-tauri/src/commands.rs`
- Modify: `app/src-tauri/src/lib.rs`
- Modify: `app/src-tauri/capabilities/default.json`
- Test: `app/src-tauri/src/commands.rs`

**Interfaces:**
- Produces Commands: `scan_skills`、`get_skill_detail`、`pause_skill`、`resume_skill`、`create_backup`、`list_backups`、`restore_backup`、`delete_skill`

- [ ] **Step 1: 写 Command 序列化测试**

对 `AppError::TargetConflict` 转换后的响应断言：

```rust
assert_eq!(payload.code, "TARGET_CONFLICT");
assert!(payload.message.starts_with("目标位置已存在"));
```

Run: `cargo test commands`

Expected: FAIL。

- [ ] **Step 2: 实现 AppState 和薄 Command**

`AppState` 持有 `Mutex<SkillRepository>` 与 `Mutex<BackupRepository>`。Command 只接收 ID、锁定服务、调用领域方法并将 `AppError` 映射为：

```rust
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CommandError {
    pub code: &'static str,
    pub message: String,
}
```

在 `lib.rs` 使用 `tauri::generate_handler!` 注册全部八个命令。Capabilities 不授予前端任意文件系统读写权限。

- [ ] **Step 3: 运行 Rust 全量验证**

Run:

```bash
cargo fmt --check
cargo clippy --all-targets --all-features -- -D warnings
cargo test
```

Expected: 全部退出码为 0。

---

### Task 7: 前端类型化 API 和三栏主界面

**Files:**
- Create: `app/src/model/skill.ts`
- Create: `app/src/api/skillApi.ts`
- Create: `app/src/hooks/useSkills.ts`
- Create: `app/src/components/Sidebar.tsx`
- Create: `app/src/components/SkillList.tsx`
- Create: `app/src/components/SkillDetail.tsx`
- Modify: `app/src/App.tsx`
- Modify: `app/src/styles.css`
- Test: `app/src/App.test.tsx`

**Interfaces:**
- Produces: `SkillApi` 接口及 `tauriSkillApi`
- Produces: `AppProps { api?: SkillApi }`，测试可注入假实现

- [ ] **Step 1: 写筛选和详情失败测试**

假 API 返回 Cursor 启用项和 Claude 暂停项。测试依次：

```tsx
render(<App api={fakeApi} />);
await screen.findByText("brainstorming");
await user.click(screen.getByRole("button", { name: "Claude" }));
expect(screen.getByText("tdd-test")).toBeInTheDocument();
expect(screen.queryByText("brainstorming")).not.toBeInTheDocument();
await user.click(screen.getByText("tdd-test"));
expect(await screen.findByText("测试驱动开发")).toBeInTheDocument();
```

Run: `npm run test`

Expected: FAIL。

- [ ] **Step 2: 实现类型和 API**

`SkillApi` 精确包含：

```ts
export interface SkillApi {
  scanSkills(): Promise<SkillSummary[]>;
  getSkillDetail(skillId: string): Promise<SkillDetail>;
  pauseSkill(skillId: string): Promise<SkillDetail>;
  resumeSkill(skillId: string): Promise<SkillDetail>;
  createBackup(skillId: string): Promise<BackupRecord>;
  listBackups(): Promise<BackupRecord[]>;
  restoreBackup(backupId: string): Promise<SkillDetail>;
  deleteSkill(skillId: string): Promise<BackupRecord>;
}
```

默认实现通过 `@tauri-apps/api/core` 的 `invoke` 调用同名蛇形 Command。

- [ ] **Step 3: 实现三栏界面**

左栏筛选 `all | cursor | claude | codex | paused | backups`；中栏进行不区分大小写的名称和描述搜索；右栏按选择加载详情。无选择时展示引导空状态，扫描失败时展示错误和“重试”按钮。

- [ ] **Step 4: 运行前端测试和类型检查**

Run:

```bash
npm run test
npm run typecheck
```

Expected: PASS。

---

### Task 8: 破坏性操作、备份中心和错误反馈

**Files:**
- Create: `app/src/components/BackupList.tsx`
- Create: `app/src/components/ConfirmDialog.tsx`
- Modify: `app/src/components/SkillDetail.tsx`
- Modify: `app/src/hooks/useSkills.ts`
- Modify: `app/src/App.tsx`
- Test: `app/src/App.test.tsx`

**Interfaces:**
- Consumes: Task 7 的 `SkillApi`
- Produces: 暂停、恢复、备份、删除和备份恢复完整用户流程

- [ ] **Step 1: 写确认与防重复测试**

点击“删除”后断言 `deleteSkill` 尚未调用；点击弹窗“备份并删除”后断言只调用一次，按钮在 Promise 完成前禁用。模拟 `TARGET_CONFLICT`，断言界面显示“目标位置已存在”且详情仍保留。

Run: `npm run test`

Expected: FAIL。

- [ ] **Step 2: 实现操作状态**

`useSkills` 使用单一 `pendingAction: string | null` 阻止重复操作。每次成功操作后重新扫描并保持可用的当前选择；删除后清空选择。错误对象统一转为中文提示，不显示 Rust 调试栈。

- [ ] **Step 3: 实现备份中心**

左栏选择“备份记录”时中栏展示按 `createdAt` 倒序排列的备份；右栏展示原因、来源、原路径和校验值。恢复按钮弹出确认框，冲突错误不覆盖现有目录。

- [ ] **Step 4: 运行前端全量验证**

Run:

```bash
npm run test
npm run typecheck
```

Expected: PASS。

---

### Task 9: 应用集成与打包验收

**Files:**
- Modify: `app/src-tauri/tauri.conf.json`
- Modify: `app/README.md`
- Test: all frontend and Rust tests

**Interfaces:**
- Produces: 可运行开发应用和 macOS 安装包

- [ ] **Step 1: 配置产品信息**

设置产品名 `Skill Manager`、唯一 bundle identifier、窗口最小尺寸和默认尺寸。README 记录：

```bash
npm install
npm run tauri dev
npm run test
npm run typecheck
npm run tauri build
```

- [ ] **Step 2: 执行完整验证**

Run:

```bash
npm run test
npm run typecheck
cargo fmt --check --manifest-path src-tauri/Cargo.toml
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets --all-features -- -D warnings
cargo test --manifest-path src-tauri/Cargo.toml
npm run tauri build
```

Expected: 所有命令退出码为 0，`src-tauri/target/release/bundle/` 生成 macOS 安装产物。

- [ ] **Step 3: 手工安全验收**

使用临时测试 Skill 逐项确认：

1. 三个来源均可扫描。
2. 暂停后默认目录不再存在该 Skill。
3. 恢复后内容校验值不变。
4. 可连续创建多个备份。
5. 删除后存在 `before_delete` 备份。
6. 恢复目标冲突时原目录不变。
7. 非白名单路径操作被拒绝。
