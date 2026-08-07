# Skill 库与一键应用 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在现有 Skill Manager 上落地中央库、标签分组、Git/本地项目、符号链接一键应用，以及 Skill 目录树与文件预览；扫描仅保留含 `SKILL.md` 的目录。

**Architecture:** 继续使用 Tauri 2 + React + Rust。新增 `library_repository` 管理项目/标签/分组/安装索引；复用现有路径白名单、事务锁、扫描解析。工具目录安装通过符号链接完成。前端扩展三栏导航与详情文件浏览器。

**Tech Stack:** Tauri 2、React、TypeScript、Vitest、Rust、serde、walkdir、现有 fs_ops / json_store / transaction_lock

## Global Constraints

- 仅识别包含 `SKILL.md` 的目录为 Skill；无 `SKILL.md` 的目录与普通文件必须过滤。
- 安装使用符号链接；目标为真实目录时停止不覆盖；本应用链接可更新。
- 标签多选、分组单选，仅存应用索引。
- 本地项目引用不复制；Git 项目 clone 到 `library/projects/<id>/`。
- Git URL 仅 `https` / `git` / `ssh` / `git@host:path`；命令参数化，禁止 shell 拼接。
- 文件预览路径必须位于当前 Skill 目录内；二进制/超大文件拒绝全文加载。
- 不初始化 Git 仓库、不提交（当前工作区无 Git）。
- 所有 Bash 命令逐条执行。
- 首版不做批量应用、云同步、市场、SKILL.md 编辑、多分支、自动迁移入库。

## 文件结构

```text
app/src-tauri/src/
  library_repository.rs   # 项目/库 Skill/标签/分组/安装
  git_ops.rs              # 受控 git clone/pull
  skill_files.rs          # 目录树与文件读取
  skill_repository.rs     # 扫描过滤强化
  commands.rs             # 新增 Command
  model.rs                # 新类型
app/src/
  components/FileTree.tsx
  components/FilePreview.tsx
  components/LibraryPanel.tsx
  components/ProjectPanel.tsx
  components/InstallToggles.tsx
  hooks/useLibrary.ts
  api/skillApi.ts         # 扩展 API
```

---

### Task 1: 扫描过滤非 Skill 目录 + 目录树/文件预览

**Files:**
- Modify: `app/src-tauri/src/skill_repository.rs`
- Create: `app/src-tauri/src/skill_files.rs`
- Modify: `app/src-tauri/src/model.rs`
- Modify: `app/src-tauri/src/commands.rs`
- Modify: `app/src-tauri/src/lib.rs`
- Modify: `app/src/components/SkillDetail.tsx`
- Create: `app/src/components/FileTree.tsx`
- Create: `app/src/components/FilePreview.tsx`
- Modify: `app/src/api/skillApi.ts`
- Modify: `app/src/App.test.tsx`

**Interfaces:**
- Produces: `list_skill_tree(skill_id) -> Vec<FileNode>`
- Produces: `read_skill_file(skill_id, relative_path) -> FileContent`
- Scan ignores directories without `SKILL.md`

```rust
pub struct FileNode {
  pub name: String,
  pub relative_path: String,
  pub kind: FileNodeKind, // file | directory
  pub size: Option<u64>,
  pub children: Vec<FileNode>,
}

pub struct FileContent {
  pub relative_path: String,
  pub media_type: String, // text | markdown | unsupported
  pub content: Option<String>,
  pub message: Option<String>,
}
```

- [ ] **Step 1:** 写失败测试：扫描忽略无 `SKILL.md` 子目录与普通文件
- [ ] **Step 2:** 改 `scan` 过滤逻辑并 GREEN
- [ ] **Step 3:** 写失败测试：目录树、路径逃逸拒绝、文本预览、二进制拒绝
- [ ] **Step 4:** 实现 `skill_files` + Command + 前端文件树/预览
- [ ] **Step 5:** 运行 `cargo test`、`npm run test`、`npm run typecheck`

---

### Task 2: 中央库索引、本地/Git 项目、标签与分组

**Files:**
- Create: `app/src-tauri/src/library_repository.rs`
- Create: `app/src-tauri/src/git_ops.rs`
- Modify: `app/src-tauri/src/model.rs`
- Modify: `app/src-tauri/src/paths.rs`
- Modify: `app/src-tauri/src/commands.rs`
- Modify: `app/src-tauri/src/error.rs`

**Interfaces:**
- `add_local_project(path)` / `add_git_project(url)` / `pull_git_project(id)` / `remove_project(id)` / `list_projects`
- `list_library_skills` / `get_library_skill_detail`
- tag/group CRUD + `set_skill_tags` / `set_skill_group`
- Index file: `library-index.json` under app-data
- Local projects are references; git projects clone into `library/projects/<id>`
- Shared transaction lock

- [ ] **Step 1:** 模型与索引读写 RED/GREEN
- [ ] **Step 2:** 本地项目添加与库扫描（仅 SKILL 目录）
- [ ] **Step 3:** Git URL 校验 + clone/pull
- [ ] **Step 4:** 标签多选、分组单选
- [ ] **Step 5:** Command 暴露与 `cargo test`

---

### Task 3: 符号链接安装/卸载

**Files:**
- Modify: `app/src-tauri/src/library_repository.rs`
- Modify: `app/src-tauri/src/commands.rs`
- Test in `library_repository.rs`

**Interfaces:**
- `install_skill(library_skill_id, provider)`
- `uninstall_skill(library_skill_id, provider)`
- `list_installations`

Rules:
- Create symlink under provider skill root
- Real directory conflict → `TargetConflict`
- Managed symlink → update target
- Uninstall only managed symlink

- [ ] **Step 1:** RED 安装/更新/冲突/卸载
- [ ] **Step 2:** 实现并 GREEN
- [ ] **Step 3:** `cargo test` + clippy

---

### Task 4: 前端库导航与操作接入

**Files:**
- Create: `app/src/hooks/useLibrary.ts`
- Create: `app/src/components/LibraryPanel.tsx`
- Create: `app/src/components/ProjectPanel.tsx`
- Create: `app/src/components/InstallToggles.tsx`
- Modify: `app/src/components/Sidebar.tsx`
- Modify: `app/src/App.tsx`
- Modify: `app/src/api/skillApi.ts`
- Modify: `app/src/model/skill.ts`
- Modify: `app/src/App.test.tsx`
- Modify: `app/src/styles.css`

- [ ] **Step 1:** 扩展类型化 API
- [ ] **Step 2:** 左栏导航：Skill 库/分组/标签/项目/已安装
- [ ] **Step 3:** 标签分组编辑、安装开关、项目添加/拉取
- [ ] **Step 4:** 详情集成文件树（Task 1）与安装状态
- [ ] **Step 5:** `npm run test` / `typecheck` / `build`

---

### Task 5: 集成验证

- [ ] **Step 1:** 全量前端与 Rust 测试、clippy、fmt
- [ ] **Step 2:** 更新 README 说明库/标签/应用/文件预览
- [ ] **Step 3:** `npm run tauri build`（若环境允许）
- [ ] **Step 4:** 写验收报告到 `.superpowers/sdd/task-v2-report.md`
