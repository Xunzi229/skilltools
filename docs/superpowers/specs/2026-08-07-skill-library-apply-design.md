# Skill 库、打标分组与一键应用设计（V2）

## 1. 目标

在现有本地 Skill 管理器之上，增加中央 Skill 库能力：

- 管理本地目录与 Git 远程项目中的 Skill
- 支持标签（多选）与分组（单选）
- 通过符号链接一键应用到 Cursor、Claude、Codex
- 与现有暂停、备份、删除能力共存

本版采用“库优先分阶段”策略，不一次做成完整平台。

## 2. 核心模型

### 2.1 中央库

Skill 的唯一源内容位于应用库中：

```text
app-data/
├── library/
│   └── projects/
│       └── <project-id>/
│           └── <skill-dir>/SKILL.md
├── library-index.json
├── tags-index.json          # 可并入 library-index
├── groups-index.json        # 可并入 library-index
└── install-index.json       # 可并入 library-index
```

推荐将项目、Skill 元数据、标签、分组、安装映射统一写入 `library-index.json`，减少多文件一致性问题。

### 2.2 实体

#### Project

- `id`
- `name`
- `sourceType`: `local` | `git`
- `localPath`
- `remoteUrl`（Git 时）
- `addedAt`
- `lastSyncedAt`（Git 时）
- `warnings`

#### LibrarySkill

- `id`：稳定哈希，基于 `projectId + relativePath`
- `projectId`
- `name`
- `description`
- `relativePath`
- `absolutePath`
- `groupId`：可空，单选
- `tagIds`：多选
- `installations`：已安装工具列表摘要
- `warnings`

#### Tag

- `id`
- `name`
- `color`（可选，首版可用固定调色板）

#### Group

- `id`
- `name`
- `order`

#### Installation

- `librarySkillId`
- `provider`: `cursor` | `claude` | `codex`
- `linkPath`：工具目录中的符号链接路径
- `targetPath`：库内源路径
- `installedAt`

## 3. 项目来源

### 3.1 本地目录

1. 用户选择或输入本地路径。
2. 校验路径可读，且位于允许的用户文件系统范围内。
3. 以引用方式登记到索引；默认不复制文件到 `library/projects`。
4. 扫描该目录下可作为 Skill 的子目录。

### 3.2 Git 远程仓库

1. 用户输入 `https` / `git` / `ssh` URL。
2. 校验 URL 协议白名单。
3. 使用系统 `git clone` 克隆到 `library/projects/<project-id>/`。
4. 支持 `git pull --ff-only` 更新。
5. 从库中移除项目时：
   - Git 项目：删除本地 clone 目录与索引记录
   - 本地引用项目：只删除索引记录，不删除用户原目录
6. 不内嵌 Git 引擎；依赖本机 `git` 可执行文件。

### 3.3 Skill 扫描规则

- **库项目扫描为深度扫描**：递归遍历项目目录树，发现任意层级包含 `SKILL.md` 的目录即识别为 Skill（如 `skills/group/foo/SKILL.md`）。
- **仅识别包含 `SKILL.md` 的目录为 Skill**；无 `SKILL.md` 的目录、普通文件、隐藏目录一律过滤，不进入列表。
- 若某目录已是 Skill（含 `SKILL.md`），默认不再向下扫描其子目录，避免把 `agents/`、`rules/` 等包内文件误识别为新 Skill。
- **例外**：若 Skill 目录下存在约定子目录 `skills/`，则继续深度扫描该目录，将其中的 Skill 识别为**子 Skill**，并记录 `parentSkillId`。
- 若项目根本身包含 `SKILL.md`，则将该项目识别为 Skill；仅当存在根级 `skills/` 时继续扫描子 Skill。
- 工具目录扫描（已安装视图）仍只扫描各工具 Skill 根的直接子目录，保持与 Agent 约定一致。
- 不递归跟随符号链接。
- 存在 `SKILL.md` 但解析失败时仍保留条目，并附加中文 warning。

## 4. 标签与分组

- 标签：一个 Skill 可有多个标签；支持创建、重命名、删除标签。
- 分组：一个 Skill 最多属于一个分组；支持创建、重命名、排序、删除分组。
- 删除标签/分组时，只清除 Skill 上的引用，不删除 Skill 内容。
- 标签与分组只存在应用索引，不写回 `SKILL.md`。
- 左栏可按分组、标签筛选；中栏支持搜索名称与描述。

## 5. 一键应用（符号链接）

### 5.1 安装

对选定工具：

1. 解析目标路径：`~/.{cursor|claude|codex}/skills/<skill-name>`。
2. 路径白名单校验。
3. 若目标不存在：创建指向库内源目录的符号链接。
4. 若目标已是本应用管理的符号链接：更新指向并刷新安装记录。
5. 若目标是真实目录或其他非本应用链接：返回冲突，不覆盖。
6. 成功后写入 `Installation` 记录。

“本应用管理的符号链接”判定：

- 目标是符号链接；且
- 安装索引中存在对应 `librarySkillId + provider` 记录；且
- 链接当前目标仍位于该库 Skill 的允许路径内，或记录声明由其创建。

### 5.2 卸载

1. 仅删除本应用创建的符号链接。
2. 若目标是真实目录：拒绝，提示应使用现有删除/暂停流程。
3. 移除安装记录。

### 5.3 与现有能力关系

