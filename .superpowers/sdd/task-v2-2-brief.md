# Task V2-2：中央库、本地/Git 项目、标签与分组

## 约束

- 工作目录：`/Users/xuzhi/github/skilltools/app`
- TDD；命令逐条执行；不初始化 Git、不提交
- 规格：`docs/superpowers/specs/2026-08-07-skill-library-apply-design.md`
- 计划 Task 2
- 复用 `transaction_lock`、`json_store`、`paths`、现有 frontmatter 解析
- 本任务不做符号链接安装（Task 3）与完整前端导航（Task 4）；可暴露最小 Command 供后续接入

## 交付

1. 新建 `library_repository.rs`、`git_ops.rs`
2. `library-index.json` 统一存 projects / librarySkills 元数据引用 / tags / groups
3. 本地项目：引用路径，不复制
4. Git：URL 白名单校验；`git clone` 到 `library/projects/<id>/`；`git pull --ff-only`
5. 库扫描：仅含 `SKILL.md` 的目录；项目根含 SKILL.md 则单 Skill
6. 标签多选、分组单选 CRUD + set_skill_tags/set_skill_group
7. 删除标签/分组只清引用
8. Command 注册；错误中文 + 稳定 code
9. 聚焦与全量 `cargo test`、fmt、clippy

## 关键接口

```rust
add_local_project(path: String) -> Project
add_git_project(url: String) -> Project
pull_git_project(project_id: String) -> Project
remove_project(project_id: String) -> ()
list_projects() -> Vec<Project>
list_library_skills() -> Vec<LibrarySkillSummary>
get_library_skill_detail(id: String) -> LibrarySkillDetail
// tag/group CRUD + setters
```

Git URL 允许：`https://`、`git://`、`ssh://`、`git@host:path`
禁止 shell 拼接；参数化 Command。

## 报告

`/Users/xuzhi/github/skilltools/.superpowers/sdd/task-v2-2-report.md`
最终只返回状态、测试摘要、concerns。
