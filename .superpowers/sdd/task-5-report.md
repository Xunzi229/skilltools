# Skill Manager Task 5 实施报告

## 状态

已完成 Task 5：备份、删除与备份恢复。未实现 Tauri Command 或前端，未初始化或操作 Git。

## 文件

- `app/src-tauri/src/backup_repository.rs`
  - 实现 `BackupRepository` 的创建备份、列出备份、删除 Skill、恢复备份。
  - 覆盖完整目录清单、SHA-256 checksum、临时目录校验、原子 rename、索引失败清理、删除 tombstone 与恢复冲突保护。
  - 新增 14 个备份仓库测试。
- `app/src-tauri/src/fs_ops.rs`
  - 提取不跟随符号链接的目录复制、目录/文件/链接规范化清单、复制校验和 checksum。
- `app/src-tauri/src/json_store.rs`
  - 提取 JSON 索引读取、序列化和原子写入。
- `app/src-tauri/src/skill_repository.rs`
  - 复用 `fs_ops`、`json_store`。
  - 仅增加最小 `pub(crate)` 暂停索引协作接口，未暴露任意路径删除。
- `app/src-tauri/src/error.rs`
  - 新增 `BackupNotFound`、`BackupIndex` 结构化错误。
- `app/src-tauri/src/paths.rs`
  - 备份索引文件名统一为 `backup-index.json`。
- `app/src-tauri/src/lib.rs`
  - 导出 `backup_repository`，注册内部复用模块。

## RED / GREEN

### RED 1

先新增备份仓库行为测试，运行 `cargo test backup_repository`：

- 编译失败：缺少 `BackupRepository`。
- 编译失败：缺少 `copy_verified_directory_with`。
- 编译失败：缺少 `AppError::BackupIndex`。

失败原因与待实现功能一致。

### GREEN 1

实现最小备份仓库及复用 helper 后：

- `cargo test backup_repository`
- 13 passed，0 failed。

### RED 2

补充“恢复已经 rename 成功，但读取最终详情失败时必须回滚”的事务测试：

- `restore_detail_failure_removes_committed_target` 失败。
- 失败点：恢复目标仍存在，证明提交后错误未回滚。

### GREEN 2

增加最终详情失败时删除恢复目标的回滚：

- 定向测试 1 passed，0 failed。
- 备份仓库测试 14 passed，0 failed。

## 最终命令结果

1. `cargo fmt --check`
   - 通过，退出码 0。
2. `cargo test backup_repository`
   - 通过，14 passed，0 failed，退出码 0。
3. `cargo test`
   - 测试输出完整通过：51 passed，0 failed；main 0 failed；doc-tests 0 failed。
   - 命令运行器在打印完整成功结果后未自行返回并触发超时；没有测试失败输出。

## 自检

- 备份使用 `backups/<skill-id>/<安全 UTC timestamp>-<uuid>/`。
- 复制前源清单、复制后源清单、临时目录清单三者一致后才提交。
- 清单包含排序后的目录、普通文件 SHA-256、符号链接目标；复制不跟随链接。
- 正式备份完成后才原子写索引；索引失败会清理正式备份并保留源。
- 删除先完成 `BeforeDelete` 备份与索引，再原子 rename 到 tombstone。
- paused 删除会原子更新暂停索引；索引失败会恢复 tombstone。
- tombstone 清理失败只记录隔离日志，不逆转逻辑删除。
- 恢复前重新校验 archive checksum；目标存在直接返回 `TargetConflict`。
- 恢复通过同级临时目录复制校验并原子 rename；最终详情失败会回滚恢复目录。
- 相关备份、源、目标、临时目录、tombstone 和索引入口均经过 `AppPaths::assert_allowed` 边界校验。
- 未增加 Command、前端、任意路径删除接口或 Git 操作。

## Concerns

- 最终 `cargo test` 已打印全部通过结果，但命令运行器未在输出完成后正常结束；需关注本地终端包装进程状态，不影响已产生的测试结果。
- 事务依赖同文件系统原子 rename；这是当前目录布局和需求约束下的预期前提。

---

## Task 5 复核修复追加报告

### 修复状态

已完成全部 7 项复核修复：

1. 删除事务先把目标原子 rename 为同文件系统 tombstone，再从冻结 tombstone 创建并提交 `BeforeDelete` 备份；备份、备份索引或 paused 索引失败会恢复 tombstone。
2. 恢复提交使用平台原子 no-replace helper：
   - macOS：`renamex_np(..., RENAME_EXCL)`。
   - Linux：`renameat2(..., RENAME_NOREPLACE)`。
   - Windows：`MoveFileExW(..., flags=0)`，禁止替换。
   - 其它平台明确返回不支持错误，不退化为覆盖 rename。
