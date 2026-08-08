# Task V2-3：符号链接安装/卸载

## 约束

- 工作目录：`/Users/xuzhi/github/skilltools/app`
- TDD；命令逐条执行；不初始化 Git、不提交
- 基于 Task 2 的 `library_repository`
- 复用事务锁与路径白名单

## 行为

1. `install_skill(library_skill_id, provider)`
   - 目标：`provider` 对应 Skill 根下以 Skill 名称命名的路径
   - 不存在：创建指向库源目录的符号链接
   - 已是本应用管理链接：更新指向
   - 真实目录或其他非管理链接：`TargetConflict`
2. `uninstall_skill(library_skill_id, provider)`
   - 仅删除本应用管理的符号链接
   - 真实目录拒绝
3. `list_installations` / 库 Skill 摘要带安装状态
4. 安装记录写入 `library-index.json`
5. 注册 Command；中文错误

## 测试

- 安装创建 symlink
- 更新 managed symlink
- 真实目录冲突
- 卸载只删链接
- 路径越界拒绝

验证：

```bash
cd /Users/xuzhi/github/skilltools/app/src-tauri
cargo fmt --check
cargo clippy --all-targets --all-features -- -D warnings
cargo test
```

## 报告

`/Users/xuzhi/github/skilltools/.superpowers/sdd/task-v2-3-report.md`
最终只返回状态、测试摘要、concerns。
