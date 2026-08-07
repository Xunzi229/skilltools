# Task 1：初始化 Tauri 应用和测试基线

## 项目位置

仓库根目录：`/Users/xuzhi/github/skilltools`
应用目录：`/Users/xuzhi/github/skilltools/app`

## 全局约束

- 使用 Tauri 2、React、TypeScript、Vite、Vitest 和 Testing Library。
- 应用代码全部放在 `app/`。
- 当前目录不是 Git 仓库，不初始化 Git、不创建提交。
- 所有 Bash 命令必须逐条执行，当前命令完成后再执行下一条。
- 只完成本任务，不提前实现后续 Skill 业务功能。

## 交付内容

1. 使用官方脚手架创建 Tauri React TypeScript 工程：

```bash
npm create tauri-app@latest app -- --template react-ts --manager npm
```

如果当前 CLI 参数有变化，应先查看 `--help`，再使用等价的非交互命令。

2. 在 `app/` 安装依赖：

```bash
npm install
npm install --save-dev vitest jsdom @testing-library/react @testing-library/jest-dom @testing-library/user-event
```

3. 在 `package.json` 增加：

```json
{
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "tsc --noEmit"
  }
}
```

保留脚手架已有的 `dev`、`build`、`preview`、`tauri` 脚本。

4. 配置 Vitest 使用 `jsdom`、`./src/test/setup.ts` 和 CSS。

5. 创建 `src/test/setup.ts`：

```ts
import "@testing-library/jest-dom/vitest";
```

6. 创建或修改 `src/App.test.tsx`：

```tsx
import { render, screen } from "@testing-library/react";
import App from "./App";

it("renders the application title", () => {
  render(<App />);
  expect(screen.getByText("Skill Manager")).toBeInTheDocument();
});
```

7. 将脚手架页面标题改为 `Skill Manager`，只做满足测试的最小改动。

8. 依次运行：

```bash
npm run test
npm run typecheck
```

两者必须通过。

## 报告

把完整报告写入：

`/Users/xuzhi/github/skilltools/.superpowers/sdd/task-1-report.md`

报告必须包含：

- 状态：`DONE`、`DONE_WITH_CONCERNS`、`NEEDS_CONTEXT` 或 `BLOCKED`
- 创建和修改的文件
- 每个验证命令及结果
- 自检结论
- 未解决问题

最终回复只返回状态、一行验证摘要和 concerns。
