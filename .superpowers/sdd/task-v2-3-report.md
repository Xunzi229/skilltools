# Skill Manager V2 Task 3 报告

## 状态

已完成。

- 新增库 Skill 按 Provider 安装、卸载及安装记录查询。
- 安装目标为 Provider Skill 根目录下以 Skill 名称命名的符号链接。
- 仅允许更新、删除 `library-index.json` 中记录的受管符号链接；真实目录和非受管链接返回 `TargetConflict`。
- 安装记录持久化到 `library-index.json`，库 Skill 摘要包含 `installedProviders`。
- 安装与卸载复用应用事务锁和 Provider 根目录白名单校验。
- 已注册 `install_skill`、`uninstall_skill`、`list_installations` Tauri Command。
- 错误继续使用现有中文消息及稳定错误码。

## TDD 与测试摘要

红阶段确认新增接口缺失，随后完成实现并通过：

- `cargo test library_repository::tests::install_creates_symlink_and_persists_status`：1 passed
- `cargo test library_repository::tests`：10 passed
- `cargo fmt --check`：通过
- `cargo clippy --all-targets --all-features -- -D warnings`：通过
- `cargo test`：94 passed，0 failed

新增覆盖：

- 创建符号链接并持久化安装状态
- 更新受管符号链接
- 拒绝真实目录与非受管链接冲突
- 卸载仅删除受管链接
- 拒绝 Skill 名称路径越界

## Concerns

- Windows 创建符号链接仍受系统开发者模式或用户权限限制。
- 删除项目或 Git 同步后源 Skill 消失时，现有安装记录和链接不会自动清理；本任务未定义该生命周期行为。
