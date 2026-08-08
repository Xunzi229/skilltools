# Task V2-4：前端库导航与操作接入

## 约束

- 工作目录：`/Users/xuzhi/github/skilltools/app`
- TDD；命令逐条执行；不初始化 Git、不提交
- 后端 Command 已由 Task 2/3 提供；前端类型化 API 调用它们
- 保留现有已安装/暂停/备份流程与文件树预览

## 交付

1. 扩展 `model/skill.ts` 与 `api/skillApi.ts`：项目、库 Skill、标签、分组、安装相关类型与方法
2. `useLibrary` hook：加载项目/库 Skill/标签/分组；增删改；安装/卸载；Git 拉取
3. Sidebar 扩展：Skill 库、分组、标签、项目、已安装、已暂停、备份
4. Library 中栏列表 + 右栏详情：
   - 标签编辑、分组选择
   - Cursor/Claude/Codex 安装开关
   - 复用文件树/预览（库 Skill 需能通过 skillId 或复用 read API；若库 Skill 与已安装 ID 体系不同，为库详情增加 `list_library_skill_tree`/`read_library_skill_file` 最小后端补充，或让库详情调用已有路径安全读取 Command）
5. ProjectPanel：添加本地路径、Git URL、拉取、移除
6. 中文错误、pendingAction 防重、冲突提示
7. 测试覆盖：导航、标签分组、安装开关冲突、项目添加/拉取错误展示

若库 Skill 文件树无法复用已安装 `skill_id`，允许最小后端补充：
- `list_library_skill_tree(id)`
- `read_library_skill_file(id, relative_path)`
路径必须在库 Skill 目录内。

## 验证

```bash
cd /Users/xuzhi/github/skilltools/app
npm run test
npm run typecheck
npm run build
cd src-tauri
cargo test
```

## 报告

`/Users/xuzhi/github/skilltools/.superpowers/sdd/task-v2-4-report.md`
最终只返回状态、测试摘要、concerns。
