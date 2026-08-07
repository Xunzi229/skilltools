# Task V2-1：扫描过滤 + 目录树/文件预览

## 约束

- 工作目录：`/Users/xuzhi/github/skilltools/app`
- TDD；Bash 命令逐条执行；不初始化 Git、不提交
- 规格：`docs/superpowers/specs/2026-08-07-skill-library-apply-design.md`
- 计划：`docs/superpowers/plans/2026-08-07-skill-library-apply.md` Task 1

## 必须完成

1. **扫描过滤**
   - `skill_repository` 扫描工具根时：只保留直接子目录且存在 `SKILL.md` 的项
   - 普通文件、无 `SKILL.md` 的目录必须忽略
   - 补 RED/GREEN 测试

2. **目录树与文件预览**
   - 新建 `skill_files.rs`
   - 类型：
```rust
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum FileNodeKind { File, Directory }

pub struct FileNode {
  pub name: String,
  pub relative_path: String,
  pub kind: FileNodeKind,
  pub size: Option<u64>,
  pub children: Vec<FileNode>,
}

pub struct FileContent {
  pub relative_path: String,
  pub media_type: String, // "markdown" | "text" | "unsupported"
  pub content: Option<String>,
  pub message: Option<String>,
}
```
   - `list_skill_tree(skill_id)`：基于现有 scan/detail 定位 Skill，递归列目录，不跟随 symlink
   - `read_skill_file(skill_id, relative_path)`：规范化后必须位于 skill 目录内；拒绝 `..` 逃逸
   - 文本扩展名可读；超过 512KiB 或二进制返回 unsupported
   - 默认前端打开详情时加载树，并预览 `SKILL.md`

3. **Command / 前端**
   - 注册两个新 Command
   - API、SkillDetail 增加 FileTree + FilePreview
   - 测试覆盖过滤、树、预览、逃逸拒绝

## 验证（逐条）

```bash
cd /Users/xuzhi/github/skilltools/app/src-tauri
cargo fmt --check
cargo test
cd /Users/xuzhi/github/skilltools/app
npm run test
npm run typecheck
```

## 报告

写入 `/Users/xuzhi/github/skilltools/.superpowers/sdd/task-v2-1-report.md`  
最终只返回状态、测试摘要、concerns。
