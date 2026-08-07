# Task 5：备份、删除与备份恢复

## 约束

- Rust 工作目录：`/Users/xuzhi/github/skilltools/app/src-tauri`
- 使用 TDD；命令逐条执行；不初始化 Git、不提交。
- 不实现 Tauri Command 或前端。
- 备份是完整目录副本，不跟随符号链接。
- 删除必须在 `beforeDelete` 备份和备份索引都成功后执行。
- 恢复目标存在时停止，绝不覆盖或合并。
- 所有路径操作使用 `AppPaths::assert_allowed`。
- 可提取 `fs_ops.rs`、`json_store.rs` 复用 Task 4 的复制校验与原子 JSON 写逻辑，禁止复制同一套事务代码。

## 接口

创建 `src/backup_repository.rs`：

```rust
pub struct BackupRepository {
    paths: AppPaths,
}

impl BackupRepository {
    pub fn new(paths: AppPaths) -> Self;
    pub fn create_backup(
        &self,
        skill_id: &str,
        reason: BackupReason,
    ) -> Result<BackupRecord, AppError>;
    pub fn list_backups(&self) -> Result<Vec<BackupRecord>, AppError>;
    pub fn restore_backup(&self, backup_id: &str) -> Result<SkillDetail, AppError>;
    pub fn delete_skill(&self, skill_id: &str) -> Result<BackupRecord, AppError>;
}
```

在 `lib.rs` 导出模块。可按必要最小范围为 `SkillRepository` 增加 `pub(crate)` 协作接口，但不能暴露任意路径删除。

## 备份

1. 通过 Skill ID 获取当前 active 或 paused 详情。
2. 备份目标为 `backups/<skill-id>/<UTC timestamp>-<uuid>/`；时间戳使用文件名安全格式。
3. 先复制到同父目录 `.tmp-<uuid>`。
4. 复制前计算源清单，复制后再次计算源清单和临时目录清单。三者必须一致，否则删除临时目录并返回错误，确保操作期间源变化不会生成有效备份。
5. 清单按相对路径排序，包括目录、普通文件 SHA-256、符号链接目标；不跟随链接。
6. 备份 `checksum` 是规范化清单序列化后的 SHA-256。
7. 校验成功后将临时目录原子 rename 为正式目录。
8. 将 `BackupRecord` 追加到 `backup-index.json` 并原子写入。
9. 索引写入失败时删除刚生成的正式备份；清理失败需记录但返回原始索引错误。
10. `list_backups` 在索引不存在时返回空列表；非法 JSON 返回结构化错误；结果按 `created_at` 降序，同时间按 id 排序。

## 删除

1. 调用 `create_backup(skill_id, BackupReason::BeforeDelete)`。
2. 备份及索引成功后，把 Skill 当前目录同文件系统原子 rename 为唯一 tombstone，使用户可见路径立即消失且可回滚。
3. 如果删除 paused Skill，原子移除对应 `PauseRecord`；索引失败时将 tombstone 改回原位置。
4. 删除 tombstone。清理失败只记录隔离日志，逻辑删除仍成功，返回备份记录。
5. 自动备份失败时不得移动或删除源。

## 恢复备份

1. 按 backup_id 从索引定位，找不到返回结构化错误（可新增 `BackupNotFound`）。
2. 重新计算 archive 清单和 checksum，与记录不一致返回 `BackupVerificationFailed`。
3. 恢复目标为记录中的 `original_path`，先做白名单校验。
4. 目标已存在返回 `TargetConflict`。
5. 复制到目标同级 `.restore-<uuid>`，校验临时副本与 archive 清单一致。
6. 原子 rename 为正式目标。
7. 返回通过 `SkillRepository::detail(skill_id)` 读取的 active `SkillDetail`。
8. 任一步失败清理临时目录，不改变已有 Skill。

## TDD 最少覆盖

- 手动备份创建版本目录、索引记录和正确 checksum。
- 同一 Skill 多次备份都保留，列表倒序。
- 备份复制失败或源在复制期间变化时不写索引、不留正式备份。
- 备份索引写失败时源不变且清理正式备份。
- 删除生成 `BeforeDelete` 记录后源路径消失。
- 自动备份失败时源仍存在。
- 删除 paused Skill 后暂停索引记录移除。
- 暂停索引更新失败时删除回滚。
- 恢复成功后内容与备份一致。
- 恢复目标冲突不覆盖。
- 备份内容被篡改时恢复失败。
- 非法备份索引返回错误。
- 符号链接被按链接备份，不读取外部目标。

先记录 RED，再实现。最终逐条运行：

```bash
cargo fmt --check
cargo test backup_repository
cargo test
```

## 报告

写入 `/Users/xuzhi/github/skilltools/.superpowers/sdd/task-5-report.md`，包含状态、文件、RED/GREEN、命令结果、自检、concerns。最终只返回状态、一行测试摘要与 concerns。
