# Task 7：类型化 API 与三栏主界面

## 约束

- 前端工作目录：`/Users/xuzhi/github/skilltools/app`
- React + TypeScript；TDD；命令逐条执行；不初始化 Git、不提交。
- 实现三栏桌面主界面、扫描、筛选、搜索、选择和详情展示。
- 本任务不接通暂停/恢复/备份/删除操作，不实现备份中心；操作按钮可展示为禁用或通过明确回调接口预留。
- 界面文案使用简体中文，产品名 `Skill Manager`。
- 不使用 localStorage 模拟后端，不直接访问文件系统。

## 文件

- 创建 `src/model/skill.ts`
- 创建 `src/api/skillApi.ts`
- 创建 `src/hooks/useSkills.ts`
- 创建 `src/components/Sidebar.tsx`
- 创建 `src/components/SkillList.tsx`
- 创建 `src/components/SkillDetail.tsx`
- 修改 `src/App.tsx`
- 统一样式到 `src/styles.css`，移除脚手架 `App.css` 与无用 assets 引用
- 修改 `src/App.test.tsx`

可安装 `react-markdown` 用于安全渲染 Markdown，不启用原始 HTML。

## 类型

```ts
export type Provider = "cursor" | "claude" | "codex";
export type SkillStatus = "active" | "paused";
export type BackupReason = "manual" | "beforeDelete";

export interface SkillSummary {
  id: string;
  name: string;
  description: string;
  provider: Provider;
  status: SkillStatus;
  originalPath: string;
  currentPath: string;
  warnings: string[];
}

export interface SkillDetail extends SkillSummary {
  skillMarkdown: string;
  files: string[];
}

export interface BackupRecord {
  id: string;
  skillId: string;
  skillName: string;
  provider: Provider;
  reason: BackupReason;
  createdAt: string;
  originalPath: string;
  archivePath: string;
  checksum: string;
}

export interface CommandError {
  code: string;
  message: string;
}
```

## API

```ts
export interface SkillApi {
  scanSkills(): Promise<SkillSummary[]>;
  getSkillDetail(skillId: string): Promise<SkillDetail>;
  pauseSkill(skillId: string): Promise<SkillDetail>;
  resumeSkill(skillId: string): Promise<SkillDetail>;
  createBackup(skillId: string): Promise<BackupRecord>;
  listBackups(): Promise<BackupRecord[]>;
  restoreBackup(backupId: string): Promise<SkillDetail>;
  deleteSkill(skillId: string): Promise<BackupRecord>;
}
```

默认 `tauriSkillApi` 使用 `invoke` 调用八个 snake_case Command，并用 `{ skillId }` / `{ backupId }` 作为参数。保留后端 `CommandError` 的 `code/message`，未知错误规范化为 `{ code: "UNKNOWN", message: "操作失败，请重试" }`。

## Hook

`useSkills(api)` 负责：

- 首次加载调用 `scanSkills`。
- `refresh()` 手动刷新。
- `selectedSkillId` 与 `selectSkill(id)`。
- 选择后调用 `getSkillDetail`，快速切换时忽略过期响应。
- 列表 loading、详情 loading、错误。
- 不在 hook 中重复 UI 筛选逻辑。

扫描刷新后：若当前 ID 仍存在则保持选择，否则选择第一个；空列表清空详情。

## 三栏 UI

### 左栏

- 品牌和本地管理说明。
- 筛选按钮：全部、Cursor、Claude、Codex、已暂停、备份记录。
- 显示各分类数量。
- “备份记录”本任务显示“将在下一阶段接入”的空状态，但导航可选。
- 底部刷新按钮。

### 中栏

- 标题与当前数量。
- 搜索框，按名称和描述不区分大小写。
- 来源/状态筛选在左栏完成。
- 列表项显示名称、描述、来源徽标、启用/暂停状态。
- 选中态明显。
- 加载、空列表、无搜索结果和错误重试状态。

### 右栏

- 无选择引导状态。
- 名称、描述、来源、状态、路径。
- warnings 警示块。
- `SKILL.md` 使用 react-markdown 渲染，不渲染原始 HTML。
- 折叠或独立区域展示文件清单。
- 显示暂停/恢复、备份、删除按钮，本任务禁用并带 `title="下一阶段接入"`。

## 视觉

- 深色窄侧栏、浅色列表区、白色详情区。
- 桌面最小宽度下保持三栏；窄屏可改为 240px + 320px + minmax。
- 清晰 focus-visible、hover、selected、disabled 状态。
- 不使用渐变、巨型标题或装饰性动画。

## TDD

Fake SkillApi 返回至少：

- Cursor active：`brainstorming`
- Claude paused：`tdd-test`，详情描述/Markdown 包含“测试驱动开发”

最少覆盖：

1. 首次加载展示 Skill。
2. 点击 Claude 后只显示 Claude Skill。
3. 点击已暂停后只显示 paused。
4. 搜索名称和描述。
5. 点击列表加载详情并渲染 Markdown、路径、文件和 warning。
6. 快速切换忽略过期详情响应。
7. 扫描错误展示中文错误和重试。
8. 空列表状态。
9. 操作按钮本任务禁用。

最终逐条运行：

```bash
npm run test
npm run typecheck
npm run build
```

## 报告

写入 `/Users/xuzhi/github/skilltools/.superpowers/sdd/task-7-report.md`，包含状态、文件、RED/GREEN、命令结果、自检、concerns。最终只返回状态、一行验证摘要与 concerns。
