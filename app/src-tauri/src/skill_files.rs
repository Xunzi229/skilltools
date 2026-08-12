use std::fs;
use std::path::{Component, Path, PathBuf};

use crate::error::AppError;
use crate::model::{FileContent, FileNode, FileNodeKind};
use crate::skill_repository::SkillRepository;

const MAX_PREVIEW_BYTES: u64 = 512 * 1024;

pub fn list_skill_tree(
    repository: &SkillRepository,
    skill_id: &str,
) -> Result<Vec<FileNode>, AppError> {
    let root = repository.detail(skill_id)?.current_path;
    list_skill_tree_at(&root)
}

pub fn read_skill_file(
    repository: &SkillRepository,
    skill_id: &str,
    relative_path: &str,
) -> Result<FileContent, AppError> {
    let root = repository.detail(skill_id)?.current_path;
    read_skill_file_at(&root, relative_path)
}

pub(crate) fn list_skill_tree_at(root: &Path) -> Result<Vec<FileNode>, AppError> {
    let root = root.canonicalize()?;
    build_tree(&root, &root)
}

pub(crate) fn resolve_skill_file_path(
    root: &Path,
    relative_path: &str,
) -> Result<PathBuf, AppError> {
    resolve_file_path(root, relative_path)
}

pub fn write_skill_file(
    repository: &SkillRepository,
    skill_id: &str,
    relative_path: &str,
    content: &str,
) -> Result<(), AppError> {
    let detail = repository.detail(skill_id)?;
    let root = detail
        .resolved_path
        .as_ref()
        .unwrap_or(&detail.current_path);
    write_skill_file_at(root, relative_path, content)
}

pub(crate) fn write_skill_file_at(
    root: &Path,
    relative_path: &str,
    content: &str,
) -> Result<(), AppError> {
    if content.len() as u64 > MAX_PREVIEW_BYTES {
        return Err(AppError::Io {
            message: format!("文件超过 512 KiB，不支持写入：{relative_path}"),
        });
    }
    if looks_binary(content.as_bytes()) {
        return Err(AppError::Io {
            message: format!("内容包含二进制字符，拒绝写入：{relative_path}"),
        });
    }
    let path = resolve_writable_file_path(root, relative_path)?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    let temp_path = path.with_extension(format!(
        "{}.tmp-{}",
        path.extension()
            .and_then(|ext| ext.to_str())
            .unwrap_or("tmp"),
        uuid::Uuid::new_v4()
    ));
    let write_result = (|| {
        fs::write(&temp_path, content.as_bytes())?;
        fs::rename(&temp_path, &path)?;
        Ok(())
    })();
    if write_result.is_err() {
        let _ = fs::remove_file(&temp_path);
    }
    write_result
}

pub(crate) fn read_skill_file_at(
    root: &Path,
    relative_path: &str,
) -> Result<FileContent, AppError> {
    let path = resolve_file_path(root, relative_path)?;
    let metadata = fs::metadata(&path)?;
    if !metadata.is_file() {
        return Err(AppError::Io {
            message: format!("不是可预览文件：{relative_path}"),
        });
    }
    if metadata.len() > MAX_PREVIEW_BYTES {
        return Ok(unsupported(relative_path, "文件超过 512 KiB，不支持预览"));
    }

    let bytes = fs::read(&path)?;
    if looks_binary(&bytes) {
        return Ok(unsupported(relative_path, "二进制文件不支持预览"));
    }
    let content = match String::from_utf8(bytes) {
        Ok(content) => content,
        Err(_) => return Ok(unsupported(relative_path, "二进制文件不支持预览")),
    };
    let media_type = match path
        .extension()
        .and_then(|extension| extension.to_str())
        .map(str::to_ascii_lowercase)
        .as_deref()
    {
        Some("md" | "markdown") => "markdown",
        Some(
            "txt" | "json" | "yaml" | "yml" | "toml" | "rs" | "ts" | "tsx" | "js" | "jsx" | "py"
            | "sh" | "css" | "html" | "xml" | "csv",
        ) => "text",
        _ => return Ok(unsupported(relative_path, "该文件类型不支持预览")),
    };

    Ok(FileContent {
        relative_path: relative_path.to_string(),
        media_type: media_type.to_string(),
        content: Some(content),
        message: None,
    })
}

