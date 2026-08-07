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
    use super::{dispatch_symlink_copy, SymlinkKind};

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
