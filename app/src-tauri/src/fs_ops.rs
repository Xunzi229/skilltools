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
    for entry_result in iter_tree_no_follow_reparse(root) {
        let entry = entry_result.map_err(|error| AppError::Io {
            message: error.to_string(),
        })?;
        if entry.depth() < 1 {
            continue;
        }
        let path = entry
            .path()
            .strip_prefix(root)
            .map_err(|error| AppError::Io {
                message: error.to_string(),
            })?
            .to_path_buf();
        let metadata = fs::symlink_metadata(entry.path())?;
        let kind = if path_is_symlink_link(entry.path()) {
            ManifestEntryKind::Symlink {
                target: fs::read_link(entry.path())?,
            }
        } else if metadata.is_dir() {
            ManifestEntryKind::Directory
        } else if metadata.is_file() {
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
    for entry_result in iter_tree_no_follow_reparse(source) {
        let entry = entry_result.map_err(|error| AppError::Io {
            message: error.to_string(),
        })?;
        if entry.depth() < 1 {
            continue;
        }
        let relative = entry
            .path()
            .strip_prefix(source)
            .map_err(|error| AppError::Io {
                message: error.to_string(),
            })?;
        let destination = target.join(relative);
        let metadata = fs::symlink_metadata(entry.path())?;
        if path_is_symlink_link(entry.path()) {
            copy_symlink(entry.path(), &destination, &metadata)?;
        } else if metadata.is_dir() {
            fs::create_dir(&destination)?;
        } else if metadata.is_file() {
            fs::copy(entry.path(), destination)?;
        }
    }
    Ok(())
}

/// 不跟随 symlink/junction：父路径是链接时跳过其子项，避免 WalkDir 把 junction 当目录递归。
fn iter_tree_no_follow_reparse(
    root: &Path,
) -> impl Iterator<Item = Result<walkdir::DirEntry, walkdir::Error>> {
    let root = root.to_path_buf();
    WalkDir::new(&root)
        .follow_links(false)
        .into_iter()
        .filter_entry(move |entry| {
            if entry.depth() == 0 {
                return true;
            }
            match entry.path().parent() {
                Some(parent) if parent != root => !path_is_symlink_link(parent),
                _ => true,
            }
        })
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
/// Windows：仅白名单 reparse tag（symlink / mount point·junction），排除 OneDrive 等云占位。
pub(crate) fn is_symlink_link(metadata: &fs::Metadata) -> bool {
    if metadata.file_type().is_symlink() {
        return true;
    }
    // 无路径时无法读 reparse tag；保守为 false，调用方应优先用 path_is_symlink_link。
    let _ = metadata;
    false
}

pub(crate) fn path_is_symlink_link(path: &Path) -> bool {
    let Ok(metadata) = fs::symlink_metadata(path) else {
        return false;
    };
    if metadata.file_type().is_symlink() {
        return true;
    }
    #[cfg(windows)]
    {
        is_windows_symlink_or_junction(path, &metadata)
    }
    #[cfg(not(windows))]
    {
        let _ = metadata;
        false
    }
}

#[cfg(windows)]
fn is_windows_symlink_or_junction(path: &Path, metadata: &fs::Metadata) -> bool {
    use std::os::windows::fs::MetadataExt;

    const FILE_ATTRIBUTE_REPARSE_POINT: u32 = 0x400;
    if metadata.file_attributes() & FILE_ATTRIBUTE_REPARSE_POINT == 0 {
        return false;
    }
    match windows_reparse_tag(path) {
        Some(tag) if is_whitelisted_reparse_tag(tag) => true,
        // 读 tag 失败时：仅当 Rust 已识别为 symlink_file/dir 才放行（不含纯云 reparse）
        None => {
            use std::os::windows::fs::FileTypeExt;
            let ft = metadata.file_type();
            ft.is_symlink_file() || ft.is_symlink_dir()
        }
        Some(_) => false,
    }
}

/// IO_REPARSE_TAG_MOUNT_POINT（junction）与 IO_REPARSE_TAG_SYMLINK。
#[cfg(windows)]
fn is_whitelisted_reparse_tag(tag: u32) -> bool {
    const IO_REPARSE_TAG_MOUNT_POINT: u32 = 0xA000_0003;
    const IO_REPARSE_TAG_SYMLINK: u32 = 0xA000_000C;
    tag == IO_REPARSE_TAG_MOUNT_POINT || tag == IO_REPARSE_TAG_SYMLINK
}

#[cfg(windows)]
fn windows_reparse_tag(path: &Path) -> Option<u32> {
    use std::os::windows::ffi::OsStrExt;

    #[repr(C)]
    struct ReparseDataBufferHeader {
        reparse_tag: u32,
        reparse_data_length: u16,
        reserved: u16,
    }

    #[link(name = "kernel32")]
    extern "system" {
        fn CreateFileW(
            lp_file_name: *const u16,
            dw_desired_access: u32,
            dw_share_mode: u32,
            lp_security_attributes: *mut core::ffi::c_void,
            dw_creation_disposition: u32,
            dw_flags_and_attributes: u32,
            h_template_file: *mut core::ffi::c_void,
        ) -> *mut core::ffi::c_void;
        fn DeviceIoControl(
            h_device: *mut core::ffi::c_void,
            dw_io_control_code: u32,
            lp_in_buffer: *mut core::ffi::c_void,
            n_in_buffer_size: u32,
            lp_out_buffer: *mut core::ffi::c_void,
            n_out_buffer_size: u32,
            lp_bytes_returned: *mut u32,
            lp_overlapped: *mut core::ffi::c_void,
        ) -> i32;
        fn CloseHandle(h_object: *mut core::ffi::c_void) -> i32;
    }

    const INVALID_HANDLE_VALUE: isize = -1;
    const GENERIC_READ: u32 = 0x8000_0000;
    const FILE_SHARE_READ: u32 = 0x1;
    const FILE_SHARE_WRITE: u32 = 0x2;
    const FILE_SHARE_DELETE: u32 = 0x4;
    const OPEN_EXISTING: u32 = 3;
    const FILE_FLAG_OPEN_REPARSE_POINT: u32 = 0x0020_0000;
    const FILE_FLAG_BACKUP_SEMANTICS: u32 = 0x0200_0000;
    const FSCTL_GET_REPARSE_POINT: u32 = 0x0009_0068;
    const MAXIMUM_REPARSE_DATA_BUFFER_SIZE: usize = 16 * 1024;

    let wide: Vec<u16> = path
        .as_os_str()
        .encode_wide()
        .chain(std::iter::once(0))
        .collect();
    unsafe {
        let handle = CreateFileW(
            wide.as_ptr(),
            GENERIC_READ,
            FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE,
            std::ptr::null_mut(),
            OPEN_EXISTING,
            FILE_FLAG_OPEN_REPARSE_POINT | FILE_FLAG_BACKUP_SEMANTICS,
            std::ptr::null_mut(),
        );
        if handle.is_null() || handle as isize == INVALID_HANDLE_VALUE {
            return None;
        }
        let mut buffer = vec![0u8; MAXIMUM_REPARSE_DATA_BUFFER_SIZE];
        let mut returned = 0u32;
        let ok = DeviceIoControl(
            handle,
            FSCTL_GET_REPARSE_POINT,
            std::ptr::null_mut(),
            0,
            buffer.as_mut_ptr().cast(),
            buffer.len() as u32,
            &mut returned,
            std::ptr::null_mut(),
        );
        CloseHandle(handle);
        if ok == 0 || (returned as usize) < std::mem::size_of::<ReparseDataBufferHeader>() {
            return None;
        }
        let header = &*(buffer.as_ptr() as *const ReparseDataBufferHeader);
        Some(header.reparse_tag)
    }
}

/// 创建目录安装链接：Unix symlink；Windows 先 symlink_dir，特权不足时回退 junction。
pub(crate) fn create_directory_link(source: &Path, target: &Path) -> Result<(), AppError> {
    #[cfg(unix)]
    {
        std::os::unix::fs::symlink(source, target).map_err(AppError::from)
    }
    #[cfg(windows)]
    {
        create_directory_link_windows(source, target)
    }
}

#[cfg(windows)]
fn create_directory_link_windows(source: &Path, target: &Path) -> Result<(), AppError> {
    use std::os::windows::fs::symlink_dir;

    let target_abs = if target.is_absolute() {
        target.to_path_buf()
    } else {
        std::env::current_dir()
            .map(|cwd| cwd.join(target))
            .unwrap_or_else(|_| target.to_path_buf())
    };
    let source_candidate = if source.is_absolute() {
        source.to_path_buf()
    } else {
        target_abs
            .parent()
            .map(|parent| parent.join(source))
            .unwrap_or_else(|| source.to_path_buf())
    };
    let source_abs = fs::canonicalize(&source_candidate).unwrap_or(source_candidate);
    match symlink_dir(&source_abs, target) {
        Ok(()) => Ok(()),
        Err(error) if is_privilege_not_held(&error) => {
            if !crate::path_norm::same_windows_volume(&source_abs, &target_abs) {
                return Err(AppError::Io {
                    message: format!(
                        "创建安装链接失败：源与目标不在同一卷，无法使用 junction 回退（符号链接错误：{error}）。请启用 Windows「开发人员模式」（设置 → 系统 → 开发者选项）后重试。"
                    ),
                });
            }
            create_directory_junction(&source_abs, target).map_err(|junction_error| {
                AppError::Io {
                    message: format!(
                        "创建安装链接失败：需要管理员权限或启用 Windows「开发人员模式」（设置 → 系统 → 开发者选项）。符号链接错误：{error}；junction 回退错误：{junction_error}"
                    ),
                }
            })
        }
        Err(error) => Err(AppError::from(error)),
    }
}

#[cfg(windows)]
fn is_privilege_not_held(error: &std::io::Error) -> bool {
    // ERROR_PRIVILEGE_NOT_HELD
    error.raw_os_error() == Some(1314)
}

#[cfg(windows)]
fn create_directory_junction(source: &Path, target: &Path) -> Result<(), AppError> {
    use std::process::Command;

    let source_arg = strip_verbatim_prefix(source);
    let target_arg = strip_verbatim_prefix(target);
    let output = Command::new("cmd")
        .args(["/C", "mklink", "/J", &target_arg, &source_arg])
        .output()
        .map_err(|error| AppError::Io {
            message: format!("创建 junction 失败：{error}"),
        })?;
    if output.status.success() {
        return Ok(());
    }
    let stderr = String::from_utf8_lossy(&output.stderr);
    let stdout = String::from_utf8_lossy(&output.stdout);
    Err(AppError::Io {
        message: format!(
            "mklink /J 失败（{}）：{}{}",
            output.status,
            stderr.trim(),
            stdout.trim()
        ),
    })
}

#[cfg(windows)]
fn strip_verbatim_prefix(path: &Path) -> String {
    let text = path.to_string_lossy();
    if let Some(rest) = text.strip_prefix(r"\\?\UNC\") {
        format!(r"\\{rest}")
    } else if let Some(rest) = text.strip_prefix(r"\\?\") {
        rest.to_owned()
    } else {
        text.into_owned()
    }
}

/// 删除目录/文件符号链接（或 Windows junction）本身，绝不跟随到目标内容。
/// Windows 上目录链接必须用 `remove_dir`；误用 `remove_file` 会报拒绝访问 (os error 5)。
pub(crate) fn remove_directory_symlink(path: &Path) -> Result<(), AppError> {
    let metadata = fs::symlink_metadata(path)?;
    if !path_is_symlink_link(path) {
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
fn copy_symlink(source: &Path, target: &Path, _metadata: &fs::Metadata) -> Result<(), AppError> {
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
            super::path_is_symlink_link(&link),
            "junction should be treated as a directory link"
        );

        remove_directory_symlink(&link).unwrap();
        assert!(fs::symlink_metadata(&link).is_err());
        assert!(target.join("SKILL.md").is_file(), "不得删除 junction 目标内容");
    }

    #[cfg(windows)]
    #[test]
    fn relative_directory_link_source_is_resolved_from_target_parent() {
        let base = tempdir().unwrap();
        let parent = base.path().join("links");
        let source = parent.join("source");
        fs::create_dir_all(&source).unwrap();
        fs::write(source.join("SKILL.md"), "# relative").unwrap();
        let link = parent.join("linked");

        if let Err(error) = super::create_directory_link_windows(
            std::path::Path::new("source"),
            &link,
        ) {
            let message = error.to_string();
            if message.contains("特权")
                || message.contains("privilege")
                || message.contains("os error 1314")
            {
                eprintln!("skip: creating directory symlink requires privilege: {message}");
                return;
            }
            panic!("create_directory_link_windows failed: {message}");
        }

        assert_eq!(fs::read_to_string(link.join("SKILL.md")).unwrap(), "# relative");
    }
}

#[cfg(windows)]
fn copy_symlink(source: &Path, target: &Path, metadata: &fs::Metadata) -> Result<(), AppError> {
    use std::os::windows::fs::symlink_file;

    let link_target = fs::read_link(source)?;
    match classify_windows_link(metadata) {
        SymlinkKind::File => symlink_file(&link_target, target).map_err(AppError::from),
        SymlinkKind::Directory => create_directory_link(&link_target, target),
    }
}
