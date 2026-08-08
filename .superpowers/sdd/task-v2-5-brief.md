# Task V2-5：集成验证

## 约束

- 工作目录：`/Users/xuzhi/github/skilltools/app`
- 命令逐条执行；不初始化 Git、不提交
- 更新 README 说明 V2 能力

## 验证命令（逐条）

```bash
npm run test
npm run typecheck
npm run build
cd src-tauri
cargo fmt --check
cargo clippy --all-targets --all-features -- -D warnings
cargo test
cd ..
npm run tauri build
```

若 tauri build 过慢或失败，记录原因；至少保证测试与 clippy 通过。

## README

补充：中央库、标签分组、本地/Git 项目、一键符号链接应用、目录树文件预览、扫描仅 SKILL 目录。

## 报告

`/Users/xuzhi/github/skilltools/.superpowers/sdd/task-v2-5-report.md`
最终只返回状态、验证摘要、concerns。
