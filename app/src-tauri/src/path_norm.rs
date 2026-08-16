use std::path::Path;

/// 跨平台路径比较键：Windows 路径去 verbatim 前缀、统一 `/` 并 ASCII 小写；
/// POSIX 路径保留大小写。
pub(crate) fn normalize_path_key(path: &Path) -> String {
    normalize_path_key_str(&path.to_string_lossy())
}

pub(crate) fn normalize_path_key_str(raw: &str) -> String {
    let stripped = strip_windows_verbatim(raw);
    let windows_style = is_windows_style_path(raw, &stripped);
    let normalized = if windows_style {
        stripped.replace('\\', "/").to_ascii_lowercase()
    } else {
        stripped
    };
    let (prefix, rest) = if let Some(rest) = normalized.strip_prefix("//") {
        ("//", rest)
    } else {
        ("", normalized.as_str())
    };
    let mut key = String::from(prefix);
    let mut prev_slash = false;
    for ch in rest.chars() {
        if ch == '/' {
            if prev_slash {
                continue;
            }
            prev_slash = true;
            key.push('/');
            continue;
        }
        prev_slash = false;
        key.push(ch);
    }
    while key.len() > 1 && key.ends_with('/') {
        key.pop();
    }
    key
}

fn is_windows_style_path(raw: &str, stripped: &str) -> bool {
    raw.starts_with(r"\\?\")
        || raw.starts_with("//?/")
        || raw.starts_with(r"\\")
        || stripped.starts_with(r"\\")
        || stripped.starts_with("//")
        || stripped
            .as_bytes()
            .get(0..2)
            .is_some_and(|prefix| prefix[0].is_ascii_alphabetic() && prefix[1] == b':')
}

/// `child` 是否位于 `parent` 之下（含相等）。
pub(crate) fn path_is_under(child: &Path, parent: &Path) -> bool {
    let child_key = normalize_path_key(child);
    let parent_key = normalize_path_key(parent);
    if child_key == parent_key {
        return true;
    }
    if parent_key.is_empty() {
        return false;
    }
    let prefix = format!("{parent_key}/");
    child_key.starts_with(&prefix)
}

pub(crate) fn paths_eq(left: &Path, right: &Path) -> bool {
    normalize_path_key(left) == normalize_path_key(right)
}

/// 先尽量 canonicalize 再比较，避免 macOS `/var`→`/private/var`、Windows 8.3 短名导致误判。
pub(crate) fn path_is_under_resolved(child: &Path, parent: &Path) -> bool {
    let child = child.canonicalize().unwrap_or_else(|_| child.to_path_buf());
    let parent = parent.canonicalize().unwrap_or_else(|_| parent.to_path_buf());
    path_is_under(&child, &parent)
}

/// Windows 卷标识：盘符 `c:` 或 UNC `//server/share`；无法识别则 None。
#[cfg(windows)]
pub(crate) fn windows_volume_id(path: &Path) -> Option<String> {
    let key = normalize_path_key(path);
    if let Some(rest) = key.strip_prefix("//") {
        let mut parts = rest.split('/');
        let host = parts.next().unwrap_or("");
        let share = parts.next().unwrap_or("");
        if !host.is_empty() && !share.is_empty() {
            return Some(format!("//{host}/{share}"));
        }
        return None;
    }
    let bytes = key.as_bytes();
    if bytes.len() >= 2 && bytes[1] == b':' && bytes[0].is_ascii_alphabetic() {
        return Some(key[..2].to_owned());
    }
    None
}

#[cfg(windows)]
pub(crate) fn same_windows_volume(left: &Path, right: &Path) -> bool {
    match (windows_volume_id(left), windows_volume_id(right)) {
        (Some(a), Some(b)) => a == b,
        _ => false,
    }
}

/// Windows 保留设备名（CON/PRN 等），在任意平台拒绝，避免库同步到 Windows 后无法安装。
pub(crate) fn is_forbidden_skill_dir_name(name: &str) -> bool {
    if name.is_empty() || name == "." || name == ".." {
        return true;
    }
    if cfg!(windows) && (name.ends_with(' ') || name.ends_with('.')) {
        return true;
    }
    let stem = name.split('.').next().unwrap_or(name);
    matches!(
        stem.to_ascii_uppercase().as_str(),
        "CON"
            | "PRN"
            | "AUX"
            | "NUL"
            | "COM1"
            | "COM2"
            | "COM3"
            | "COM4"
            | "COM5"
            | "COM6"
            | "COM7"
            | "COM8"
            | "COM9"
            | "LPT1"
            | "LPT2"
            | "LPT3"
            | "LPT4"
            | "LPT5"
            | "LPT6"
            | "LPT7"
            | "LPT8"
            | "LPT9"
    )
}

/// Junction 的 NT 设备路径：`\??\C:\...` 或 `\??\UNC\server\share\...`。
#[cfg(any(windows, test))]
pub(crate) fn windows_nt_device_path_str(raw: &str) -> String {
    let stripped = strip_windows_verbatim(raw);
    if let Some(rest) = stripped.strip_prefix(r"\\") {
        format!(r"\??\UNC\{rest}")
    } else {
        format!(r"\??\{stripped}")
    }
}

pub(crate) fn strip_windows_verbatim(raw: &str) -> String {
    if raw
        .get(..8)
        .is_some_and(|prefix| prefix.eq_ignore_ascii_case(r"\\?\UNC\"))
    {
        format!(r"\\{}", &raw[8..])
    } else if raw
        .get(..4)
        .is_some_and(|prefix| prefix.eq_ignore_ascii_case(r"\\?\"))
    {
        raw[4..].to_owned()
    } else if raw
        .get(..8)
        .is_some_and(|prefix| prefix.eq_ignore_ascii_case("//?/UNC/"))
    {
        format!("//{}", &raw[8..])
    } else if raw
        .get(..4)
        .is_some_and(|prefix| prefix.eq_ignore_ascii_case("//?/"))
    {
        raw[4..].to_owned()
    } else {
        raw.to_owned()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    #[test]
    fn strips_verbatim_prefix_and_normalizes_separators() {
        assert_eq!(
            normalize_path_key_str(r"\\?\C:\Users\Demo\Library"),
            "c:/users/demo/library"
        );
        assert_eq!(
            normalize_path_key_str(r"C:\Users\Demo\Library"),
            "c:/users/demo/library"
        );
        assert_eq!(
            normalize_path_key_str(r"\\?\UNC\server\share\skills"),
            "//server/share/skills"
        );
        assert_eq!(
            normalize_path_key_str(r"\\?\unc\Server\Share\Skills"),
            "//server/share/skills"
        );
    }

    #[test]
    fn path_is_under_ignores_verbatim_mismatch() {
        let lib = PathBuf::from(r"C:\Users\Demo\library");
        let child = PathBuf::from(r"\\?\C:\Users\Demo\library\projects\abc\skill");
        assert!(path_is_under(&child, &lib));
        assert!(!path_is_under(&PathBuf::from(r"\\?\D:\other\skill"), &lib));
    }

    #[test]
    fn collapses_duplicate_slashes() {
        assert_eq!(
            normalize_path_key_str(r"C:\Users\\Demo\\\library\"),
            "c:/users/demo/library"
        );
        assert_eq!(
            normalize_path_key_str("//server//share///a//"),
            "//server/share/a"
        );
    }

    #[test]
    fn preserves_posix_case_and_only_ascii_folds_windows() {
        assert_eq!(
            normalize_path_key_str("/Users/Demo/技能"),
            "/Users/Demo/技能"
        );
        assert_eq!(
            normalize_path_key_str(r"C:\Users\Demo\ÄSkill"),
            "c:/users/demo/Äskill"
        );
    }

    #[test]
    fn rejects_windows_reserved_device_names() {
        assert!(is_forbidden_skill_dir_name("CON"));
        assert!(is_forbidden_skill_dir_name("nul.txt"));
        assert!(is_forbidden_skill_dir_name("com1"));
        assert!(!is_forbidden_skill_dir_name("console"));
        assert!(!is_forbidden_skill_dir_name("alpha"));
    }

    #[test]
    fn path_is_under_resolved_survives_canonicalize_prefix() {
        let dir = tempfile::tempdir().unwrap();
        let parent = dir.path().join("library");
        let child = parent.join("projects").join("a");
        std::fs::create_dir_all(&child).unwrap();
        let child_canon = child.canonicalize().unwrap();
        assert!(path_is_under_resolved(&child_canon, &parent));
    }

    #[test]
    fn nt_device_path_covers_drive_and_unc() {
        assert_eq!(
            windows_nt_device_path_str(r"C:\Users\测试\library"),
            r"\??\C:\Users\测试\library"
        );
        assert_eq!(
            windows_nt_device_path_str(r"\\?\C:\Users\Demo"),
            r"\??\C:\Users\Demo"
        );
        assert_eq!(
            windows_nt_device_path_str(r"\\?\UNC\server\share\skills"),
            r"\??\UNC\server\share\skills"
        );
    }
}
