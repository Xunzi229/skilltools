# Task 4：暂停与恢复 Skill

## 约束

- Rust 工作目录：`/Users/xuzhi/github/skilltools/app/src-tauri`
- 所有命令逐条执行；使用 TDD；不初始化 Git、不提交。
- 只实现暂停、恢复、暂停索引以及扫描合并暂停项，不实现备份或 Tauri Command。
- 目标冲突时停止，不覆盖。
- 索引失败必须回滚目录移动，避免索引与文件状态不一致。
- 所有路径在操作前通过 `AppPaths::assert_allowed`。
- 符号链接只复制链接本身，不跟随到允许目录外。

## 接口

扩展 `SkillRepository`：

```rust
pub fn pause(&self, skill_id: &str) -> Result<SkillDetail, AppError>;
pub fn resume(&self, skill_id: &str) -> Result<SkillDetail, AppError>;
```

`scan()` 必须合并 `paused-index.json` 中仍存在的暂停项，状态为 `Paused`，`original_path` 保持原路径，`current_path` 为停用目录。`detail()` 同时支持 active 和 paused ID。

## 索引格式

使用现有 `Vec<PauseRecord>` 直接序列化为 JSON。索引不存在表示空列表；非法 JSON 返回结构化错误，不静默清空。

原子写入：

1. 确保应用数据目录存在。
2. 写入同目录唯一临时文件。
3. `sync_all`。
4. `rename` 替换正式索引。
5. 失败时清理临时文件。

如果 Windows 不支持直接替换已存在文件，可在明确保护旧文件的前提下采用备份替换；macOS 首版必须原子。

## 暂停流程

1. 仅在 active 扫描结果中按 ID 找 Skill；paused ID 再次暂停返回清晰错误。
2. 目标为 `disabled/<provider>/<原目录名>`，provider 文件夹为 `cursor|claude|codex`。
3. 目标存在返回 `TargetConflict`。
4. 创建 provider 停用目录。
5. 移动完整 Skill 目录。
6. 追加 `PauseRecord` 并原子写索引。
7. 索引写入失败时将目录移回原路径；回滚失败时保留原始错误上下文。
8. 返回暂停后的 `SkillDetail`。

## 恢复流程

1. 从索引按 skill_id 定位记录，不存在返回 `SkillNotFound`。
2. 原始目标存在返回 `TargetConflict`，停用目录保持不变。
3. 移回原始路径。
4. 从索引删除记录并原子写入。
5. 索引写入失败时移回停用目录。
6. 返回 active `SkillDetail`。

## 移动

优先 `fs::rename`。仅在跨文件系统错误时：

1. 复制到目标同级唯一临时目录。
2. 递归复制普通文件和目录；符号链接只复制链接。
3. 比较源与临时目录的相对文件清单及每个普通文件 SHA-256。
4. 临时目录原子 rename 到目标。
5. 删除源目录。

其它 rename 错误直接返回，不得误当跨文件系统。

## TDD 最少覆盖

- pause 后原路径消失、停用路径存在、scan 状态为 Paused。
- resume 后回原路径、scan 状态为 Active。
- 暂停目标冲突不移动源。
- 恢复目标冲突不移动暂停项。
- 索引写入失败时暂停和恢复都回滚目录移动。
- 非法 paused-index 返回错误而非丢记录。
- detail 可读取暂停项 Markdown 与文件清单。
- 重复暂停返回错误。

先记录 RED，再实现。最终逐条运行：

```bash
cargo fmt --check
cargo test pause
cargo test resume
cargo test
```

## 报告

写入 `/Users/xuzhi/github/skilltools/.superpowers/sdd/task-4-report.md`，包含状态、文件、RED/GREEN、命令结果、自检和 concerns。最终只返回状态、一行测试摘要与 concerns。