- 已安装到工具目录的符号链接会出现在现有“已安装/扫描”视图中。
- 暂停、备份、删除继续作用于工具目录安装态。
- 对符号链接 Skill：
  - 暂停：将链接移入停用区或记录暂停态（保持现有暂停语义，不破坏库源）
  - 删除：若为符号链接，默认只删链接并清理安装记录；若需删除库源，走库内删除确认
- 库源删除前，必须先卸载所有工具上的安装链接，或在确认后一并卸载。

## 6. 界面

保留三栏主从布局，扩展左栏导航：

- Skill 库（全部库内 Skill）
- 分组
- 标签
- 已安装（现有工具目录扫描）
- 项目
- 已暂停
- 备份记录

中栏：

- 库视图：搜索、按标签/分组筛选、显示安装状态徽标
- 项目视图：本地/Git 项目列表，支持添加、拉取、移除

右栏：

- Skill 详情、标签编辑、分组选择
- Cursor / Claude / Codex 安装开关
- Git 项目显示远程地址与“拉取更新”
- **目录结构 / 文件树**：展示该 Skill 目录下的文件夹与文件（不跟随外链）
- **文件预览**：点击文件树中的文件后，在详情区展示内容
  - `SKILL.md` 与常见 Markdown：渲染预览
  - 文本类文件（`.md`、`.txt`、`.json`、`.yaml`、`.yml`、`.toml`、`.rs`、`.ts`、`.js`、`.py`、`.sh` 等）：只读文本预览
  - 二进制或超大文件：显示“不支持预览”或大小限制提示，不加载全文
- 默认选中 `SKILL.md`（若存在）

文件读取必须经 Rust Command，且路径必须位于当前 Skill 目录白名单内。

## 7. Rust 服务边界

新增或扩展 Command（示意）：

- `list_projects` / `add_local_project` / `add_git_project` / `pull_git_project` / `remove_project`
- `list_library_skills` / `get_library_skill_detail`
- `list_skill_tree(skill_id)`：返回目录树节点（相对路径、类型、大小）
- `read_skill_file(skill_id, relative_path)`：返回受白名单约束的文件内容或预览拒绝原因
- `list_tags` / `create_tag` / `rename_tag` / `delete_tag` / `set_skill_tags`
- `list_groups` / `create_group` / `rename_group` / `delete_group` / `set_skill_group`
- `install_skill` / `uninstall_skill` / `list_installations`

所有破坏性操作复用现有共享事务锁与路径白名单。

Git 调用限制：

- 仅允许 `clone`、`pull --ff-only`、`rev-parse`、`remote get-url` 等只读/受控写命令
- 禁止任意 shell 拼接用户输入
- URL 与路径分别校验后再作为独立参数传入

## 8. 安全约束

- 符号链接只允许创建在三个工具 Skill 根目录内。
- 库扫描与安装目标都必须通过规范化路径边界检查。
- 不跟随外部符号链接递归扫描。
- 真实目录冲突一律停止。
- Git URL 仅允许 `https://`、`git://`、`ssh://`、`git@host:path` 形式。
- 前端无任意文件系统权限；全部经 Rust Command。

## 9. 异常处理

需区分并中文提示：

- 项目路径不存在/不可读
- 未找到 `git`
- clone/pull 失败
- 快进拉取冲突（需手动处理）
- 安装目标冲突
- 卸载目标不是本应用链接
- 标签/分组名称重复
- 库源缺失但安装记录仍在（标记失效并可清理）

## 10. 测试策略

### Rust

- 本地项目添加与扫描
- 扫描过滤无 `SKILL.md` 的目录与普通文件
- Git URL 校验
- 标签多选、分组单选持久化
- 安装创建符号链接
- 更新已有本应用链接
- 真实目录冲突不覆盖
- 卸载只删本应用链接
- 删除标签/分组只清引用
- 目录树列出与路径逃逸拒绝
- 文本文件预览与二进制/超大文件拒绝

### 前端

- 库/分组/标签/项目导航
- 标签与分组编辑
- 三工具安装开关与冲突提示
- Git 添加/拉取状态与错误
- Skill 详情内目录树与文件点击预览
- 与现有已安装、暂停、备份视图共存

### 构建

- 前端测试与类型检查
- Rust fmt / clippy / test
- macOS Tauri 开发构建

## 11. 首版范围外

- 批量一键应用
- 云同步与账号体系
- Skill 在线市场
- 在应用内编辑 `SKILL.md`
- Git 多分支切换、force push、冲突可视化合并
- 将现有工具目录 Skill 自动迁移入库
- Windows / Linux 打包验收

## 12. 验收标准

1. 可添加本地项目并列出其中 Skill。
2. 可通过 Git URL 克隆项目并拉取更新。
3. 扫描结果不包含无 `SKILL.md` 的目录或普通文件。
4. 打开 Skill 可看到目录结构；点击内部文件可预览内容。
5. 可为 Skill 设置多个标签和一个分组，并按此筛选。
6. 可一键把库内 Skill 以符号链接安装到选定工具。
7. 目标真实目录冲突时不覆盖。
8. 可卸载本应用创建的符号链接。
9. 现有暂停、备份、删除流程仍可用。
10. 相关自动化测试与类型检查通过。

## 13. 与 V1 的关系

V1 设计文档：`docs/superpowers/specs/2026-08-06-skill-manager-design.md`。

V2 不替换 V1，而是在其上增加库与分发层。实施时先落地库索引与安装链接，再接入界面导航扩展。
