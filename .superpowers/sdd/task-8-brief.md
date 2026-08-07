# Task 8：破坏性操作、备份中心与错误反馈

## 约束

- 前端工作目录：`/Users/xuzhi/github/skilltools/app`
- React + TypeScript；TDD；命令逐条执行；不初始化 Git、不提交。
- 接通暂停、恢复、手动备份、删除、备份列表、备份恢复。
- 删除与恢复必须二次确认。
- 操作进行中禁用相关按钮，防止重复提交。
- 错误展示中文 `CommandError.message`，不显示 Rust 堆栈。
- 不新增后端 Command，不改领域事务。

## 文件

- 创建 `src/components/ConfirmDialog.tsx`
- 创建 `src/components/BackupList.tsx`
- 修改 `src/components/SkillDetail.tsx`
- 修改 `src/hooks/useSkills.ts`
- 修改 `src/App.tsx`
- 修改 `src/App.test.tsx`
- 按需补充 `src/styles.css`

## Hook 扩展

`useSkills(api)` 增加：

```ts
pendingAction: string | null;
actionError: CommandError | null;
backups: BackupRecord[];
backupsLoading: boolean;
backupsError: CommandError | null;

pauseSkill(skillId: string): Promise<void>;
resumeSkill(skillId: string): Promise<void>;
createBackup(skillId: string): Promise<void>;
deleteSkill(skillId: string): Promise<void>;
loadBackups(): Promise<void>;
restoreBackup(backupId: string): Promise<void>;
clearActionError(): void;
```

规则：

1. 任意操作开始时设置 `pendingAction`（如 `pause:<id>`、`delete:<id>`、`restore:<backupId>`），结束时清空。
2. `pendingAction` 非空时，所有破坏性操作入口禁用。
3. 成功后：
   - 暂停/恢复/手动备份：重新 `scanSkills`，并刷新当前详情（若仍存在）。
   - 删除：清空选择，重新扫描，并刷新备份列表。
   - 恢复备份：重新扫描并刷新备份列表；若恢复出的 Skill 存在则选中它。
4. 失败时设置 `actionError`，保留当前选择和详情。
5. 进入备份记录视图时调用 `loadBackups()`。

## ConfirmDialog

- props：`open`、`title`、`message`、`confirmLabel`、`tone?: "default" | "danger"`、`busy`、`onConfirm`、`onCancel`
- 打开时有明确焦点；Escape 取消；busy 时禁用确认/取消。
- 删除确认文案必须包含“先自动备份再删除”。
- 恢复确认文案必须说明目标已存在时不会覆盖。

## SkillDetail

- 启用暂停/恢复/备份/删除按钮。
- active 显示“暂停”，paused 显示“恢复”。
- 删除点击后弹出确认；确认后才调用 `deleteSkill`。
- 操作中按钮 disabled，busy 文案可为“处理中…”。
- 展示 `actionError`。

## BackupList

- 中栏：按 `createdAt` 倒序显示备份，字段含名称、来源、原因（手动/删除前）、时间。
- 右栏：原因、来源、原路径、归档路径、校验值、恢复按钮。
- 恢复需确认；冲突错误展示“目标位置已存在”且不改变现有目录状态。
- 加载、空列表、错误重试状态齐全。

## App

- `filter === "backups"` 时渲染 BackupList，不再显示占位。
- 进入备份视图时触发 `loadBackups()`。
- 删除确认与恢复确认可放在 App 或子组件，但必须覆盖二次确认。

## TDD 最少覆盖

1. 点击删除后 `deleteSkill` 尚未调用；确认“备份并删除”后只调用一次。
2. 删除 Promise pending 时确认按钮禁用，无法重复提交。
3. 暂停成功后列表状态变为已暂停，按钮变为恢复。
4. 手动备份成功后备份列表可看到新记录（或至少调用 createBackup）。
5. `TARGET_CONFLICT` 显示“目标位置已存在”，详情仍保留。
6. 备份中心展示倒序记录，并可恢复确认。
7. 操作失败展示中文 message，不展示堆栈。

最终逐条运行：

```bash
npm run test
npm run typecheck
npm run build
```

## 报告

写入 `/Users/xuzhi/github/skilltools/.superpowers/sdd/task-8-report.md`，包含状态、文件、RED/GREEN、命令结果、自检、concerns。最终只返回状态、一行验证摘要与 concerns。
