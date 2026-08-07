# Skilltools

本地 Skill 管理桌面应用 + 技能库工具集。

## 项目概述

Skilltools 是一个用于管理和应用 AI 开发工具技能（Skills）的工具集，包含：

- **Skill Manager** — Tauri 桌面应用，管理 Cursor/Claude/Codex 的本地 Skill 文件
- **Skill Library** — 技能库应用框架（规划中）

## 功能特性

### Skill Manager

- 三栏界面管理 `~/.cursor/skills`、`~/.claude/skills`、`~/.codex/skills`
- 暂停/恢复 Skill（移动到停用目录）
- 手动备份与一键恢复
- 删除前自动创建 `before_delete` 备份
- 恢复冲突时不覆盖、不合并
- 符号链接安全扫描（不递归跟随到白名单外）

## 技术栈

| 层级 | 技术 |
|------|------|
| 桌面框架 | Tauri 2 |
| 前端 | React 18 + TypeScript + Vite |
| 后端 | Rust（serde、walkdir、sha2、tempfile） |
| 测试 | Vitest + Testing Library |
| 文档 | Markdown + SDD（Software Design Document） |

## 项目结构

```
skilltools/
├── app/                          # Tauri 桌面应用
│   ├── src/                      # React 前端
│   │   ├── components/           # UI 组件（三栏布局）
│   │   ├── api/skillApi.ts       # Tauri Command 适配器
│   │   └── hooks/useSkills.ts    # 状态管理
│   └── src-tauri/                # Rust 后端
│       ├── src/
│       │   ├── commands.rs       # Tauri Command 入口
│       │   ├── skill_repository.rs
│       │   ├── backup_repository.rs
│       │   └── paths.rs          # 路径白名单
│       └── Cargo.toml
├── docs/                         # 设计文档
│   └── superpowers/
│       ├── plans/                # 实施计划
│       └── specs/                # 技术方案
├── .superpowers/                 # SDD 任务报告与 brainstorm
│   ├── sdd/                      # 任务 1-9 报告
│   └── brainstorm/               # 架构讨论记录
└── README.md
```

## 快速开始

### 环境要求

- Node.js 18+
- Rust 1.70+（`rustup` 安装）
- Tauri 依赖（macOS: Xcode Command Line Tools）

### 安装与运行

```bash
cd app

# 安装前端依赖
npm install

# 启动开发环境（热重载）
npm run tauri dev
```

### 构建

```bash
# macOS 应用构建
npm run tauri build

# 输出位于 app/src-tauri/target/release/bundle/
```

### 测试

```bash
# 前端单元测试
npm run test

# TypeScript 类型检查
npm run typecheck
```

## 开发指南

### 目录白名单

Rust 后端仅允许操作以下目录（硬编码于 `paths.rs`）：

- `~/.cursor/skills`
- `~/.claude/skills`
- `~/.codex/skills`
- `~/.claude/skills.disabled`（停用目录）
- `~/.claude/skills.backups`（备份目录）

### 破坏性操作安全

- **删除**：先创建 `before_delete` 备份，失败则中止
- **恢复/暂停**：目标冲突时停止，不覆盖现有内容
- **备份**：使用临时目录 + 校验和 + 原子重命名

### 错误处理

所有面向用户的错误使用简洁中文，由 Rust `AppError` 统一映射。

## 路线图

- [ ] 技能编辑器（在线编辑 YAML/JSON）
- [ ] 在线技能市场集成
- [ ] 云同步（可选）
- [ ] 自动更新
- [ ] ZIP 导入导出
- [ ] 批量操作

## 许可证

内部工具，暂无开源计划。

## 相关文档

- [Skill Manager 实施计划](docs/superpowers/plans/2026-08-06-skill-manager.md)
- [Skill Manager 技术方案](docs/superpowers/specs/2026-08-06-skill-manager-design.md)
- [Skill Library 应用计划](docs/superpowers/plans/2026-08-07-skill-library-apply.md)
