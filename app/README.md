# Skill Manager

Skill Manager 是基于 Tauri、React 和 TypeScript 的本地 Skill 管理工具。

## 功能

- 三栏管理 Cursor、Claude 和 Codex Skill
- 暂停与恢复 Skill
- 支持多次手动备份
- 删除前自动创建备份
- 从备份恢复 Skill，恢复冲突时不覆盖现有内容

### V2

- 使用中央库统一管理 Skill，并按标签分组
- 支持添加本地项目和 Git 项目
- 一键通过符号链接将 Skill 应用到目标平台
- 通过目录树浏览并预览 Skill 文件
- 扫描项目时仅识别包含 `SKILL.md` 的 Skill 目录

管理目录：

- `~/.cursor/skills`
- `~/.claude/skills`
- `~/.codex/skills`

## 开发与验证

安装依赖：

```bash
npm install
```

启动开发环境：

```bash
npm run tauri dev
```

运行前端测试：

```bash
npm run test
```

执行 TypeScript 类型检查：

```bash
npm run typecheck
```

构建 macOS 应用：

```bash
npm run tauri build
```