3. 恢复前扫描同 `skill_id` 的 active/paused Skill，任一存在均返回 `TargetConflict`；paused 手动备份不会创建 active 副本。
4. `BackupRepository` 增加内部 `Mutex`，锁覆盖备份索引完整读—复制—追加—原子写；删除使用 unlocked 私有备份 helper，避免重入死锁。
5. 恢复最终 detail 失败会清理已提交目标；清理失败返回 `RollbackFailed { original_error, rollback_error }`。
6. Windows 符号链接复制使用 `FileTypeExt` 的链接自身类型，完全移除会跟随目标的 `source.is_dir()`。
7. 已完成聚焦测试和最终顺序验证，所有最终命令均取得实际退出码。

### 新增/调整文件

- `app/src-tauri/src/backup_repository.rs`
  - 冻结删除事务、逻辑恢复冲突、事务互斥、恢复回滚错误。
  - 备份仓库测试增至 20 项。
- `app/src-tauri/src/fs_ops.rs`
  - 平台 no-replace rename。
  - Windows 链接自身类型分派。
- `app/src-tauri/src/error.rs`
  - 新增 `RollbackFailed`。
- `app/src-tauri/Cargo.toml`
  - 增加 `libc`，用于 macOS/Linux 原子排他 rename。
- `app/src-tauri/Cargo.lock`
  - 同步依赖锁定。

### 聚焦 RED / GREEN 证据

#### 1. 删除冻结对象

- RED：`delete_freezes_exact_directory_before_backup_and_delete`
  - 退出码 101。
  - 缺少冻结删除事务入口；当前实现无法在冻结后注入替换源来验证删除对象一致性。
- GREEN：
  - 退出码 0。
  - 备份内容保持原 Skill，冻结后创建的原路径替换目录未被误删。

#### 2. 恢复 no-replace

- RED：`no_replace_rename_preserves_racing_target`
  - 退出码 101，缺少 `rename_directory_no_replace`。
- GREEN：退出码 0，已存在目标及源均保持不变，返回 `TargetConflict`。
- RED：`restore_commit_rejects_target_created_after_precheck`
  - 退出码 101，缺少可稳定复现 precheck/commit 竞态的恢复事务入口。
- GREEN：退出码 0，precheck 后新建的竞态目标未被覆盖。

#### 3. active/paused 逻辑冲突

- RED：`restore_rejects_when_same_skill_is_still_paused`
  - 退出码 101。
  - 原实现错误返回 `Ok(SkillDetail { status: Paused, ... })`，并在 original path 创建 active 副本。
- GREEN：退出码 0，返回 `TargetConflict`，paused Skill 保持不变且 original path 不存在。

#### 4. 并发备份互斥

- RED：`concurrent_backups_serialize_entire_index_transaction`
  - 退出码 101，缺少完整事务互斥入口。
- GREEN：退出码 0。
  - 第一个事务持锁时第二个事务无法进入临界区；释放后两次备份均完成，索引保留 2 条记录。

#### 5. 恢复回滚失败

- RED：`restore_cleanup_failure_returns_explicit_rollback_error`
  - 退出码 101，缺少可注入最终 detail/清理失败的事务入口。
- GREEN：退出码 0。
  - 返回 `RollbackFailed`，同时携带原始 detail 错误与 `cleanup denied` 回滚错误。
- `restore_detail_failure_removes_committed_target` 同时验证正常清理成功时不遗留已提交目标。

#### 6. Windows 符号链接类型

- RED：`symlink_copy_dispatch_uses_link_kind_without_target_probe`
  - 退出码 101，缺少链接自身类型分派。
- GREEN：退出码 0。
  - 文件/目录链接分支只由记录的链接类型选择，不探测链接目标。

### 最终顺序验证

1. `exec cargo fmt --check`
   - 实际退出码 0。
2. `exec cargo test backup_repository`
   - 实际退出码 0。
   - 20 passed，0 failed。
3. `exec cargo test`
   - 实际退出码 0。
   - lib：58 passed，0 failed。
   - main：0 failed。
   - doc-tests：0 failed。

### 包装器退出定位

- Rust 测试输出显示并发聚焦测试在 0.26 秒完成且两个线程均已 join，不存在事务锁死。
- 进程检查显示阻塞发生在 Cursor 持久 Shell 包装器完成命令后保存 Shell 状态的阶段，而不是 `cargo test` 内部。
- 最终命令使用 `exec cargo ...`，均由运行器记录实际 `exit_code: 0`；因此本次验证具有明确退出码，不再仅依据测试输出推断。

### Concerns

- Windows 链接分支已按 `FileTypeExt` 实现并由平台无关分派测试覆盖；当前执行环境为 macOS，未执行 Windows 目标上的真实链接创建测试。
- no-replace 的 Linux/Windows 分支受 `cfg` 保护，当前 macOS 验证实际执行的是 `renamex_np(RENAME_EXCL)` 分支。

---

## Task 5 共享事务锁与回滚修复

### 状态

已完成应用级共享事务锁、跨仓库并发保护和 tombstone 排他回滚修复。

### 实现

- 新增 `src/transaction_lock.rs`：
  - 锁文件：`app-data/.skill-manager.transaction.lock`。
  - 使用 `fs2::FileExt::lock_exclusive`。
  - `AppTransactionGuard` 在 Drop 时释放锁。
  - 相同 `AppPaths` 的独立 Repository 实例及进程共享同一排他锁。
