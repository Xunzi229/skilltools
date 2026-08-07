# Task 8 实施报告

## 状态

已完成。

## 变更文件

- `app/src/components/ConfirmDialog.tsx`
  - 新增删除、恢复共用确认对话框。
  - 支持打开时聚焦、Escape 取消、busy 时禁用确认和取消。
- `app/src/components/BackupList.tsx`
  - 新增备份中心中栏列表和右栏详情。
  - 支持倒序、加载、空状态、错误重试、恢复确认及错误展示。
- `app/src/components/SkillDetail.tsx`
  - 接通暂停、恢复、手动备份、删除。
  - 删除增加二次确认，操作期间统一禁用入口并展示中文错误。
- `app/src/hooks/useSkills.ts`
  - 接通 6 个既有 API。
  - 新增 `pendingAction`、操作错误、备份列表及加载状态。
  - 操作成功后按要求刷新扫描、详情和备份列表；失败时保留当前详情。
- `app/src/App.tsx`
  - 备份中心替换 Task 7 占位页，进入视图自动加载备份。
- `app/src/App.test.tsx`
  - 保留原 10 项行为覆盖并扩展到 18 项测试。
- `app/src/styles.css`
  - 补充确认对话框、备份详情和操作错误样式。

未修改后端 Rust 领域逻辑。

## RED / GREEN

- RED：先扩展测试，首次运行 `npm run test` 为 10 项失败，失败点覆盖未接通的操作按钮、确认对话框和备份中心。
- GREEN：完成实现后 18 项测试全部通过。
- 调试过程中修正了 2 处测试查询歧义，不涉及生产逻辑变更。

## 命令结果

- `npm run test`：通过，1 个测试文件、18 项测试全部通过。
- `npm run typecheck`：通过。
- `npm run build`：通过，Vite 成功生成生产构建。

## 自检

- [x] pause / resume / createBackup / deleteSkill / listBackups / restoreBackup 已接通。
- [x] 删除确认文案包含“先自动备份再删除”。
- [x] 恢复确认说明目标已存在时不会覆盖。
- [x] `pendingAction` 配合 ref 阻止同步重复提交，操作期间禁用相关入口。
- [x] `TARGET_CONFLICT` 仅展示中文 `message`，不展示 Rust 堆栈。
- [x] 操作失败保留当前 Skill 或备份详情。
- [x] 备份列表按 `createdAt` 倒序，加载、空列表、错误重试状态齐全。
- [x] 刷新后重载详情、快速切换忽略过期响应等 Task 7 行为继续通过。
- [x] 未初始化 Git，未提交。

## Concerns

- npm 每次执行均提示用户级配置 `always-auth` 将在下一主版本失效；当前不影响测试、类型检查或构建。
