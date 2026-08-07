# Task 9：应用集成与打包验收

## 约束

- 工作目录：`/Users/xuzhi/github/skilltools/app`
- 命令逐条执行；不初始化 Git、不提交。
- 完成产品信息、README、全量验证与 macOS 打包。
- 不新增范围外功能。

## 产品配置

修改 `src-tauri/tauri.conf.json`：

- `productName`: `Skill Manager`
- 窗口 `title`: `Skill Manager`
- 合理默认尺寸：宽 ≥ 1100、高 ≥ 720
- `minWidth` ≥ 960、`minHeight` ≥ 640
- identifier 保持可用且唯一（可保留现有或改为 `com.xuzhi.skillmanager`）

## README

更新 `app/README.md`，简体中文，至少包含：

```bash
npm install
npm run tauri dev
npm run test
npm run typecheck
npm run tauri build
```

说明：三栏管理、暂停/恢复、备份、删除前自动备份、备份恢复；管理目录为 `~/.cursor/skills`、`~/.claude/skills`、`~/.codex/skills`。

## 验证（逐条）

在 `app/`：

```bash
npm run test
npm run typecheck
npm run build
```

在 `app/src-tauri/`：

```bash
cargo fmt --check
cargo clippy --all-targets --all-features -- -D warnings
cargo test
```

回到 `app/`：

```bash
npm run tauri build
```

确认 `src-tauri/target/release/bundle/` 生成 macOS 产物（`.app` 和/或 `.dmg`）。若签名相关非阻断警告可记录为 concern，但构建必须成功。

## 手工验收清单（写入报告）

若无法启动 GUI，至少用现有自动化测试证据对应：

1. 三来源扫描
2. 暂停后原目录不存在
3. 恢复后内容一致
4. 多次手动备份
5. 删除后存在 before_delete 备份
6. 恢复冲突不覆盖
7. 非白名单路径拒绝

## 报告

写入 `/Users/xuzhi/github/skilltools/.superpowers/sdd/task-9-report.md`，含状态、配置改动、每条命令结果（含 exit code）、产物路径、手工验收映射、concerns。最终只返回状态、一行验证摘要与 concerns。
