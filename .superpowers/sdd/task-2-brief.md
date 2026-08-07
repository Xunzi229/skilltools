# Task 2：Rust 领域模型、错误与路径边界

## 项目位置

应用：`/Users/xuzhi/github/skilltools/app`
Rust：`/Users/xuzhi/github/skilltools/app/src-tauri`

## 全局约束

- 所有 Bash 命令逐条执行，完成后再执行下一条。
- 不初始化 Git、不提交。
- 先写失败测试，再实现，再验证。
- 仅处理模型、错误和路径边界，不实现扫描、暂停或备份。
- Rust 只允许操作三个 Skill 根目录、应用停用目录和备份目录。

## 文件

- 创建 `src-tauri/src/model.rs`
- 创建 `src-tauri/src/error.rs`
- 创建 `src-tauri/src/paths.rs`
- 修改 `src-tauri/src/lib.rs`
- 修改 `src-tauri/Cargo.toml`

## 依赖

在 `src-tauri/` 中逐条添加：

```bash
cargo add serde_yaml
cargo add walkdir
cargo add sha2
cargo add thiserror
cargo add uuid --features v4
cargo add chrono --features serde
cargo add tempfile --dev
```

## 模型

所有面向前端的结构使用 `Serialize`、`Deserialize` 和 `#[serde(rename_all = "camelCase")]`。

```rust
pub enum Provider { Cursor, Claude, Codex }
pub enum SkillStatus { Active, Paused }
pub enum BackupReason { Manual, BeforeDelete }

pub struct SkillSummary {
    pub id: String,
    pub name: String,
    pub description: String,
    pub provider: Provider,
    pub status: SkillStatus,
    pub original_path: PathBuf,
    pub current_path: PathBuf,
    pub warnings: Vec<String>,
}

pub struct SkillDetail {
    // 包含 SkillSummary 的同名字段
    pub skill_markdown: String,
    pub files: Vec<String>,
}

pub struct BackupRecord {
    pub id: String,
    pub skill_id: String,
    pub skill_name: String,
    pub provider: Provider,
    pub reason: BackupReason,
    pub created_at: DateTime<Utc>,
    pub original_path: PathBuf,
    pub archive_path: PathBuf,
    pub checksum: String,
}

pub struct PauseRecord {
    pub skill_id: String,
    pub provider: Provider,
    pub original_path: PathBuf,
    pub paused_path: PathBuf,
    pub paused_at: DateTime<Utc>,
}
```

可为 `SkillDetail` 增加 `From<(SkillSummary, String, Vec<String>)>`，但不要提前添加无调用方抽象。

## 错误

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

实现 `From<std::io::Error>` 映射为 `Io`。

## 路径服务

```rust
pub struct SkillRoot {
    pub provider: Provider,
    pub path: PathBuf,
}

pub struct AppPaths {
    pub skill_roots: Vec<SkillRoot>,
    pub app_data_dir: PathBuf,
    pub disabled_dir: PathBuf,
    pub backups_dir: PathBuf,
    pub paused_index: PathBuf,
    pub backup_index: PathBuf,
}

impl AppPaths {
    pub fn discover(app_data_dir: PathBuf, home_dir: PathBuf) -> Self;
    pub fn assert_allowed(&self, path: &Path) -> Result<(), AppError>;
    #[cfg(test)]
    pub fn for_test(base: &Path) -> Self;
}
```

`discover` 创建三个 SkillRoot，分别指向 `.cursor/skills`、`.claude/skills`、`.codex/skills`。`assert_allowed` 必须支持尚不存在的目标：找到最近存在父目录并 canonicalize，再安全拼回剩余段；拒绝 `..` 逃逸；允许 Skill 根、disabled 和 backups 的自身及后代。

## TDD

至少覆盖：

```rust
#[test]
fn rejects_path_outside_managed_roots()

#[test]
fn accepts_skill_and_app_data_paths()

#[test]
fn rejects_parent_traversal_for_missing_target()

#[test]
fn discover_builds_three_default_roots()
```

先运行 `cargo test paths` 确认测试失败，再实现并再次运行。

最终依次运行：

```bash
cargo fmt --check
cargo test paths
cargo test model
```

## 报告

完整报告写入 `/Users/xuzhi/github/skilltools/.superpowers/sdd/task-2-report.md`，包含状态、文件、RED/GREEN 证据、命令结果、自检和 concerns。最终仅返回状态、一行测试摘要与 concerns。
