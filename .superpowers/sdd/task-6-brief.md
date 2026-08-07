# Task 6：暴露最小 Tauri Command

## 约束

- Rust 工作目录：`/Users/xuzhi/github/skilltools/app/src-tauri`
- TDD；命令逐条执行；不初始化 Git、不提交。
- Command 只做参数接收、仓储调用和错误映射，不复制业务规则。
- 前端不得获得任意文件系统读写权限。
- 移除脚手架 `greet`、无用 opener 插件和权限。

## 文件

- 创建 `src/commands.rs`
- 修改 `src/lib.rs`
- 修改 `capabilities/default.json`
- 按需修改 `Cargo.toml` 删除无用依赖

## AppState

```rust
pub struct AppState {
    pub skills: Mutex<SkillRepository>,
    pub backups: Mutex<BackupRepository>,
}
```

运行时在 `Builder::setup` 中通过 Tauri `Manager`：

1. 获取 `app.path().app_data_dir()` 和 `app.path().home_dir()`。
2. 构造单个 `AppPaths`，clone 给两个仓储。
3. `app.manage(AppState { ... })`。
4. 路径获取或初始化失败时返回 setup error，不 panic。

仓储自身已有共享文件事务锁；`Mutex` 负责实例访问，不改变领域事务。

## 错误

```rust
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CommandError {
    pub code: &'static str,
    pub message: String,
}
```

为每个 AppError 提供稳定大写蛇形码：

- `PATH_OUTSIDE_MANAGED_ROOTS`
- `TARGET_CONFLICT`
- `SKILL_NOT_FOUND`
- `SKILL_ALREADY_PAUSED`
- `PAUSE_INDEX`
- `MOVE_ROLLBACK`
- `IO`
- `BACKUP_VERIFICATION_FAILED`
- `BACKUP_NOT_FOUND`
- `BACKUP_INDEX`
- `ROLLBACK_FAILED`
- `STATE_LOCK_POISONED`

Command 不返回 Rust Debug 文本或堆栈。

## Commands

精确暴露：

```rust
scan_skills() -> Result<Vec<SkillSummary>, CommandError>
get_skill_detail(skill_id: String) -> Result<SkillDetail, CommandError>
pause_skill(skill_id: String) -> Result<SkillDetail, CommandError>
resume_skill(skill_id: String) -> Result<SkillDetail, CommandError>
create_backup(skill_id: String) -> Result<BackupRecord, CommandError> // Manual
list_backups() -> Result<Vec<BackupRecord>, CommandError>
restore_backup(backup_id: String) -> Result<SkillDetail, CommandError>
delete_skill(skill_id: String) -> Result<BackupRecord, CommandError>
```

所有函数标注 `#[tauri::command]`，并在 `generate_handler!` 注册八个命令。

## Capabilities

`default.json` 只保留运行应用必需的 `core:default`；不得加入 fs、shell、process 或任意路径 scope。删除 opener 权限和插件。

## TDD

至少覆盖：

- 每个 AppError 映射到精确 code 和中文 message。
- `TargetConflict` 映射结果：

```rust
assert_eq!(payload.code, "TARGET_CONFLICT");
assert!(payload.message.starts_with("目标位置已存在"));
```

- Mutex poisoned 映射为 `STATE_LOCK_POISONED`，不得 panic。
- 八个 command 的仓储成功/错误薄调用可通过测试构造仓储和 tempfile 验证至少扫描、详情、暂停、手动备份、删除。

最终逐条运行：

```bash
cargo fmt --check
cargo clippy --all-targets --all-features -- -D warnings
cargo test commands
cargo test
```

## 报告

写入 `/Users/xuzhi/github/skilltools/.superpowers/sdd/task-6-report.md`，包含状态、文件、RED/GREEN、命令结果、自检、concerns。最终只返回状态、一行验证摘要与 concerns。
