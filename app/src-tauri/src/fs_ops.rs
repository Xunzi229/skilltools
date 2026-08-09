use std::fs::{self, File};
use std::io::Read;
use std::path::{Path, PathBuf};

use serde::Serialize;
use sha2::{Digest, Sha256};
use walkdir::WalkDir;

use crate::error::AppError;

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub(crate) enum ManifestEntryKind {
    Directory,
    File { sha256: String },
    Symlink { target: PathBuf },
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub(crate) struct ManifestEntry {
    path: PathBuf,
    #[serde(flatten)]
    kind: ManifestEntryKind,
}

pub(crate) fn directory_manifest(root: &Path) -> Result<Vec<ManifestEntry>, AppError> {
    let mut manifest = Vec::new();
    for entry_result in WalkDir::new(root).follow_links(false).min_depth(1) {
        let entry = entry_result.map_err(|error| AppError::Io {
            message: error.to_string(),
        })?;
        let path = entry
            .path()
            .strip_prefix(root)
            .map_err(|error| AppError::Io {
                message: error.to_string(),
            })?
            .to_path_buf();
        let kind = if entry.file_type().is_dir() {
            ManifestEntryKind::Directory
        } else if entry.file_type().is_symlink() {
            ManifestEntryKind::Symlink {
                target: fs::read_link(entry.path())?,
            }
        } else if entry.file_type().is_file() {
            ManifestEntryKind::File {
                sha256: sha256_file(entry.path())?,
            }
        } else {
            return Err(AppError::Io {
                message: format!("不支持的文件类型：{}", entry.path().display()),
            });
        };
        manifest.push(ManifestEntry { path, kind });
    }
    manifest.sort_by(|left, right| left.path.cmp(&right.path));
    Ok(manifest)
}

pub(crate) fn manifest_checksum(manifest: &[ManifestEntry]) -> Result<String, AppError> {
    let bytes = serde_json::to_vec(manifest).map_err(|error| AppError::Io {
        message: format!("无法序列化目录清单：{error}"),
    })?;
    Ok(hex_digest(&bytes))
}

pub(crate) fn copy_directory(source: &Path, target: &Path) -> Result<(), AppError> {
    fs::create_dir(target)?;
    for entry_result in WalkDir::new(source).follow_links(false).min_depth(1) {
        let entry = entry_result.map_err(|error| AppError::Io {
            message: error.to_string(),
        })?;
        let relative = entry
            .path()
            .strip_prefix(source)
            .map_err(|error| AppError::Io {
                message: error.to_string(),
            })?;
        let destination = target.join(relative);
        if entry.file_type().is_dir() {
            fs::create_dir(&destination)?;
        } else if entry.file_type().is_symlink() {
            copy_symlink(entry.path(), &destination, &entry.file_type())?;
        } else if entry.file_type().is_file() {
            fs::copy(entry.path(), destination)?;
        }
    }
    Ok(())
}

pub(crate) fn verify_directory_copy(source: &Path, target: &Path) -> Result<(), AppError> {
    if directory_manifest(source)? != directory_manifest(target)? {
        return Err(AppError::Io {
            message: format!(
                "目录复制校验失败：{} -> {}",
                source.display(),
                target.display()
            ),
        });
    }
    Ok(())
}

#[cfg(target_os = "macos")]
pub(crate) fn rename_directory_no_replace(source: &Path, target: &Path) -> Result<(), AppError> {
    use std::ffi::CString;
    use std::os::unix::ffi::OsStrExt;

    let source = CString::new(source.as_os_str().as_bytes()).map_err(|error| AppError::Io {
        message: error.to_string(),
    })?;
    let target_c = CString::new(target.as_os_str().as_bytes()).map_err(|error| AppError::Io {
        message: error.to_string(),
    })?;
    // SAFETY: 两个 CString 在调用期间有效且均以 NUL 结尾。
    let result = unsafe { libc::renamex_np(source.as_ptr(), target_c.as_ptr(), libc::RENAME_EXCL) };
    map_no_replace_result(result, target)
}

#[cfg(target_os = "linux")]
pub(crate) fn rename_directory_no_replace(source: &Path, target: &Path) -> Result<(), AppError> {
    use std::ffi::CString;
    use std::os::unix::ffi::OsStrExt;

    let source = CString::new(source.as_os_str().as_bytes()).map_err(|error| AppError::Io {
        message: error.to_string(),
    })?;
    let target_c = CString::new(target.as_os_str().as_bytes()).map_err(|error| AppError::Io {
        message: error.to_string(),
    })?;
    // SAFETY: 参数为有效 CString；renameat2 不保留指针。
    let result = unsafe {
        libc::syscall(
            libc::SYS_renameat2,
            libc::AT_FDCWD,
            source.as_ptr(),
            libc::AT_FDCWD,
            target_c.as_ptr(),
            libc::RENAME_NOREPLACE,
        )
    };
    map_no_replace_result(result as i32, target)
}

#[cfg(windows)]
pub(crate) fn rename_directory_no_replace(source: &Path, target: &Path) -> Result<(), AppError> {
    use std::os::windows::ffi::OsStrExt;

    #[link(name = "kernel32")]
    extern "system" {
        fn MoveFileExW(existing: *const u16, new: *const u16, flags: u32) -> i32;
    }

    let source: Vec<u16> = source.as_os_str().encode_wide().chain(Some(0)).collect();
    let target_wide: Vec<u16> = target.as_os_str().encode_wide().chain(Some(0)).collect();
    // SAFETY: 两个 UTF-16 缓冲区均以 NUL 结尾并在调用期间有效；flags=0 禁止替换。
    let result = unsafe { MoveFileExW(source.as_ptr(), target_wide.as_ptr(), 0) };
    map_no_replace_result(result, target)
}

#[cfg(not(any(target_os = "macos", target_os = "linux", windows)))]
pub(crate) fn rename_directory_no_replace(_source: &Path, target: &Path) -> Result<(), AppError> {
    Err(AppError::Io {
        message: format!(
            "当前平台不支持原子排他目录重命名，拒绝恢复到 {}",
            target.display()
        ),
    })
}

#[cfg(any(target_os = "macos", target_os = "linux"))]
fn map_no_replace_result(result: i32, target: &Path) -> Result<(), AppError> {
    if result == 0 {
        return Ok(());
    }
    let error = std::io::Error::last_os_error();
    if matches!(error.raw_os_error(), Some(libc::EEXIST | libc::ENOTEMPTY)) {
        return Err(AppError::TargetConflict {
            path: target.display().to_string(),
        });
    }
    Err(error.into())
}

#[cfg(windows)]
fn map_no_replace_result(result: i32, target: &Path) -> Result<(), AppError> {
    const ERROR_ALREADY_EXISTS: i32 = 183;
    const ERROR_FILE_EXISTS: i32 = 80;

    if result != 0 {
        return Ok(());
    }
    let error = std::io::Error::last_os_error();
    if matches!(
        error.raw_os_error(),
        Some(ERROR_ALREADY_EXISTS | ERROR_FILE_EXISTS)
    ) {
        return Err(AppError::TargetConflict {
            path: target.display().to_string(),
        });
    }
    Err(error.into())
}

fn sha256_file(path: &Path) -> Result<String, AppError> {
    let mut file = File::open(path)?;
    let mut digest = Sha256::new();
    let mut buffer = [0_u8; 8192];
    loop {
        let read = file.read(&mut buffer)?;
        if read == 0 {
            break;
        }
        digest.update(&buffer[..read]);
    }
    Ok(digest
        .finalize()
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect())
}

fn hex_digest(bytes: &[u8]) -> String {
    Sha256::digest(bytes)
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect()
}

/// 是否为应只删链接本身的符号链接/junction（不含普通目录/文件）。
pub(crate) fn is_symlink_link(metadata: &fs::Metadata) -> bool {
    if metadata.file_type().is_symlink() {
        return true;
    }
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        // Junction / mount point：带 REPARSE_POINT，但 `is_symlink()` 为 false。
        const FILE_ATTRIBUTE_REPARSE_POINT: u32 = 0x400;
        return metadata.file_attributes() & FILE_ATTRIBUTE_REPARSE_POINT != 0;
    }
    #[cfg(not(windows))]
    {
        false
    }
}

