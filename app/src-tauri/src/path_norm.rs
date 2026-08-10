use std::path::Path;

/// 跨平台路径比较键：去 Windows verbatim 前缀、统一 `/`、ascii 小写。
pub(crate) fn normalize_path_key(path: &Path) -> String {
    normalize_path_key_str(&path.to_string_lossy())
}

pub(crate) fn normalize_path_key_str(raw: &str) -> String {
    let stripped = strip_windows_verbatim(raw);
    let lowered = stripped.replace('\\', "/").to_ascii_lowercase();
    let (prefix, rest) = if let Some(rest) = lowered.strip_prefix("//") {
        ("//", rest)
    } else {
        ("", lowered.as_str())
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

/// Windows 卷标识：盘符 `c:` 或 UNC `//server/share`；无法识别则 None。
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

pub(crate) fn same_windows_volume(left: &Path, right: &Path) -> bool {
    match (windows_volume_id(left), windows_volume_id(right)) {
        (Some(a), Some(b)) => a == b,
        _ => false,
    }
}

fn strip_windows_verbatim(raw: &str) -> String {
    if let Some(rest) = raw.strip_prefix(r"\\?\UNC\") {
        format!(r"\\{rest}")
    } else if let Some(rest) = raw.strip_prefix(r"\\?\") {
        rest.to_owned()
    } else if let Some(rest) = raw.strip_prefix("//?/UNC/") {
        format!("//{rest}")
    } else if let Some(rest) = raw.strip_prefix("//?/") {
        rest.to_owned()
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
    }

    #[test]
    fn path_is_under_ignores_verbatim_mismatch() {
        let lib = PathBuf::from(r"C:\Users\Demo\library");
        let child = PathBuf::from(r"\\?\C:\Users\Demo\library\projects\abc\skill");
        assert!(path_is_under(&child, &lib));
        assert!(!path_is_under(
            &PathBuf::from(r"\\?\D:\other\skill"),
            &lib
        ));
    }

    #[test]
    fn same_volume_compares_drive_letters() {
        assert!(same_windows_volume(
            Path::new(r"\\?\C:\a\b"),
            Path::new(r"C:\x\y")
        ));
        assert!(!same_windows_volume(
            Path::new(r"C:\a"),
            Path::new(r"D:\a")
        ));
        assert!(same_windows_volume(
            Path::new(r"\\?\UNC\srv\share\a"),
            Path::new(r"\\srv\share\b")
        ));
    }
}
