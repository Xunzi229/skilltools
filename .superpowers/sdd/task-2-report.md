# Task 2 执行报告

## 状态

完成。

已按 brief 完成 Rust 领域模型、统一错误、路径边界与依赖配置，未实现扫描、暂停或备份业务。

## 文件

- `app/src-tauri/src/model.rs`：领域枚举与结构体，前端字段使用 camelCase 序列化。
- `app/src-tauri/src/error.rs`：`AppError` 与 `From<std::io::Error>`。
- `app/src-tauri/src/paths.rs`：三个 Skill 根、应用目录及安全路径边界。
- `app/src-tauri/src/lib.rs`：导出 `error`、`model`、`paths` 模块。
- `app/src-tauri/Cargo.toml`、`Cargo.lock`：任务要求的运行与测试依赖。
- `.superpowers/sdd/task-2-report.md`：本报告。

## RED / GREEN 证据

- RED：先创建路径测试后执行 `cargo test paths`，退出码 101；缺少 `AppPaths` 与 `Provider`，证明测试先于实现失败。
- RED：先创建模型和错误测试后执行 `cargo test model`，退出码 101；缺少领域类型与 `AppError`。
- GREEN：实现后 `cargo test paths` 通过，8 passed、0 failed。
- GREEN：实现后 `cargo test model` 通过，1 passed、0 failed。
- GREEN：`cargo test error` 通过，1 passed、0 failed。
- 路径测试额外覆盖普通 `..`、符号链接、悬空符号链接及其后代逃逸。

## 命令结果

- brief 指定的 7 条 `cargo add` 命令均成功。
- `cargo fmt --check`：通过，退出码 0。
- `cargo test paths`：通过，8 passed，0 failed。
- `cargo test model`：通过，1 passed，0 failed。
- `cargo test`：通过，10 passed，0 failed；二进制测试与文档测试均无失败。

## 自检

- [x] 仅处理模型、错误和路径边界。
- [x] 所有面向前端的模型均实现 `Serialize`、`Deserialize` 和 camelCase。
- [x] `AppError` 文案和值与 brief 一致，IO 错误映射正确。
- [x] 三个默认 Skill 根目录为 `.cursor/skills`、`.claude/skills`、`.codex/skills`。
- [x] 仅允许 Skill 根、disabled、backups 自身及后代。
- [x] 支持尚不存在的目标路径。
- [x] canonicalize 最近存在父目录后拼回缺失路径段。
- [x] 拒绝普通 `..` 逃逸。
- [x] 拒绝符号链接和悬空符号链接逃逸。
- [x] 未实现扫描、暂停或备份业务。
- [x] 未初始化 Git、未提交。

## Concerns

- 符号链接回归测试使用 Unix `symlink` API，并以 `#[cfg(unix)]` 限定；Windows 不执行该用例，但生产路径解析逻辑未使用平台专属代码。

## Critical 复核修复：悬空符号链接

### 修复说明

`resolve_path` 原先使用 `Path::exists()` 查找最近存在父目录。该 API 会跟随符号链接，因此悬空链接会被误判为普通的不存在路径段，随后按允许目录内的缺失段拼回，导致悬空链接自身及其后代错误通过边界校验。

现改为逐级调用 `symlink_metadata()`：

- 普通不存在路径段仅在 `NotFound` 时逐级回退并记录。
- 即使符号链接目标不存在，`symlink_metadata()` 仍能识别链接自身。
- 对识别到的最近存在路径执行 `canonicalize()`，解析真实符号链接目标。
- 悬空符号链接无法 canonicalize 时返回 `PathOutsideManagedRoots`。
- 其他元数据或 canonicalize 错误继续映射为 `AppError::Io`。

### 测试文件

`app/src-tauri/src/paths.rs`

新增聚焦回归测试：

- `rejects_dangling_symlink_in_managed_root`
- `rejects_descendant_of_dangling_symlink`
- `rejects_parent_traversal_through_dangling_symlink`

### RED 证据

命令：`cargo test dangling_symlink`

修复前结果：退出码 101；3 个聚焦测试中 1 个通过、2 个失败。悬空链接自身和其后代被错误接受；悬空链接结合 `..` 已被拒绝。

### GREEN 与最终验证

- `cargo test dangling_symlink`：通过，3 passed，0 failed。
- `cargo fmt --check`：通过，退出码 0。
- `cargo test paths`：通过，8 passed，0 failed。
- `cargo test`：通过，10 passed，0 failed；二进制测试与文档测试均无失败。

### 本次 Concerns

- 三个悬空符号链接回归测试使用 Unix `symlink` API，并以 `#[cfg(unix)]` 限定；Windows 不执行这些测试。生产解析逻辑使用 Rust 标准库跨平台 API。

## Important 复核修复：无效允许根阻断后续校验

### 修复说明

`AppPaths::assert_allowed` 遍历允许根时，原先对单个根调用 `resolve_path(root)?`。若较早的 Cursor 根为悬空符号链接，`?` 会提前返回错误，导致后续 Claude 根、disabled、backups 等合法路径无法被校验。

现改为对每个允许根单独解析：解析失败则跳过该根并继续检查其它根；待校验 path 自身在入口处仍通过 `resolve_path(path)?` 安全拒绝。

### 测试文件

`app/src-tauri/src/paths.rs`

新增聚焦回归测试：

- `allows_paths_when_earlier_root_is_dangling_symlink`

### RED 证据

命令：`cargo test allows_paths_when_earlier_root_is_dangling_symlink`

修复前结果：退出码 101；1 个聚焦测试失败。Cursor 根为悬空符号链接时，Claude 根、disabled、backups 下的合法路径被错误拒绝。

### GREEN 与最终验证

- `cargo test allows_paths_when_earlier_root_is_dangling_symlink`：通过，1 passed，0 failed。
- `cargo fmt --check`：通过，退出码 0。
- `cargo test paths`：通过，9 passed，0 failed。

### 本次 Concerns

- 该回归测试使用 Unix `symlink` API，并以 `#[cfg(unix)]` 限定；Windows 不执行此用例。生产路径解析逻辑未使用平台专属代码。