/// 删除目录/文件符号链接（或 Windows junction）本身，绝不跟随到目标内容。
/// Windows 上目录链接必须用 `remove_dir`；误用 `remove_file` 会报拒绝访问 (os error 5)。
pub(crate) fn remove_directory_symlink(path: &Path) -> Result<(), AppError> {
    let metadata = fs::symlink_metadata(path)?;
    if !is_symlink_link(&metadata) {
        return Err(AppError::TargetConflict {
            path: path.display().to_string(),
        });
    }

    #[cfg(windows)]
    {
        clear_reparse_point_readonly(path);
        let remove_result = match classify_windows_link(&metadata) {
            SymlinkKind::Directory => fs::remove_dir(path),
            SymlinkKind::File => fs::remove_file(path),
        };
        match remove_result {
            Ok(()) => Ok(()),
            Err(error) if error.kind() == std::io::ErrorKind::NotADirectory => {
                fs::remove_file(path).map_err(|error| map_link_remove_error(path, error))
            }
            Err(error) => Err(map_link_remove_error(path, error)),
        }
    }

    #[cfg(not(windows))]
    {
        fs::remove_file(path).map_err(|error| map_link_remove_error(path, error))
    }
}

fn map_link_remove_error(path: &Path, error: std::io::Error) -> AppError {
    AppError::Io {
        message: format!(
            "删除安装链接失败（{}）：{}",
            path.display(),
            error
        ),
    }
}

