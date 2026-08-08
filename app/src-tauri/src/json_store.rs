use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::Path;

use serde::de::DeserializeOwned;
use serde::Serialize;
use uuid::Uuid;

use crate::error::AppError;

pub(crate) fn read_json<T, Error>(path: &Path, parse_error: Error) -> Result<Vec<T>, AppError>
where
    T: DeserializeOwned,
    Error: FnOnce(String) -> AppError,
{
    let bytes = match fs::read(path) {
        Ok(bytes) => bytes,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(error) => return Err(error.into()),
    };
    serde_json::from_slice(&bytes).map_err(|error| parse_error(error.to_string()))
}

pub(crate) fn write_json<T, Error>(
    path: &Path,
    records: &[T],
    serialization_error: Error,
) -> Result<(), AppError>
where
    T: Serialize,
    Error: FnOnce(String) -> AppError,
{
    let bytes = serde_json::to_vec_pretty(records)
        .map_err(|error| serialization_error(error.to_string()))?;
    atomic_write(path, &bytes)
}

pub(crate) fn read_json_value<T, Error>(
    path: &Path,
    default: impl FnOnce() -> T,
    parse_error: Error,
) -> Result<T, AppError>
where
    T: DeserializeOwned,
    Error: FnOnce(String) -> AppError,
{
    let bytes = match fs::read(path) {
        Ok(bytes) => bytes,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(default()),
        Err(error) => return Err(error.into()),
    };
    serde_json::from_slice(&bytes).map_err(|error| parse_error(error.to_string()))
}

pub(crate) fn write_json_value<T, Error>(
    path: &Path,
    value: &T,
    serialization_error: Error,
) -> Result<(), AppError>
where
    T: Serialize,
    Error: FnOnce(String) -> AppError,
{
    let bytes =
        serde_json::to_vec_pretty(value).map_err(|error| serialization_error(error.to_string()))?;
    atomic_write(path, &bytes)
}

fn atomic_write(path: &Path, bytes: &[u8]) -> Result<(), AppError> {
    let parent = path.parent().ok_or_else(|| AppError::Io {
        message: format!("索引路径缺少父目录：{}", path.display()),
    })?;
    let temp_path = parent.join(format!(".json-index-{}.tmp", Uuid::new_v4()));
    let result = (|| {
        let mut file = OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&temp_path)?;
        file.write_all(bytes)?;
        file.sync_all()?;
        replace_index(&temp_path, path)
    })();
    if result.is_err() {
        let _ = fs::remove_file(&temp_path);
    }
    result
}

#[cfg(not(windows))]
fn replace_index(temp_path: &Path, path: &Path) -> Result<(), AppError> {
    fs::rename(temp_path, path)?;
    Ok(())
}

#[cfg(windows)]
fn replace_index(temp_path: &Path, path: &Path) -> Result<(), AppError> {
    if !path.exists() {
        fs::rename(temp_path, path)?;
        return Ok(());
    }
    let old_path = path.with_extension(format!("old-{}", Uuid::new_v4()));
    replace_existing_index_with_backup(
        temp_path,
        path,
        &old_path,
        |from, to| fs::rename(from, to),
        |old| fs::remove_file(old),
    )
}

#[cfg(any(windows, test))]
pub(crate) fn replace_existing_index_with_backup<Rename, Remove>(
    temp_path: &Path,
    path: &Path,
    old_path: &Path,
    mut rename: Rename,
    mut remove_old: Remove,
) -> Result<(), AppError>
where
    Rename: FnMut(&Path, &Path) -> std::io::Result<()>,
    Remove: FnMut(&Path) -> std::io::Result<()>,
{
    rename(path, old_path)?;
    match rename(temp_path, path) {
        Ok(()) => {
            if let Err(error) = remove_old(old_path) {
                eprintln!("已隔离无法清理的旧索引 {}：{error}", old_path.display());
            }
            Ok(())
        }
        Err(commit_error) => match rename(old_path, path) {
            Ok(()) => Err(commit_error.into()),
            Err(restore_error) => Err(AppError::MoveRollback {
                message: format!("替换索引失败：{commit_error}；恢复旧索引失败：{restore_error}"),
            }),
        },
    }
}