- `BackupRepository` 移除实例 `Mutex`：
  - `create_backup`、`list_backups`、`delete_skill`、`restore_backup` 持有应用级锁。
  - unlocked 私有 helper 避免删除事务内创建备份时重复加锁。
- `SkillRepository`：
  - `pause`、`resume` 的完整扫描、移动、索引读改写及最终详情读取均在应用级锁内。
  - paused 删除读取和改写暂停索引与 pause/resume 使用同一锁。
- tombstone 回滚：
  - 删除备份失败、paused 索引失败均使用原子 no-replace 回滚。
  - 跨文件系统移动提交失败后的 source tombstone 同样使用 no-replace 回滚。
  - 竞态目标存在时返回 `RollbackFailed` 并保留 tombstone。
- restore：
  - 逻辑冲突检查、archive 校验、no-replace 提交和最终 detail 验证均在共享锁内。
  - 最终详情必须为 `Active` 且 `current_path == original_path`，否则安全清理并返回校验错误；清理失败返回 `RollbackFailed`。
- 删除事务保留安全顺序并增加注释：
  - 先同文件系统 rename 冻结为 tombstone。
  - 再从 tombstone 创建 `BeforeDelete` 备份。
  - 该顺序保证备份与删除对象完全一致，失败时 tombstone 可安全回滚。
- 依赖：
  - 新增 `fs2 = "0.4.3"`。

### RED / GREEN

1. 跨独立 `BackupRepository`：
   - RED：第二个实例可同时进入索引事务窗口，聚焦测试失败。
   - GREEN：第二个实例在第一个释放锁前无法进入；最终索引保留两条备份。
2. pause 与 paused delete：
   - RED：缺少跨 Repository 共享锁入口，无法序列化暂停索引事务。
   - GREEN：pause 等待 delete 完成，暂停索引最终仅保留新暂停记录。
3. resume 与 paused delete：
   - GREEN：resume 等待 delete 完成，两个索引更新均保留，最终暂停索引为空。
4. 删除回滚竞态空目标：
   - RED：普通 rename 覆盖竞态空目录。
   - GREEN：返回 `RollbackFailed`，空目标不变，tombstone 保留。
5. 跨设备 source tombstone 回滚：
   - RED：普通 rename 覆盖竞态空目录。
   - GREEN：no-replace 回滚拒绝覆盖并保留 tombstone。
6. restore 最终状态：
   - RED：注入 paused/错误路径详情时错误返回成功并遗留目标。
   - GREEN：返回 `BackupVerificationFailed` 并清理已提交目标。
7. restore 与 pause：
   - GREEN：pause 在 restore 事务释放锁后执行；最终只有一个 paused 状态，无 active/paused 双状态。

所有并发测试使用 channel、可注入 hook 和事务进入点同步，没有使用 `sleep` 制造竞态。

### 最终验证

1. `cargo fmt --check`
   - `CARGO_EXIT_CODE=0`
2. `cargo test backup_repository`
   - `CARGO_EXIT_CODE=0`
   - 25 passed，0 failed。
3. `cargo test`
   - `CARGO_EXIT_CODE=0`
   - lib：63 passed，0 failed。
   - main：0 failed。
   - doc-tests：0 failed。

### Concerns

- `fs2` 文件锁是操作系统级 advisory lock；仓库内所有相关事务均已统一使用，外部不遵守该锁协议的程序仍不受约束。
- Linux/Windows no-replace 分支未在当前 macOS 环境执行，macOS 分支与全部并发/回滚行为测试已通过。

---

## Task 5 备份索引失败测试修正

### 问题

原测试在创建应用事务锁文件前将 `app_data_dir` 改为只读，可能在加锁阶段提前失败，无法证明“正式归档已经提交后，backup-index 原子写失败并触发归档清理”。

### 修正

- 移除依赖 Unix 权限的 chmod 故障模拟。
- 增加仅在测试编译下可用的 `create_backup_with_index_writer` 注入点。
- 生产路径仍调用原有 `write_records`，未改变生产语义。
- 注入闭包在收到待写记录时先断言正式 `archive_path` 已存在，再返回结构化 `BackupIndex` 错误。

### RED / GREEN

- RED：
  - 聚焦测试编译失败，缺少精确索引写入注入点。
  - `CARGO_EXIT_CODE=101`。
- GREEN：
  - 聚焦测试通过，`CARGO_EXIT_CODE=0`。
  - 已证明：
    1. 正式归档在索引写入前已经提交。
    2. 索引写入返回 `BackupIndex` 错误。
    3. 失败后正式归档目录被清理。
    4. 源 Skill 目录及 `SKILL.md` 内容保持不变。
    5. 原 backup-index 仍为空，无新增记录。

### 验证

- `cargo fmt --check`
  - `CARGO_EXIT_CODE=0`
- `cargo test backup_repository`
  - `CARGO_EXIT_CODE=0`
  - 25 passed，0 failed。

### Concerns

- 无新增生产语义风险；故障注入入口受 `#[cfg(test)]` 限制。