#[cfg(windows)]
fn classify_windows_link(metadata: &fs::Metadata) -> SymlinkKind {
    use std::os::windows::fs::{FileTypeExt, MetadataExt};

    let file_type = metadata.file_type();
    if file_type.is_symlink_file() {
        return SymlinkKind::File;
    }
    if file_type.is_symlink_dir() {
        return SymlinkKind::Directory;
    }
    // Junction 等目录 reparse point：按目录链接删除。
    const FILE_ATTRIBUTE_DIRECTORY: u32 = 0x10;
    if metadata.file_attributes() & FILE_ATTRIBUTE_DIRECTORY != 0 {
        SymlinkKind::Directory
    } else {
        SymlinkKind::File
    }
}

/// 仅清除链接自身的只读属性，不跟随目标（`fs::set_permissions` 会穿透 symlink）。
#[cfg(windows)]
fn clear_reparse_point_readonly(path: &Path) {
    use std::os::windows::ffi::OsStrExt;

    #[link(name = "kernel32")]
    extern "system" {
        fn GetFileAttributesW(lp_file_name: *const u16) -> u32;
        fn SetFileAttributesW(lp_file_name: *const u16, dw_file_attributes: u32) -> i32;
    }

    const INVALID_FILE_ATTRIBUTES: u32 = u32::MAX;
    const FILE_ATTRIBUTE_READONLY: u32 = 0x1;

    let wide: Vec<u16> = path
        .as_os_str()
        .encode_wide()
        .chain(std::iter::once(0))
        .collect();
    unsafe {
        let attrs = GetFileAttributesW(wide.as_ptr());
        if attrs == INVALID_FILE_ATTRIBUTES {
            return;
        }
        if attrs & FILE_ATTRIBUTE_READONLY != 0 {
            let _ = SetFileAttributesW(wide.as_ptr(), attrs & !FILE_ATTRIBUTE_READONLY);
        }
    }
}

#[cfg(any(windows, test))]
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum SymlinkKind {
    File,
    Directory,
}

#[cfg(any(windows, test))]
fn dispatch_symlink_copy<T, FileCopy, DirectoryCopy>(
    kind: SymlinkKind,
    copy_file: FileCopy,
    copy_directory: DirectoryCopy,
) -> std::io::Result<T>
where
    FileCopy: FnOnce() -> std::io::Result<T>,
    DirectoryCopy: FnOnce() -> std::io::Result<T>,
{
    match kind {
        SymlinkKind::File => copy_file(),
        SymlinkKind::Directory => copy_directory(),
    }
}

