# Skill Manager 最终审查修复报告

## 状态

已完成最终审查中的 Important/Minor 修复：

- 恢复备份时强制归档位于 `backups`，目标位于记录 provider 对应的 Skill 根目录。
- 恢复暂停项时强制目标为记录的 `original_path`，并校验 original/paused 路径分别属于对应 provider 根目录。
- 暂停、恢复和跨设备复制提交统一使用原子 no-replace 重命名，竞态产生的空目录也不会被覆盖。
- `scan_skills` 返回 `{ skills, warnings }`；不可用根目录产生中文警告且不阻断其它 provider。
- 前端展示扫描警告，启动时加载真实备份数量并显示在侧栏。
- 启用桌面 CSP，仅允许本地 asset/ipc/开发 localhost；Markdown 图片不渲染，避免远程图片外联。
- 增加索引路径篡改、错误 provider、根目录隔离、空目录竞态、扫描警告、CSP 图片行为及备份数量测试。

## 验证

- `npm run test`：通过，21 个测试。
- `npm run typecheck`：通过。
- `cargo fmt --check`：通过。
- `cargo clippy --all-targets --all-features -- -D warnings`：通过。
- `cargo test`：通过，75 个 Rust 单元测试，0 失败。

## Concerns

- npm 输出已有的 `always-auth` 配置弃用警告，不影响本次测试和类型检查。
- CSP 为 Vite 开发模式保留了 localhost:1420 与对应 WebSocket；生产策略未开放远程网络。
