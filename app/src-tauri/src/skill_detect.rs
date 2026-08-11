use std::fs;
use std::path::Path;

/// 目录是否包含 Skill 清单文件（大小写不敏感，兼容 Linux）。
pub(crate) fn dir_has_skill_md(dir: &Path) -> bool {
    if fs::symlink_metadata(dir.join("SKILL.md"))
        .map(|metadata| metadata.file_type().is_file())
        .unwrap_or(false)
    {
        return true;
    }
    // 大小写敏感文件系统上可能是 skill.md / Skill.md
    let Ok(entries) = fs::read_dir(dir) else {
        return false;
    };
    for entry in entries.flatten() {
        let name = entry.file_name();
        if !name.eq_ignore_ascii_case("SKILL.md") {
            continue;
        }
        if entry
            .metadata()
            .map(|metadata| metadata.is_file())
            .unwrap_or(false)
        {
            return true;
        }
    }
    false
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::tempdir;

    #[test]
    fn finds_exact_and_case_variants() {
        let dir = tempdir().unwrap();
        assert!(!dir_has_skill_md(dir.path()));
        fs::write(dir.path().join("skill.md"), "# x").unwrap();
        assert!(dir_has_skill_md(dir.path()));
    }
}
