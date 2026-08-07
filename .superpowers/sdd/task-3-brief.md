# Task 3：扫描与解析 Skill

## 项目位置与约束

- Rust 工作目录：`/Users/xuzhi/github/skilltools/app/src-tauri`
- 所有 Bash 命令逐条执行；不初始化 Git、不提交。
- 使用 TDD；只实现启用目录扫描和详情，不实现暂停、恢复、备份或 Tauri Command。
- 只扫描每个 Skill 根目录的直接子目录；扫描一个条目失败不能阻断整体。
- 不递归跟随符号链接。

## 文件与接口

- 创建 `src/skill_repository.rs`
- 修改 `src/lib.rs` 导出模块
- 可按必要最小范围修改 `src/model.rs`

```rust
pub struct SkillRepository {
    paths: AppPaths,
}

impl SkillRepository {
    pub fn new(paths: AppPaths) -> Self;
    pub fn scan(&self) -> Result<Vec<SkillSummary>, AppError>;
    pub fn detail(&self, skill_id: &str) -> Result<SkillDetail, AppError>;
}
```

## 行为

1. 遍历 `AppPaths.skill_roots`；根目录不存在时视为空，根目录其它读取错误不应阻断其它根，需形成可理解处理。
2. 每个直接子目录识别为一个 Skill；普通文件忽略。
3. 读取子目录 `SKILL.md`：
   - frontmatter `name` 优先于目录名。
   - frontmatter `description` 优先，否则空字符串。
   - frontmatter YAML 格式错误时仍返回 Skill，名称回退目录名，并添加中文 warning。
   - 缺少或无法读取 `SKILL.md` 时仍返回 Skill，添加中文 warning。
4. frontmatter 只在文档以独立一行 `---` 开始且存在闭合 `---` 时解析；Markdown 正文不应被误当 YAML。
5. 稳定 ID：SHA-256 十六进制字符串，输入精确为 `"{provider:?}:{original_path_display}"`；同一路径每次扫描一致，不同 provider/path 不同。
6. `scan` 最终按 `name` 不区分大小写排序；同名时以 id 稳定排序。
7. `detail` 通过当前扫描结果按 id 定位，找不到返回 `SkillNotFound`；读取原始 Markdown，并返回按相对路径字符串排序的完整文件清单。
8. 文件清单包含目录内普通文件和符号链接条目，不包含目录本身，不跟随符号链接进入目标。
9. 扫描前对根目录和 Skill 目录调用 `AppPaths::assert_allowed`。

## TDD 最少覆盖

- 同时扫描 Cursor/Claude/Codex 三个来源。
- 合法 frontmatter 取 name/description。
- 非法 YAML 返回条目且有 warning。
- 缺少 `SKILL.md` 返回条目且有 warning。
- 普通文件被忽略。
- ID 稳定且不同来源不同。
- `detail` 返回 Markdown 和排序后的相对文件清单。
- 目录内符号链接不被递归跟随。
- 未知 ID 返回 `SkillNotFound`。

测试使用 `tempfile`，不访问用户真实 home。

先写失败测试并记录 RED，再实现。最终逐条执行：

```bash
cargo fmt --check
cargo test skill_repository
cargo test
```

## 报告

完整报告写入 `/Users/xuzhi/github/skilltools/.superpowers/sdd/task-3-report.md`，包含状态、文件、RED/GREEN、命令结果、自检、concerns。最终只返回状态、一行测试摘要与 concerns。