#[cfg(unix)]
fn copy_symlink(source: &Path, target: &Path, _file_type: &fs::FileType) -> Result<(), AppError> {
    use std::os::unix::fs::symlink;

    symlink(fs::read_link(source)?, target)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{dispatch_symlink_copy, remove_directory_symlink, SymlinkKind};
    use crate::error::AppError;
    use std::fs;
    use tempfile::tempdir;

    #[test]
    fn symlink_copy_dispatch_uses_link_kind_without_target_probe() {
        let selected = dispatch_symlink_copy(
            SymlinkKind::Directory,
            || -> Result<&'static str, std::io::Error> { panic!("不得按文件链接复制") },
            || Ok("directory"),
        )
        .unwrap();

        assert_eq!(selected, "directory");

        let selected = dispatch_symlink_copy(
            SymlinkKind::File,
            || Ok("file"),
            || -> Result<&'static str, std::io::Error> { panic!("不得按目录链接复制") },
        )
        .unwrap();
        assert_eq!(selected, "file");
    }

    #[test]
    fn remove_directory_symlink_rejects_real_directory() {
        let dir = tempdir().unwrap();
        let err = remove_directory_symlink(dir.path()).unwrap_err();
        assert!(matches!(err, AppError::TargetConflict { .. }));
    }

    #[cfg(windows)]
    #[test]
    fn remove_directory_symlink_removes_dir_link_keeps_target() {
        use std::os::windows::fs::symlink_dir;

        let base = tempdir().unwrap();
        let target = base.path().join("target");
        fs::create_dir_all(&target).unwrap();
        fs::write(target.join("SKILL.md"), "# keep").unwrap();
        let link = base.path().join("link");
        if let Err(error) = symlink_dir(&target, &link) {
            let message = error.to_string();
            if message.contains("特权")
                || message.contains("privilege")
                || message.contains("os error 1314")
            {
                eprintln!("skip: creating directory symlink requires privilege: {message}");
                return;
            }
            panic!("symlink_dir failed: {message}");
        }

        remove_directory_symlink(&link).unwrap();
        assert!(fs::symlink_metadata(&link).is_err());
        assert!(target.join("SKILL.md").is_file());
    }

    #[cfg(windows)]
    #[test]
    fn remove_directory_symlink_removes_junction_keeps_target() {
        let base = tempdir().unwrap();
        let target = base.path().join("target");
        fs::create_dir_all(&target).unwrap();
        fs::write(target.join("SKILL.md"), "# keep").unwrap();
        let link = base.path().join("junction");
        let status = std::process::Command::new("cmd")
            .args([
                "/C",
                "mklink",
                "/J",
                &link.to_string_lossy(),
                &target.to_string_lossy(),
            ])
            .status()
            .expect("spawn mklink");
        assert!(status.success(), "mklink /J failed: {status}");
        assert!(
            super::is_symlink_link(&fs::symlink_metadata(&link).unwrap()),
            "junction should be treated as a directory link"
        );

        remove_directory_symlink(&link).unwrap();
        assert!(fs::symlink_metadata(&link).is_err());
        assert!(target.join("SKILL.md").is_file(), "不得删除 junction 目标内容");
    }
}

#[cfg(windows)]
fn copy_symlink(source: &Path, target: &Path, file_type: &fs::FileType) -> Result<(), AppError> {
    use std::os::windows::fs::{symlink_dir, symlink_file, FileTypeExt};

    let link_target = fs::read_link(source)?;
    let kind = if file_type.is_symlink_dir() {
        SymlinkKind::Directory
    } else if file_type.is_symlink_file() {
        SymlinkKind::File
    } else {
        return Err(AppError::Io {
            message: format!("无法识别 Windows 符号链接类型：{}", source.display()),
        });
    };
    dispatch_symlink_copy(
        kind,
        || symlink_file(&link_target, target),
        || symlink_dir(&link_target, target),
    )?;
    Ok(())
}