fn build_tree(root: &Path, directory: &Path) -> Result<Vec<FileNode>, AppError> {
    let mut nodes = Vec::new();
    for entry in fs::read_dir(directory)? {
        let entry = entry?;
        let path = entry.path();
        // Use symlink metadata so dangling/out-of-root links never fail the whole tree.
        let metadata = fs::symlink_metadata(&path)?;
        let file_type = metadata.file_type();
        let relative_path = path
            .strip_prefix(root)
            .map_err(|_| outside_error(&path))?
            .to_string_lossy()
            .replace('\\', "/");
        let (kind, size, children) = if crate::fs_ops::path_is_symlink_link(&path) {
            // Treat symlinks/junctions as opaque file nodes; never follow into the target.
            (FileNodeKind::File, Some(metadata.len()), Vec::new())
        } else if file_type.is_dir() {
            (FileNodeKind::Directory, None, build_tree(root, &path)?)
        } else {
            (FileNodeKind::File, Some(metadata.len()), Vec::new())
        };
        nodes.push(FileNode {
            name: entry.file_name().to_string_lossy().into_owned(),
            relative_path,
            kind,
            size,
            children,
        });
    }
    nodes.sort_by(|left, right| {
        left.name
            .to_ascii_lowercase()
            .cmp(&right.name.to_ascii_lowercase())
            .then_with(|| left.name.cmp(&right.name))
    });
    Ok(nodes)
}

fn looks_binary(bytes: &[u8]) -> bool {
    bytes.iter().any(|&byte| {
        byte == 0 || byte == 0x7f || (byte < 0x20 && !matches!(byte, b'\t' | b'\n' | b'\r'))
    })
}

fn resolve_file_path(root: &Path, relative_path: &str) -> Result<PathBuf, AppError> {
    let relative = Path::new(relative_path);
    if relative.as_os_str().is_empty()
        || relative
            .components()
            .any(|component| !matches!(component, Component::Normal(_)))
    {
        return Err(outside_error(relative));
    }

    let mut candidate = root.to_path_buf();
    for component in relative.components() {
        let Component::Normal(component) = component else {
            return Err(outside_error(relative));
        };
        candidate.push(component);
        if crate::fs_ops::path_is_symlink_link(&candidate) {
            return Err(outside_error(&candidate));
        }
    }

    let canonical_root = root.canonicalize()?;
    let canonical_candidate = candidate.canonicalize()?;
    if !canonical_candidate.starts_with(&canonical_root) {
        return Err(outside_error(&canonical_candidate));
    }
    Ok(canonical_candidate)
}

/// Like resolve_file_path, but allows creating a new leaf file that does not exist yet.
pub(crate) fn resolve_writable_file_path(
    root: &Path,
    relative_path: &str,
) -> Result<PathBuf, AppError> {
    let relative = Path::new(relative_path);
    if relative.as_os_str().is_empty()
        || relative
            .components()
            .any(|component| !matches!(component, Component::Normal(_)))
    {
        return Err(outside_error(relative));
    }

    let canonical_root = root.canonicalize()?;
    let mut candidate = canonical_root.clone();
    let components: Vec<_> = relative.components().collect();
    for (index, component) in components.iter().enumerate() {
        let Component::Normal(name) = component else {
            return Err(outside_error(relative));
        };
        candidate.push(name);
        let is_leaf = index + 1 == components.len();
        match fs::symlink_metadata(&candidate) {
            Ok(_metadata) if crate::fs_ops::path_is_symlink_link(&candidate) => {
                return Err(outside_error(&candidate));
            }
            Ok(metadata) if !is_leaf && !metadata.is_dir() => {
                return Err(AppError::Io {
                    message: format!("路径不是目录：{}", candidate.display()),
                });
            }
            Ok(metadata) if is_leaf && metadata.is_dir() => {
                return Err(AppError::Io {
                    message: format!("目标是目录，无法写入文件：{relative_path}"),
                });
            }
            Ok(_) => {}
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                if !is_leaf {
                    return Err(AppError::Io {
                        message: format!("父目录不存在：{}", candidate.display()),
                    });
                }
            }
            Err(error) => return Err(error.into()),
        }
    }
    if !candidate.starts_with(&canonical_root) {
        return Err(outside_error(&candidate));
    }
    Ok(candidate)
}

fn outside_error(path: &Path) -> AppError {
    AppError::PathOutsideManagedRoots {
        path: path.display().to_string(),
    }
}

fn unsupported(relative_path: &str, message: &str) -> FileContent {
    FileContent {
        relative_path: relative_path.to_string(),
        media_type: "unsupported".to_string(),
        content: None,
        message: Some(message.to_string()),
    }
}

#[cfg(test)]
mod tests {
    use std::fs;

    use tempfile::tempdir;

    use super::{list_skill_tree, read_skill_file};
    use crate::model::FileNodeKind;
    use crate::paths::AppPaths;
    use crate::skill_repository::SkillRepository;

