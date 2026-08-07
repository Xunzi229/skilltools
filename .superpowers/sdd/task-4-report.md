# Task 4 实施报告

## 状态

已完成。

## 文件

- `app/src-tauri/src/skill_repository.rs`
- `app/src-tauri/src/paths.rs`
- `app/src-tauri/src/error.rs`

## RED / GREEN

- RED：先新增暂停、恢复、冲突、索引损坏、重复暂停、详情读取及索引失败回滚测试。
- RED 证据：`cargo test pause` 退出码 101，因 `SkillRepository::pause` / `resume` 尚不存在而按预期失败。
- GREEN：增量实现暂停索引读取与原子写入、暂停/恢复及失败回滚、paused 扫描合并、paused detail、跨文件系统校验复制。

## 命令结果

- `cargo fmt --check`：通过。
- `cargo test pause`：通过，7 passed。
- `cargo test resume`：通过，3 passed。
- `cargo test`：通过，33 passed；Doc-tests 通过。

## 自检

- 暂停后原路径消失、provider 停用路径存在，扫描状态为 `Paused`。
- 恢复后回到原路径，扫描状态为 `Active`。
- 暂停与恢复目标冲突均不移动源目录。
- 暂停与恢复索引写入失败均回滚目录移动。
- 非法 `paused-index.json` 返回 `PauseIndex`，原内容不被清空。
- `detail()` 可读取暂停项 Markdown 与排序后的文件清单。
- 重复暂停返回 `SkillAlreadyPaused`。
- 操作路径经过 `AppPaths::assert_allowed`。
- 跨文件系统时复制到目标同级临时目录，符号链接不跟随，普通文件以 SHA-256 校验后再切换目标并删除源。
- 未实现备份功能或 Tauri Command。

## Concerns

- 当前环境未实际制造跨文件系统挂载点，因此跨文件系统 fallback 已实现但未触发端到端执行；常规 rename、索引原子替换及回滚路径均已由测试覆盖。

## 复核修复

### 状态

已完成复核提出的全部修复。

### RED / GREEN

- 新增聚焦测试后先运行 `cargo test cross_device`，退出码 101；因可注入提交 helper 尚不存在而按预期 RED。
- 提取可注入文件操作 helper，稳定覆盖目标提交失败、tombstone 清理失败和旧索引清理失败。
- `cargo test cross_device`：GREEN，2 passed。
- `cargo test successful_index_replacement`：GREEN，1 passed。
- `cargo test occupied_original_path`：GREEN，1 passed。

### 修复内容

- 跨文件系统复制校验后，先将源目录原子改名为同文件系统唯一 tombstone，再提交正式目标。
- 正式目标提交失败时，将 tombstone 原子恢复为源目录；目标提交成功后的 tombstone 清理失败仅输出隔离日志，不再返回业务失败。
- 残留 tombstone 使用独立唯一名称，不占用原路径；反向移动仍可恢复正式原路径。
- Windows 旧索引在新索引提交成功后的清理失败仅输出隔离日志，不再触发目录错误回滚。
- paused 原路径被重新创建时，扫描删除同 ID active 项，保留 paused 项并追加“原路径已被占用，保留暂停项”警告；`detail(id)` 读取 paused 目录。

### 最终命令结果

- `cargo fmt --check`：通过。
- `cargo test pause`：通过，8 passed。
- `cargo test resume`：通过，3 passed。
- `cargo test`：通过，37 passed；Doc-tests 通过。

### Concerns

- 当前 macOS 环境未执行 Windows 文件系统真实替换，但平台无关的注入测试已覆盖“新索引提交成功、旧索引清理失败仍成功”分支。
- 未使用真实跨文件系统挂载点；提交顺序、提交失败恢复、清理失败非致命及反向恢复均通过注入式文件系统失败测试覆盖。
