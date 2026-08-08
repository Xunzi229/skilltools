# Skill Manager V2 Task 1 验收报告

## 状态

实现完成。扫描过滤、目录树、受限文件预览、两个 Tauri Command、前端文件树与默认 `SKILL.md` 预览均已落地。

## 实现摘要

- 工具 Skill 根目录仅保留直接子目录中包含常规文件 `SKILL.md` 的项；过滤普通文件、隐藏目录及无 `SKILL.md` 目录。
- 新增 `skill_files.rs`：
  - `list_skill_tree(skill_id)` 递归返回排序后的目录树、相对路径、节点类型与文件大小。
  - 不递归跟随符号链接。
  - `read_skill_file(skill_id, relative_path)` 拒绝绝对路径、`..` 逃逸及符号链接路径。
  - Markdown 与常见文本类型可读；超过 512 KiB、二进制或非文本扩展名返回 `unsupported`。
- 新增并注册 `list_skill_tree`、`read_skill_file` Tauri Command。
- 前端 API 与类型新增 `FileNode`、`FileContent`。
- Skill 详情打开时加载目录树并默认预览 `SKILL.md`；点击文件切换 Markdown/文本预览，不渲染 Markdown 远程图片。

## TDD 记录

1. 扫描过滤 RED：新测试期望仅返回有效 Skill，实际返回 3 项。
2. 扫描过滤 GREEN：实现 `SKILL.md`、隐藏目录过滤后通过。
3. 文件能力 RED：目录树、Markdown/文本预览、逃逸、二进制/超限、符号链接 5 项测试均因未实现失败。
4. 文件能力 GREEN：实现 `skill_files` 后 5 项通过。
5. Command RED：测试因两个 state helper 不存在而编译失败。
6. Command GREEN：接入 helper 与 Tauri Command 后通过。
7. 前端 RED：目录树角色不存在，新增验收测试失败。
8. 前端 GREEN：新增 `FileTree`、`FilePreview` 并接入详情后，22 项前端测试通过。

## 验收命令

- `cargo fmt --check`：通过（首次发现格式差异，执行 `cargo fmt` 后复查通过）。
- `cargo test`：通过，83 passed，0 failed。
- `npm run test`：Vitest 输出 1 个测试文件、22 passed、0 failed；测试完成后外层命令未正常回收，手动终止后执行器记录为 unknown exit code。
- `npm run typecheck`：通过，退出码 0，无类型错误。

## Concerns

- `npm run test` 已明确输出 22 项全绿，但外层进程未正常回收，手动终止后执行器未保留正常退出码。
- npm 输出已有环境级警告：用户配置 `always-auth` 将在下一 npm 主版本停止支持；与本任务代码无关。

## Follow-up Fix（复核后）

针对 [复核 V2 Task1](bba5fa05-0da5-48fb-b3b2-e9adee637aae) 的两项 P2：

1. `looks_binary`：拒绝 NUL 与非常见控制字符，即使内容仍是合法 UTF-8。
2. `build_tree`：改用 `symlink_metadata`，符号链接作为不透明文件节点，不跟随目标；断链不再导致整棵树失败。

验证：`cargo test skill_files` 通过（exit 0）。