    fn repository_with_skill() -> (tempfile::TempDir, SkillRepository, String) {
        let base = tempdir().unwrap();
        let paths = AppPaths::for_test(base.path());
        let skill_dir = paths.skill_roots[0].path.join("preview");
        fs::create_dir_all(skill_dir.join("references")).unwrap();
        fs::write(skill_dir.join("SKILL.md"), "# Preview").unwrap();
        fs::write(skill_dir.join("references/example.txt"), "example text").unwrap();
        fs::write(skill_dir.join("data.bin"), [0, 159, 146, 150]).unwrap();
        let repository = SkillRepository::new(paths);
        let id = repository.scan().unwrap()[0].id.clone();
        (base, repository, id)
    }

    #[test]
    fn lists_sorted_recursive_tree_with_file_sizes() {
        let (_base, repository, id) = repository_with_skill();

        let tree = list_skill_tree(&repository, &id).unwrap();

        assert_eq!(tree.len(), 3);
        assert_eq!(tree[0].name, "data.bin");
        assert_eq!(tree[0].kind, FileNodeKind::File);
        assert_eq!(tree[0].size, Some(4));
        assert_eq!(tree[1].name, "references");
        assert_eq!(tree[1].kind, FileNodeKind::Directory);
        assert_eq!(tree[1].relative_path, "references");
        assert_eq!(tree[1].size, None);
        assert_eq!(tree[1].children.len(), 1);
        assert_eq!(tree[1].children[0].relative_path, "references/example.txt");
        assert_eq!(tree[2].name, "SKILL.md");
    }

    #[test]
    fn reads_markdown_and_text_files() {
        let (_base, repository, id) = repository_with_skill();

        let markdown = read_skill_file(&repository, &id, "SKILL.md").unwrap();
        let text = read_skill_file(&repository, &id, "references/example.txt").unwrap();

        assert_eq!(markdown.media_type, "markdown");
        assert_eq!(markdown.content.as_deref(), Some("# Preview"));
        assert_eq!(markdown.message, None);
        assert_eq!(text.media_type, "text");
        assert_eq!(text.content.as_deref(), Some("example text"));
    }

    #[test]
    fn rejects_parent_and_absolute_path_escape() {
        let (_base, repository, id) = repository_with_skill();

        let parent = read_skill_file(&repository, &id, "../secret.txt").unwrap_err();
        let absolute = read_skill_file(&repository, &id, "/tmp/secret.txt").unwrap_err();

        assert!(matches!(
            parent,
            crate::error::AppError::PathOutsideManagedRoots { .. }
        ));
        assert!(matches!(
            absolute,
            crate::error::AppError::PathOutsideManagedRoots { .. }
        ));
    }

    #[test]
    fn returns_unsupported_for_binary_and_oversized_files() {
        let (_base, repository, id) = repository_with_skill();
        let skill_path = repository.detail(&id).unwrap().current_path;
        fs::write(skill_path.join("large.txt"), vec![b'a'; 512 * 1024 + 1]).unwrap();
        fs::write(skill_path.join("nul.txt"), b"ok\0still-utf8").unwrap();

        let binary = read_skill_file(&repository, &id, "data.bin").unwrap();
        let large = read_skill_file(&repository, &id, "large.txt").unwrap();
        let nul_text = read_skill_file(&repository, &id, "nul.txt").unwrap();

        assert_eq!(binary.media_type, "unsupported");
        assert_eq!(binary.content, None);
        assert!(binary.message.unwrap().contains("二进制"));
        assert_eq!(large.media_type, "unsupported");
        assert_eq!(large.content, None);
        assert!(large.message.unwrap().contains("512 KiB"));
        assert_eq!(nul_text.media_type, "unsupported");
        assert_eq!(nul_text.content, None);
        assert!(nul_text.message.unwrap().contains("二进制"));
    }

    #[cfg(unix)]
    #[test]
    fn tree_does_not_follow_symlink_and_preview_rejects_it() {
        use std::os::unix::fs::symlink;

        let (_base, repository, id) = repository_with_skill();
        let outside = tempdir().unwrap();
        fs::create_dir_all(outside.path().join("nested")).unwrap();
        fs::write(outside.path().join("nested/secret.txt"), "secret").unwrap();
        let skill_path = repository.detail(&id).unwrap().current_path;
        symlink(outside.path().join("nested"), skill_path.join("linked")).unwrap();
        symlink(
            outside.path().join("missing-target"),
            skill_path.join("dangling"),
        )
        .unwrap();

        let tree = list_skill_tree(&repository, &id).unwrap();
        let linked = tree.iter().find(|node| node.name == "linked").unwrap();
        let dangling = tree.iter().find(|node| node.name == "dangling").unwrap();

        assert_eq!(linked.kind, FileNodeKind::File);
        assert!(linked.children.is_empty());
        assert_eq!(dangling.kind, FileNodeKind::File);
        assert!(dangling.children.is_empty());
        assert!(read_skill_file(&repository, &id, "linked/secret.txt").is_err());
    }
}
