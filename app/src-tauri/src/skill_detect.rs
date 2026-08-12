use std::path::Path;

/// 目录是否包含标准命名的 Skill 清单文件。
pub(crate) fn dir_has_skill_md(dir: &Path) -> bool {
    std::fs::symlink_metadata(dir.join("SKILL.md"))
        .map(|metadata| metadata.file_type().is_file())
        .unwrap_or(false)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::tempdir;

    #[test]
    fn finds_standard_skill_md_name() {
        let dir = tempdir().unwrap();
        assert!(!dir_has_skill_md(dir.path()));
        fs::write(dir.path().join("SKILL.md"), "# x").unwrap();
        assert!(dir_has_skill_md(dir.path()));
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn rejects_case_variants_on_linux() {
        let dir = tempdir().unwrap();
        fs::write(dir.path().join("skill.md"), "# x").unwrap();
        assert!(!dir_has_skill_md(dir.path()));
        fs::remove_file(dir.path().join("skill.md")).unwrap();
        fs::write(dir.path().join("Skill.md"), "# x").unwrap();
        assert!(!dir_has_skill_md(dir.path()));
    }
}
