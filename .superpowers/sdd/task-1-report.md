# Task 1 报告：初始化 Tauri 应用和测试基线

## 状态

**DONE**

## 验证摘要

`npm run test`（1 passed）与 `npm run typecheck`（exit 0）均通过。

## 创建和修改的文件

### 脚手架创建（`app/` 全新目录）

| 路径 | 说明 |
|------|------|
| `app/package.json` | 项目依赖与脚本（后续修改） |
| `app/package-lock.json` | 锁定依赖 |
| `app/vite.config.ts` | Vite + Tauri 配置（后续修改） |
| `app/tsconfig.json` | TypeScript 配置（后续修改） |
| `app/tsconfig.node.json` | Node 侧 TS 配置 |
| `app/index.html` | 入口 HTML |
| `app/README.md` | 脚手架说明 |
| `app/.gitignore` | Git 忽略规则 |
| `app/.vscode/extensions.json` | VS Code 推荐扩展 |
| `app/public/tauri.svg` | 静态资源 |
| `app/public/vite.svg` | 静态资源 |
| `app/src/main.tsx` | React 入口 |
| `app/src/App.tsx` | 主组件（标题已改为 Skill Manager） |
| `app/src/App.css` | 样式 |
| `app/src/assets/react.svg` | 资源 |
| `app/src/vite-env.d.ts` | Vite 类型声明 |
| `app/src-tauri/**` | Tauri 2 Rust 后端（Cargo.toml、main.rs、lib.rs、tauri.conf.json、icons 等） |

### 本任务新增

| 路径 | 说明 |
|------|------|
| `app/src/test/setup.ts` | Vitest 全局 setup，引入 `@testing-library/jest-dom/vitest` |
| `app/src/App.test.tsx` | 应用标题渲染测试 |

### 本任务修改

| 路径 | 变更 |
|------|------|
| `app/package.json` | 新增 `test`、`test:watch`、`typecheck` 脚本；安装 vitest、jsdom、Testing Library 开发依赖 |
| `app/vite.config.ts` | 添加 Vitest 配置：`environment: jsdom`、`setupFiles`、`css: true`、`globals: true` |
| `app/tsconfig.json` | 添加 `"types": ["vitest/globals"]` 以支持测试全局 API 类型检查 |
| `app/src/App.tsx` | `<h1>` 标题由 `Welcome to Tauri + React` 改为 `Skill Manager` |

## 执行的命令及结果

| 命令 | 结果 |
|------|------|
| `npm create tauri-app@latest app -- --template react-ts --manager npm` | **失败** — `IO error: not a terminal`（非 TTY 环境） |
| `npm create tauri-app@latest -- --help` | **成功** — 确认需 `-y` 跳过交互 |
| `npm create tauri-app@latest app -- --template react-ts --manager npm -y` | **成功** — 脚手架创建完成 |
| `cd app && npm install` | **成功** — 72 packages |
| `npm install --save-dev vitest jsdom @testing-library/react @testing-library/jest-dom @testing-library/user-event` | **成功** — 86 packages added |
| `npm run test` | **成功** — 1 test file, 1 test passed |
| `npm run typecheck` | **成功** — exit 0, 无类型错误 |

## 自检结论

- Tauri 2 + React + TypeScript + Vite 工程已在 `app/` 建立。
- Vitest + jsdom + Testing Library 测试基线已配置并可运行。
- `App.test.tsx` 验证页面标题为 `Skill Manager`，测试通过。
- `typecheck` 通过，TypeScript 严格模式无报错。
- 未初始化 Git、未创建提交（符合全局约束）。
- 未实现 Skill 业务功能（符合任务范围）。

## 未解决问题 / Concerns

1. **脚手架命令需 `-y` 标志**：简报原命令在非 TTY 环境失败；按简报"先查 `--help` 再使用等价非交互命令"指引，追加 `-y` 后成功。后续自动化脚本应使用该形式。
2. **Vitest globals 配置为隐含依赖**：简报指定的 `App.test.tsx` 使用裸 `it`/`expect`（无 vitest import），因此在 `vite.config.ts` 中额外设置 `globals: true`，并在 `tsconfig.json` 中添加 `"types": ["vitest/globals"]`。若后续测试文件改为显式 import，可移除此配置。
3. **npm 环境警告**：全局 npm 配置 `always-auth` 产生 deprecation 警告，与项目无关。
4. **install-scripts 警告**：esbuild 等包的 postinstall 脚本未在 allowScripts 白名单中，不影响当前测试与类型检查。
