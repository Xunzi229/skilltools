# Skill Manager Task 3 报告

## 状态

完成：仅实现启用目录的 Skill 扫描与详情读取，未实现暂停、恢复、备份或 Tauri Command。

## 文件

- 新增 `app/src-tauri/src/skill_repository.rs`
  - `SkillRepository::new`
  - `SkillRepository::scan`
  - `SkillRepository::detail`
  - frontmatter 解析、SHA-256 稳定 ID、文件清单及 8 个单元测试
- 修改 `app/src-tauri/src/lib.rs`
  - 导出 `skill_repository` 模块
- 未修改 `model.rs`

## TDD：RED / GREEN

### RED

先创建覆盖必需行为的测试，再执行：

`cargo test skill_repository`

结果：失败（退出码 101）。预期失败原因为 `SkillRepository` 尚未实现：

`unresolved import super::SkillRepository`

### GREEN

实现最小功能后执行 `cargo test skill_repository`。首次编译暴露 `sha2 0.11` 摘要类型不实现 `LowerHex`，改为逐字节生成两位十六进制字符串；随后 8 个模块测试全部通过。

## 命令结果

- `cargo fmt --check`：通过（退出码 0）
- `cargo test skill_repository`：通过，8 passed / 0 failed
- `cargo test`：通过，19 passed / 0 failed；Doc-tests 0 failed

## 行为自检

- [x] 遍历 Cursor、Claude、Codex 三个启用根目录
- [x] 根目录不存在视为空，其他根目录读取错误与单条目录项错误不阻断后续扫描
- [x] 只识别根目录直接子目录，忽略普通文件
- [x] 扫描根目录和 Skill 目录前调用 `AppPaths::assert_allowed`
- [x] 合法独立行 `---` frontmatter 提取 `name`、`description`
- [x] Markdown 正文不误解析为 YAML
- [x] 非法 YAML 回退目录名并添加中文 warning
- [x] `SKILL.md` 缺失或不可读时保留 Skill 并添加中文 warning
- [x] ID 输入精确使用 `"{provider:?}:{original_path_display}"` 并生成 64 位 SHA-256 小写十六进制
- [x] 按名称不区分大小写排序，同名按 ID 排序
- [x] `detail` 通过当前扫描结果定位，未知 ID 返回 `SkillNotFound`
- [x] 返回原始 Markdown 和按相对路径字符串排序的文件清单
- [x] 文件清单包含普通文件及符号链接，不包含目录且不跟随符号链接
- [x] 测试仅使用 `tempfile`，不访问真实用户 home
- [x] 未实现暂停、恢复、备份、Command

## Concerns

- `SkillSummary` 当前没有承载“根目录级扫描错误”的字段；非 `NotFound` 根目录读取错误会按隔离要求跳过，不会阻断其他来源，但调用方无法从扫描结果获知被跳过根目录的具体错误。

## Task 3 复核修复

### 修复

- `scan` 不再把 `file_type` 失败的未知条目直接构造为可操作 Skill：仅当后备元数据确认其为目录时，保留目录名回退的 `SkillSummary` 并附中文 warning；无法确认时隔离且不伪造 Skill。
- 可归属具体路径的 `file_type`、路径白名单及解析错误均有中文 warning 或隔离日志；白名单拒绝的路径不会进入结果。
- 根级 `read_dir` 和无法取得路径的 `DirEntry` 错误继续按根隔离，不阻断其它根，不构造虚假 Skill。
- `detail` 显式处理每个 `WalkDir` 错误并追加“文件清单可能不完整”中文 warning，不再静默过滤错误。
- 新增 4 个聚焦测试，覆盖安全文件类型回退、无法确认目录时拒绝、白名单拒绝越界 Skill、详情遍历错误 warning。

### RED

- `cargo test skill_repository::tests::file_type_error_keeps_summary_only_when_metadata_confirms_directory`
- 结果：失败（退出码 101），预期失败原因为 `recover_summary_after_file_type_error` 尚未实现。

### GREEN

- 4 个聚焦测试逐条通过：安全回退、拒绝未知目录、拒绝越界路径、详情遍历 warning，均为 `1 passed / 0 failed`。
- `cargo fmt --check`：通过（退出码 0）。
- `cargo test skill_repository`：通过，`12 passed / 0 failed`。
- `cargo test`：通过，`23 passed / 0 failed`；Doc-tests `0 failed`。

### 复核 Concerns

- 现有 `scan -> Result<Vec<SkillSummary>, AppError>` 无法向调用方返回根级或无路径 `DirEntry` 的结构化 warning；当前仅输出中文隔离日志，这是在不改变接口且不伪造 Skill 前提下的限制。
- 当 `file_type` 与后备元数据均失败时无法安全确认条目是 Skill 目录，因此只记录中文隔离日志，不生成可操作的 `SkillSummary`。

## Task 3 Important 复核修复

### 修复

- `file_type` 失败但后备 metadata 确认目录时，先通过 `read_summary` 解析 `SKILL.md`，再追加文件类型中文 warning。
- 合法 frontmatter 的 `name`、`description` 在回退分支中正常保留。
- 非法 YAML 或缺失 `SKILL.md` 时，同时保留原解析 warning 与文件类型 warning。

### RED

- 合法 frontmatter 聚焦测试失败：实际名称仍为目录名 `fallback-skill`，未解析为 `Parsed Name`。
- 非法 YAML 聚焦测试失败：缺少 `YAML 格式错误` warning。
- 缺失 `SKILL.md` 聚焦测试失败：缺少 `无法读取 SKILL.md` warning。
- 三项 RED 均为 `0 passed / 1 failed`，符合预期缺陷。

### GREEN

- 三项聚焦测试逐条通过，均为 `1 passed / 0 failed`。
- `cargo fmt --check`：通过（退出码 0）。
- `cargo test skill_repository`：通过，`14 passed / 0 failed`。

