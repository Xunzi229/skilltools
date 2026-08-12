use std::fs;
use std::path::{Path, PathBuf};

use chrono::Utc;
use uuid::Uuid;

use crate::error::AppError;
use crate::fs_ops::{
    copy_directory, create_directory_link, directory_manifest, manifest_checksum,
    path_is_symlink_link, remove_directory_symlink, rename_directory_no_replace, ManifestEntry,
};

/// 软链 Skill 删除/备份归档标记：只记录链接目标，恢复时重建链接。
const SYMLINK_TARGET_MARKER: &str = ".skill-manager-symlink-target";
use crate::json_store::{read_json, write_json};
use crate::model::{BackupArchiveKind, BackupReason, BackupRecord, SkillDetail, SkillStatus};
use crate::paths::AppPaths;
use crate::skill_repository::SkillRepository;
use crate::transaction_lock::{lock_app_transaction, AppTransactionGuard};

pub struct BackupRepository {
    paths: AppPaths,
}

impl BackupRepository {
    pub fn new(paths: AppPaths) -> Self {
        Self { paths }
    }

    pub fn set_paths(&mut self, paths: AppPaths) {
        self.paths = paths;
    }

    pub fn create_backup(
        &self,
        skill_id: &str,
        reason: BackupReason,
    ) -> Result<BackupRecord, AppError> {
        self.create_backup_with_hook(skill_id, reason, || {})
    }

    fn create_backup_with_hook<Action>(
        &self,
        skill_id: &str,
        reason: BackupReason,
        after_lock: Action,
    ) -> Result<BackupRecord, AppError>
    where
        Action: FnOnce(),
    {
        let _guard = self.lock_transaction()?;
        after_lock();
        let detail = SkillRepository::new(self.paths.clone()).detail(skill_id)?;
        self.create_backup_from_source_unlocked(&detail, &detail.current_path, reason)
    }

    fn create_backup_from_source_unlocked(
        &self,
        detail: &SkillDetail,
        source: &Path,
        reason: BackupReason,
    ) -> Result<BackupRecord, AppError> {
        self.create_backup_from_source_with_index_writer_unlocked(
            detail,
            source,
            reason,
            |records| self.write_records(records),
        )
    }

    #[cfg(test)]
    fn create_backup_with_index_writer<Writer>(
        &self,
        skill_id: &str,
        reason: BackupReason,
        write_index: Writer,
    ) -> Result<BackupRecord, AppError>
    where
        Writer: FnOnce(&[BackupRecord]) -> Result<(), AppError>,
    {
        let _guard = self.lock_transaction()?;
        let detail = SkillRepository::new(self.paths.clone()).detail(skill_id)?;
        self.create_backup_from_source_with_index_writer_unlocked(
            &detail,
            &detail.current_path,
            reason,
            write_index,
        )
    }

    fn create_backup_from_source_with_index_writer_unlocked<Writer>(
        &self,
        detail: &SkillDetail,
        source: &Path,
        reason: BackupReason,
        write_index: Writer,
    ) -> Result<BackupRecord, AppError>
    where
        Writer: FnOnce(&[BackupRecord]) -> Result<(), AppError>,
    {
        self.paths.assert_skill_access(source)?;
        self.paths.assert_allowed(&self.paths.backups_dir)?;
        self.paths.assert_allowed(&self.paths.backup_index)?;
        let mut records = self.load_records()?;

        let id = Uuid::new_v4().to_string();
        let created_at = Utc::now();
        let skill_backup_dir = self.paths.backups_dir.join(&detail.id);
        let archive_path =
            skill_backup_dir.join(format!("{}-{id}", created_at.format("%Y%m%dT%H%M%S%.9fZ")));
        let temp_path = skill_backup_dir.join(format!(".tmp-{}", Uuid::new_v4()));
        self.paths.assert_allowed(&skill_backup_dir)?;
        self.paths.assert_allowed(&archive_path)?;
        self.paths.assert_allowed(&temp_path)?;
        fs::create_dir_all(&skill_backup_dir)?;

        let (manifest, archive_kind) = if is_symlink(source) {
            (
                archive_provider_symlink(source, &temp_path)?,
                BackupArchiveKind::ProviderSymlink,
            )
        } else {
            (
                copy_verified_directory(source, &temp_path)?,
                BackupArchiveKind::Directory,
            )
        };
        let checksum = manifest_checksum(&manifest)?;
        if let Err(error) = fs::rename(&temp_path, &archive_path) {
            remove_directory_if_present(&temp_path, "备份临时目录");
            return Err(error.into());
        }

        let record = BackupRecord {
            id,
            skill_id: detail.id.clone(),
            skill_name: detail.name.clone(),
            provider: detail.provider,
            reason,
            created_at,
            original_path: detail.original_path.clone(),
            archive_path: archive_path.clone(),
            checksum,
            archive_kind: Some(archive_kind),
        };
        records.push(record.clone());
        if let Err(index_error) = write_index(&records) {
            if let Err(cleanup_error) = fs::remove_dir_all(&archive_path) {
                eprintln!(
                    "备份索引写入失败后无法清理正式备份 {}：{cleanup_error}",
                    archive_path.display()
                );
            }
            return Err(index_error);
        }
        Ok(record)
    }

    pub fn list_backups(&self) -> Result<Vec<BackupRecord>, AppError> {
        let _guard = self.lock_transaction()?;
        let mut records = self.load_records()?;
        records.sort_by(|left, right| {
            right
                .created_at
                .cmp(&left.created_at)
                .then_with(|| left.id.cmp(&right.id))
        });
        Ok(records)
    }

    pub fn delete_backup(&self, backup_id: &str) -> Result<(), AppError> {
        let _guard = self.lock_transaction()?;
        let mut records = self.load_records()?;
        self.delete_backup_unlocked(&mut records, backup_id)?;
        self.write_records(&records)?;
        Ok(())
    }

    fn delete_backup_unlocked(
        &self,
        records: &mut Vec<BackupRecord>,
        backup_id: &str,
    ) -> Result<(), AppError> {
        let position = records
            .iter()
            .position(|record| record.id == backup_id)
            .ok_or_else(|| AppError::BackupNotFound {
                id: backup_id.to_owned(),
            })?;
        let record = records.remove(position);
        self.paths
            .assert_within(&record.archive_path, &self.paths.backups_dir)?;
        if record.archive_path.exists() {
            if record.archive_path.is_dir() {
                fs::remove_dir_all(&record.archive_path)?;
            } else {
                fs::remove_file(&record.archive_path)?;
            }
        }
        Ok(())
    }

    /// Delete backups past retention days and/or exceeding max count (oldest first).
    pub fn cleanup_backups(
        &self,
        retention_days: Option<u32>,
        max_count: Option<u32>,
    ) -> Result<usize, AppError> {
        let _guard = self.lock_transaction()?;
        let mut records = self.load_records()?;
        records.sort_by(|left, right| {
            left.created_at
                .cmp(&right.created_at)
                .then_with(|| left.id.cmp(&right.id))
        });
        let mut deleted = 0usize;
        if let Some(days) = retention_days {
            let cutoff = Utc::now() - chrono::Duration::days(i64::from(days));
            let expired: Vec<String> = records
                .iter()
                .filter(|record| record.created_at < cutoff)
                .map(|record| record.id.clone())
                .collect();
            for id in expired {
                if self.delete_backup_unlocked(&mut records, &id).is_ok() {
                    deleted += 1;
                }
            }
        }
        if let Some(max) = max_count {
            let keep = usize::try_from(max).unwrap_or(usize::MAX);
            if records.len() > keep {
                let excess = records.len() - keep;
                let oldest: Vec<String> = records
                    .iter()
                    .take(excess)
                    .map(|record| record.id.clone())
                    .collect();
                for id in oldest {
                    if self.delete_backup_unlocked(&mut records, &id).is_ok() {
                        deleted += 1;
                    }
                }
            }
        }
        self.write_records(&records)?;
        Ok(deleted)
    }

    pub fn restore_backup(&self, backup_id: &str) -> Result<SkillDetail, AppError> {
        self.restore_backup_with_hooks(
            backup_id,
            || {},
            remove_restored_skill_path,
            |skill_id| SkillRepository::new(self.paths.clone()).detail(skill_id),
        )
    }

    #[cfg(test)]
    fn restore_backup_with_hook<Action>(
        &self,
        backup_id: &str,
        before_commit: Action,
    ) -> Result<SkillDetail, AppError>
    where
        Action: FnOnce(),
    {
        self.restore_backup_with_hooks(
            backup_id,
            before_commit,
            |path| fs::remove_dir_all(path),
            |skill_id| SkillRepository::new(self.paths.clone()).detail(skill_id),
        )
    }

    #[cfg(test)]
    fn restore_backup_with_failures<Rollback, Detail>(
        &self,
        backup_id: &str,
        rollback: Rollback,
        load_detail: Detail,
    ) -> Result<SkillDetail, AppError>
    where
        Rollback: FnOnce(&Path) -> std::io::Result<()>,
        Detail: FnOnce(&str) -> Result<SkillDetail, AppError>,
    {
        self.restore_backup_with_hooks(backup_id, || {}, rollback, load_detail)
    }

    fn restore_backup_with_hooks<Action, Rollback, Detail>(
        &self,
        backup_id: &str,
        before_commit: Action,
        rollback: Rollback,
        load_detail: Detail,
    ) -> Result<SkillDetail, AppError>
    where
        Action: FnOnce(),
        Rollback: FnOnce(&Path) -> std::io::Result<()>,
        Detail: FnOnce(&str) -> Result<SkillDetail, AppError>,
    {
        let _guard = self.lock_transaction()?;
        let record = self
            .load_records()?
            .into_iter()
            .find(|record| record.id == backup_id)
            .ok_or_else(|| AppError::BackupNotFound {
                id: backup_id.to_owned(),
            })?;
        self.paths
            .assert_within(&record.archive_path, &self.paths.backups_dir)?;
        let provider_root = self.paths.provider_root(record.provider)?;
        self.paths
            .assert_within(&record.original_path, provider_root)?;
        if let Some(existing) = SkillRepository::new(self.paths.clone())
            .scan()?
            .into_iter()
            .find(|skill| skill.id == record.skill_id)
        {
            return Err(AppError::TargetConflict {
                path: existing.current_path.display().to_string(),
            });
        }
        let archive_manifest = directory_manifest(&record.archive_path)?;
        if manifest_checksum(&archive_manifest)? != record.checksum {
            return Err(AppError::BackupVerificationFailed {
                id: backup_id.to_owned(),
            });
        }
        if record.original_path.exists() {
            return Err(AppError::TargetConflict {
                path: record.original_path.display().to_string(),
            });
        }

        let parent = record.original_path.parent().ok_or_else(|| AppError::Io {
            message: format!("恢复目标缺少父目录：{}", record.original_path.display()),
        })?;
        self.paths.assert_allowed(parent)?;
        fs::create_dir_all(parent)?;
        let temp_path = parent.join(format!(".restore-{}", Uuid::new_v4()));
        self.paths.assert_allowed(&temp_path)?;
        let restore_as_symlink = match record.archive_kind {
            Some(BackupArchiveKind::ProviderSymlink) => true,
            Some(BackupArchiveKind::Directory) => false,
            None => is_legacy_provider_symlink_archive(&record.archive_path),
        };
        if restore_as_symlink {
            if let Err(error) = restore_provider_symlink_archive(&record.archive_path, &temp_path) {
                let _ = remove_restored_skill_path(&temp_path);
                return Err(error);
            }
        } else {
            let copied_manifest = copy_verified_directory(&record.archive_path, &temp_path)?;
            if copied_manifest != archive_manifest {
                remove_directory_if_present(&temp_path, "恢复临时目录");
                return Err(AppError::BackupVerificationFailed {
                    id: backup_id.to_owned(),
                });
            }
        }
        before_commit();
        if let Err(error) = rename_directory_no_replace(&temp_path, &record.original_path) {
            let _ = remove_restored_skill_path(&temp_path);
            return Err(error);
        }
        match load_detail(&record.skill_id) {
            Ok(detail)
                if detail.status == SkillStatus::Active
                    && detail.current_path == record.original_path =>
            {
                Ok(detail)
            }
            Ok(_) => Err(restore_failure_with_rollback(
                AppError::BackupVerificationFailed {
                    id: record.id.clone(),
                },
                &record.original_path,
                rollback,
            )),
            Err(original_error) => Err(restore_failure_with_rollback(
                original_error,
                &record.original_path,
                rollback,
            )),
        }
    }

    pub fn delete_skill(&self, skill_id: &str) -> Result<BackupRecord, AppError> {
        self.delete_skill_with_hook(skill_id, || {})
    }

    fn delete_skill_with_hook<Action>(
        &self,
        skill_id: &str,
        after_freeze: Action,
    ) -> Result<BackupRecord, AppError>
    where
        Action: FnOnce(),
    {
        let _guard = self.lock_transaction()?;
        let skill_repository = SkillRepository::new(self.paths.clone());
        let detail = skill_repository.detail(skill_id)?;
        self.paths.assert_skill_access(&detail.current_path)?;
        let parent = detail.current_path.parent().ok_or_else(|| AppError::Io {
            message: format!("删除源路径缺少父目录：{}", detail.current_path.display()),
        })?;
        self.paths.assert_allowed(parent)?;

        // 符号链接 Skill：只移除链接本身，不碰原始目标目录。
        if is_symlink(&detail.current_path) {
            let backup = self.create_backup_from_source_unlocked(
                &detail,
                &detail.current_path,
                BackupReason::BeforeDelete,
            )?;
            if detail.status == SkillStatus::Paused {
                let mut records = skill_repository.load_pause_records()?;
                records.retain(|record| record.skill_id != skill_id);
                skill_repository.write_pause_records(&records)?;
            }
            remove_directory_symlink(&detail.current_path)?;
            after_freeze();
            return Ok(backup);
        }

        let tombstone = parent.join(format!(".skill-delete-{}.tombstone", Uuid::new_v4()));
        self.paths.assert_allowed(&tombstone)?;

        let mut pause_records = if detail.status == SkillStatus::Paused {
            Some(skill_repository.load_pause_records()?)
        } else {
            None
        };
        // 安全顺序：先用同文件系统 rename 冻结待删除对象，再从 tombstone 备份。
        // 这样备份与最终删除始终指向同一对象；失败时 tombstone 仍可排他回滚。
        fs::rename(&detail.current_path, &tombstone)?;
        after_freeze();
        let backup = match self.create_backup_from_source_unlocked(
            &detail,
            &tombstone,
            BackupReason::BeforeDelete,
        ) {
            Ok(backup) => backup,
            Err(error) => {
                rollback_tombstone(&tombstone, &detail.current_path, &error)?;
                return Err(error);
            }
        };
        if let Some(records) = pause_records.as_mut() {
            records.retain(|record| record.skill_id != skill_id);
            if let Err(index_error) = skill_repository.write_pause_records(records) {
                rollback_tombstone(&tombstone, &detail.current_path, &index_error)?;
                return Err(index_error);
            }
        }
        if let Err(error) = fs::remove_dir_all(&tombstone) {
            eprintln!(
                "已隔离无法清理的删除墓碑目录 {}：{error}",
                tombstone.display()
            );
        }
        Ok(backup)
    }

    fn lock_transaction(&self) -> Result<AppTransactionGuard, AppError> {
        lock_app_transaction(&self.paths)
    }

    fn load_records(&self) -> Result<Vec<BackupRecord>, AppError> {
        self.paths.assert_allowed(&self.paths.backup_index)?;
        read_json(&self.paths.backup_index, |error| AppError::BackupIndex {
            message: format!(
                "无法解析 JSON {}：{error}",
                self.paths.backup_index.display()
            ),
        })
    }

    fn write_records(&self, records: &[BackupRecord]) -> Result<(), AppError> {
        self.paths.assert_allowed(&self.paths.app_data_dir)?;
        self.paths.assert_allowed(&self.paths.backup_index)?;
        fs::create_dir_all(&self.paths.app_data_dir)?;
        write_json(&self.paths.backup_index, records, |error| {
            AppError::BackupIndex {
                message: format!("无法序列化 JSON：{error}"),
            }
        })
    }
}

fn rollback_tombstone(
    tombstone: &Path,
    target: &Path,
    original_error: &AppError,
) -> Result<(), AppError> {
    rename_directory_no_replace(tombstone, target).map_err(|rollback_error| {
        AppError::RollbackFailed {
            original_error: original_error.to_string(),
            rollback_error: rollback_error.to_string(),
        }
    })
}

fn restore_failure_with_rollback<Rollback>(
    original_error: AppError,
    target: &Path,
    rollback: Rollback,
) -> AppError
where
    Rollback: FnOnce(&Path) -> std::io::Result<()>,
{
    match rollback(target) {
        Ok(()) => original_error,
        Err(rollback_error) => AppError::RollbackFailed {
            original_error: original_error.to_string(),
            rollback_error: rollback_error.to_string(),
        },
    }
}

fn is_symlink(path: &Path) -> bool {
    crate::fs_ops::path_is_symlink_link(path)
}

/// 备份 provider 根下的 Skill 符号链接：只归档链接目标，不复制原始目录内容。
fn archive_provider_symlink(source: &Path, target: &Path) -> Result<Vec<ManifestEntry>, AppError> {
    let link_target = fs::read_link(source)?;
    fs::create_dir_all(target)?;
    fs::write(
        target.join(SYMLINK_TARGET_MARKER),
        link_target.to_string_lossy().as_bytes(),
    )?;
    directory_manifest(target)
}

fn is_legacy_provider_symlink_archive(archive: &Path) -> bool {
    let Ok(mut entries) = fs::read_dir(archive) else {
        return false;
    };
    let Some(Ok(entry)) = entries.next() else {
        return false;
    };
    entries.next().is_none()
        && entry.file_name() == std::ffi::OsStr::new(SYMLINK_TARGET_MARKER)
        && entry
            .file_type()
            .is_ok_and(|file_type| file_type.is_file() && !file_type.is_symlink())
}

/// 从软链事件备份重建安装链接（不复制目标目录内容）。
fn restore_provider_symlink_archive(archive: &Path, destination: &Path) -> Result<(), AppError> {
    let raw = fs::read_to_string(archive.join(SYMLINK_TARGET_MARKER))?;
    let link_target = PathBuf::from(raw.trim());
    if link_target.as_os_str().is_empty() {
        return Err(AppError::Io {
            message: format!(
                "软链备份缺少有效目标：{}",
                archive.join(SYMLINK_TARGET_MARKER).display()
            ),
        });
    }
    create_directory_link(&link_target, destination)
}

fn remove_restored_skill_path(path: &Path) -> std::io::Result<()> {
    if !path.exists() && fs::symlink_metadata(path).is_err() {
        return Ok(());
    }
    if path_is_symlink_link(path) {
        return remove_directory_symlink(path).map_err(|error| match error {
            AppError::Io { message } => std::io::Error::other(message),
            other => std::io::Error::other(other.to_string()),
        });
    }
    fs::remove_dir_all(path)
}

fn copy_verified_directory(source: &Path, target: &Path) -> Result<Vec<ManifestEntry>, AppError> {
    copy_verified_directory_with(source, target, || {})
}

fn copy_verified_directory_with<Action>(
    source: &Path,
    target: &Path,
    after_copy: Action,
) -> Result<Vec<ManifestEntry>, AppError>
where
    Action: FnOnce(),
{
    let before = directory_manifest(source)?;
    let result = (|| {
        copy_directory(source, target)?;
        after_copy();
        let after = directory_manifest(source)?;
        let copied = directory_manifest(target)?;
        if before != after || before != copied {
            return Err(AppError::BackupVerificationFailed {
                id: source.display().to_string(),
            });
        }
        Ok(before)
    })();
    if result.is_err() {
        remove_directory_if_present(target, "未完成目录副本");
    }
    result
}

fn remove_directory_if_present(path: &Path, label: &str) {
    if path.exists() {
        if let Err(error) = fs::remove_dir_all(path) {
            eprintln!("无法清理{label} {}：{error}", path.display());
        }
    }
}

#[cfg(test)]
mod tests {
    use std::fs;
    use std::sync::mpsc;
    use std::thread;
    use std::time::Duration;

    use tempfile::tempdir;

    use super::{copy_verified_directory_with, BackupRepository, SYMLINK_TARGET_MARKER};
    use crate::error::AppError;
    use crate::fs_ops::rename_directory_no_replace;
    use crate::model::{BackupReason, BackupRecord, PauseRecord, SkillStatus};
    use crate::paths::AppPaths;
    use crate::skill_repository::SkillRepository;

    fn write_skill(paths: &AppPaths, name: &str, markdown: &str) {
        let skill_dir = paths.skill_roots[0].path.join(name);
        fs::create_dir_all(&skill_dir).unwrap();
        fs::write(skill_dir.join("SKILL.md"), markdown).unwrap();
    }

    fn repository_with_skill(
        base: &tempfile::TempDir,
        name: &str,
    ) -> (AppPaths, BackupRepository, String) {
        let paths = AppPaths::for_test(base.path());
        write_skill(&paths, name, &format!("# {name}"));
        let id = SkillRepository::new(paths.clone()).scan().unwrap()[0]
            .id
            .clone();
        let repository = BackupRepository::new(paths.clone());
        (paths, repository, id)
    }

    #[test]
    fn manual_backup_creates_version_directory_index_and_checksum() {
        let base = tempdir().unwrap();
        let (paths, repository, id) = repository_with_skill(&base, "manual");

        let record = repository.create_backup(&id, BackupReason::Manual).unwrap();

        assert!(record.archive_path.is_dir());
        assert!(record.archive_path.starts_with(paths.backups_dir.join(&id)));
        assert_eq!(record.checksum.len(), 64);
        assert_eq!(repository.list_backups().unwrap(), vec![record]);
    }

    #[test]
    fn repeated_backups_are_retained_and_listed_newest_first() {
        let base = tempdir().unwrap();
        let (_, repository, id) = repository_with_skill(&base, "versions");

        let first = repository.create_backup(&id, BackupReason::Manual).unwrap();
        let second = repository.create_backup(&id, BackupReason::Manual).unwrap();
        let records = repository.list_backups().unwrap();

        assert_eq!(records.len(), 2);
        assert_eq!(records[0].id, second.id);
        assert_eq!(records[1].id, first.id);
        assert!(first.archive_path.exists());
        assert!(second.archive_path.exists());
    }

    #[test]
    fn independent_repositories_serialize_entire_index_transaction() {
        let base = tempdir().unwrap();
        let (paths, _, id) = repository_with_skill(&base, "concurrent");
        let first_repository = BackupRepository::new(paths.clone());
        let second_repository = BackupRepository::new(paths.clone());
        let (first_entered_tx, first_entered_rx) = mpsc::channel();
        let (release_tx, release_rx) = mpsc::channel();
        let first_id = id.clone();
        let first = thread::spawn(move || {
            first_repository.create_backup_with_hook(&first_id, BackupReason::Manual, || {
                first_entered_tx.send(()).unwrap();
                release_rx.recv().unwrap();
            })
        });
        first_entered_rx
            .recv_timeout(Duration::from_secs(2))
            .unwrap();

        let (second_entered_tx, second_entered_rx) = mpsc::channel();
        let second_id = id.clone();
        let second = thread::spawn(move || {
            second_repository.create_backup_with_hook(&second_id, BackupReason::Manual, || {
                second_entered_tx.send(()).unwrap();
            })
        });

        assert!(second_entered_rx
            .recv_timeout(Duration::from_millis(100))
            .is_err());
        release_tx.send(()).unwrap();
        first.join().unwrap().unwrap();
        second_entered_rx
            .recv_timeout(Duration::from_secs(2))
            .unwrap();
        second.join().unwrap().unwrap();
        assert_eq!(
            BackupRepository::new(paths).list_backups().unwrap().len(),
            2
        );
    }

    #[test]
    fn source_change_during_copy_rejects_backup_copy() {
        let base = tempdir().unwrap();
        let source = base.path().join("source");
        let target = base.path().join("target");
        fs::create_dir(&source).unwrap();
        fs::write(source.join("data.txt"), "before").unwrap();

        let result = copy_verified_directory_with(&source, &target, || {
            fs::write(source.join("data.txt"), "after").unwrap();
        });

        assert!(matches!(
            result,
            Err(AppError::BackupVerificationFailed { .. })
        ));
        assert!(!target.exists());
    }

    #[test]
    fn backup_index_write_failure_keeps_source_and_removes_archive() {
        let base = tempdir().unwrap();
        let (paths, repository, id) = repository_with_skill(&base, "index-failure");
        let source = paths.skill_roots[0].path.join("index-failure");
        fs::create_dir_all(&paths.app_data_dir).unwrap();
        fs::write(&paths.backup_index, "[]").unwrap();
        let mut archive_was_committed = false;

        let result =
            repository.create_backup_with_index_writer(&id, BackupReason::Manual, |records| {
                assert_eq!(records.len(), 1);
                assert!(records[0].archive_path.is_dir());
                archive_was_committed = true;
                Err(AppError::BackupIndex {
                    message: "injected backup-index write failure".into(),
                })
            });

        assert!(matches!(result, Err(AppError::BackupIndex { .. })));
        assert!(archive_was_committed);
        assert!(source.exists());
        assert_eq!(
            fs::read_to_string(source.join("SKILL.md")).unwrap(),
            "# index-failure"
        );
        let archives = fs::read_dir(paths.backups_dir.join(&id))
            .map(|entries| entries.count())
            .unwrap_or(0);
        assert_eq!(archives, 0);
        let records: Vec<BackupRecord> =
            serde_json::from_slice(&fs::read(&paths.backup_index).unwrap()).unwrap();
        assert!(records.is_empty());
    }

    #[test]
    fn delete_creates_before_delete_backup_then_removes_source() {
        let base = tempdir().unwrap();
        let (paths, repository, id) = repository_with_skill(&base, "delete");
        let source = paths.skill_roots[0].path.join("delete");

        let record = repository.delete_skill(&id).unwrap();

        assert_eq!(record.reason, BackupReason::BeforeDelete);
        assert!(!source.exists());
        assert!(record.archive_path.exists());
    }

    #[cfg(unix)]
    #[test]
    fn delete_provider_symlink_removes_only_the_link() {
        use std::os::unix::fs::symlink;

        let base = tempdir().unwrap();
        let outside = tempdir().unwrap();
        fs::write(outside.path().join("SKILL.md"), "# Keep Me").unwrap();
        fs::write(outside.path().join("keep.txt"), "keep").unwrap();
        let paths = AppPaths::for_test(base.path());
        fs::create_dir_all(&paths.skill_roots[0].path).unwrap();
        let link = paths.skill_roots[0].path.join("linked-skill");
        symlink(outside.path(), &link).unwrap();
        let id = SkillRepository::new(paths.clone()).scan().unwrap()[0]
            .id
            .clone();
        let repository = BackupRepository::new(paths);

        let record = repository.delete_skill(&id).unwrap();

        assert!(!link.exists());
        assert_eq!(
            record.archive_kind,
            Some(crate::model::BackupArchiveKind::ProviderSymlink)
        );
        assert!(outside.path().join("SKILL.md").exists());
        assert_eq!(
            fs::read_to_string(outside.path().join("keep.txt")).unwrap(),
            "keep"
        );
        assert_eq!(
            fs::read_to_string(record.archive_path.join(".skill-manager-symlink-target")).unwrap(),
            outside.path().to_string_lossy()
        );
    }

    #[cfg(unix)]
    #[test]
    fn restore_provider_symlink_backup_recreates_link() {
        use std::os::unix::fs::symlink;

        let base = tempdir().unwrap();
        let outside = tempdir().unwrap();
        fs::write(outside.path().join("SKILL.md"), "# Keep Me").unwrap();
        let paths = AppPaths::for_test(base.path());
        fs::create_dir_all(&paths.skill_roots[0].path).unwrap();
        let link = paths.skill_roots[0].path.join("linked-restore");
        symlink(outside.path(), &link).unwrap();
        let id = SkillRepository::new(paths.clone()).scan().unwrap()[0]
            .id
            .clone();
        let repository = BackupRepository::new(paths);

        let record = repository.delete_skill(&id).unwrap();
        assert!(!link.exists());
        let mut legacy_records = repository.load_records().unwrap();
        legacy_records[0].archive_kind = None;
        repository.write_records(&legacy_records).unwrap();

        let detail = repository.restore_backup(&record.id).unwrap();

        assert!(crate::fs_ops::path_is_symlink_link(&link));
        assert_eq!(fs::read_link(&link).unwrap(), outside.path());
        assert_eq!(detail.current_path, link);
        assert_eq!(
            detail
                .resolved_path
                .as_ref()
                .and_then(|path| path.canonicalize().ok())
                .unwrap(),
            outside.path().canonicalize().unwrap()
        );
        assert_eq!(
            fs::read_to_string(outside.path().join("SKILL.md")).unwrap(),
            "# Keep Me"
        );
    }

    #[test]
    fn directory_backup_with_symlink_marker_restores_as_directory() {
        let base = tempdir().unwrap();
        let (paths, repository, id) = repository_with_skill(&base, "marker-directory");
        let source = paths.skill_roots[0].path.join("marker-directory");
        fs::write(source.join(SYMLINK_TARGET_MARKER), "/tmp/not-a-link").unwrap();

        let record = repository.create_backup(&id, BackupReason::Manual).unwrap();
        assert_eq!(
            record.archive_kind,
            Some(crate::model::BackupArchiveKind::Directory)
        );
        let mut legacy_records = repository.load_records().unwrap();
        legacy_records[0].archive_kind = None;
        repository.write_records(&legacy_records).unwrap();
        fs::remove_dir_all(&source).unwrap();

        repository.restore_backup(&record.id).unwrap();

        assert!(source.is_dir());
        assert!(!crate::fs_ops::path_is_symlink_link(&source));
        assert_eq!(
            fs::read_to_string(source.join(SYMLINK_TARGET_MARKER)).unwrap(),
            "/tmp/not-a-link"
        );
    }

    #[cfg(windows)]
    #[test]
    fn delete_provider_directory_symlink_removes_only_the_link_on_windows() {
        use std::os::windows::fs::symlink_dir;

        let base = tempdir().unwrap();
        let outside = tempdir().unwrap();
        fs::write(outside.path().join("SKILL.md"), "# Keep Me").unwrap();
        fs::write(outside.path().join("keep.txt"), "keep").unwrap();
        let paths = AppPaths::for_test(base.path());
        fs::create_dir_all(&paths.skill_roots[0].path).unwrap();
        let link = paths.skill_roots[0].path.join("linked-skill");
        if let Err(error) = symlink_dir(outside.path(), &link) {
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
        let id = SkillRepository::new(paths.clone()).scan().unwrap()[0]
            .id
            .clone();
        let repository = BackupRepository::new(paths);

        let record = repository.delete_skill(&id).unwrap();

        assert!(fs::symlink_metadata(&link).is_err());
        assert!(outside.path().join("SKILL.md").exists());
        assert_eq!(
            fs::read_to_string(outside.path().join("keep.txt")).unwrap(),
            "keep"
        );
        assert_eq!(
            fs::read_to_string(record.archive_path.join(".skill-manager-symlink-target")).unwrap(),
            outside.path().to_string_lossy()
        );
    }

    #[test]
    fn delete_freezes_exact_directory_before_backup_and_delete() {
        let base = tempdir().unwrap();
        let (paths, repository, id) = repository_with_skill(&base, "frozen-delete");
        let source = paths.skill_roots[0].path.join("frozen-delete");

        let record = repository
            .delete_skill_with_hook(&id, || {
                fs::create_dir(&source).unwrap();
                fs::write(source.join("SKILL.md"), "# replacement").unwrap();
            })
            .unwrap();

        assert_eq!(
            fs::read_to_string(record.archive_path.join("SKILL.md")).unwrap(),
            "# frozen-delete"
        );
        assert_eq!(
            fs::read_to_string(source.join("SKILL.md")).unwrap(),
            "# replacement"
        );
    }

    #[test]
    fn automatic_backup_failure_keeps_source() {
        let base = tempdir().unwrap();
        let (mut paths, _, id) = repository_with_skill(&base, "safe-delete");
        let source = paths.skill_roots[0].path.join("safe-delete");
        paths.backup_index = paths.app_data_dir.clone();
        fs::create_dir_all(&paths.app_data_dir).unwrap();
        let repository = BackupRepository::new(paths);

        assert!(repository.delete_skill(&id).is_err());
        assert!(source.exists());
    }

    #[test]
    fn delete_rollback_never_overwrites_racing_empty_target() {
        let base = tempdir().unwrap();
        let (mut paths, _, id) = repository_with_skill(&base, "rollback-race");
        let source = paths.skill_roots[0].path.join("rollback-race");
        paths.backup_index = paths.app_data_dir.clone();
        fs::create_dir_all(&paths.app_data_dir).unwrap();
        let repository = BackupRepository::new(paths);

        let error = repository
            .delete_skill_with_hook(&id, || {
                fs::create_dir(&source).unwrap();
            })
            .unwrap_err();

        assert!(matches!(error, AppError::RollbackFailed { .. }));
        assert!(source.is_dir());
        assert_eq!(fs::read_dir(&source).unwrap().count(), 0);
        let tombstones = fs::read_dir(source.parent().unwrap())
            .unwrap()
            .filter_map(Result::ok)
            .filter(|entry| {
                entry
                    .file_name()
                    .to_string_lossy()
                    .starts_with(".skill-delete-")
            })
            .count();
        assert_eq!(tombstones, 1);
    }

    #[test]
    fn deleting_paused_skill_removes_pause_record() {
        let base = tempdir().unwrap();
        let (paths, repository, id) = repository_with_skill(&base, "paused-delete");
        SkillRepository::new(paths.clone()).pause(&id).unwrap();

        repository.delete_skill(&id).unwrap();

        let records: Vec<PauseRecord> =
            serde_json::from_slice(&fs::read(&paths.paused_index).unwrap()).unwrap();
        assert!(records.is_empty());
        assert!(SkillRepository::new(paths).scan().unwrap().is_empty());
    }

    #[test]
    fn pause_waits_for_paused_delete_and_preserves_index_update() {
        let base = tempdir().unwrap();
        let paths = AppPaths::for_test(base.path());
        write_skill(&paths, "delete-paused", "# delete");
        write_skill(&paths, "pause-concurrently", "# pause");
        let skill_repository = SkillRepository::new(paths.clone());
        let skills = skill_repository.scan().unwrap();
        let delete_id = skills
            .iter()
            .find(|skill| skill.name == "delete-paused")
            .unwrap()
            .id
            .clone();
        let pause_id = skills
            .iter()
            .find(|skill| skill.name == "pause-concurrently")
            .unwrap()
            .id
            .clone();
        skill_repository.pause(&delete_id).unwrap();

        let (delete_entered_tx, delete_entered_rx) = mpsc::channel();
        let (release_tx, release_rx) = mpsc::channel();
        let delete_paths = paths.clone();
        let delete = thread::spawn(move || {
            BackupRepository::new(delete_paths).delete_skill_with_hook(&delete_id, || {
                delete_entered_tx.send(()).unwrap();
                release_rx.recv().unwrap();
            })
        });
        delete_entered_rx
            .recv_timeout(Duration::from_secs(2))
            .unwrap();

        let (pause_entered_tx, pause_entered_rx) = mpsc::channel();
        let pause_paths = paths.clone();
        let pause = thread::spawn(move || {
            SkillRepository::new(pause_paths).pause_with_hook(&pause_id, || {
                pause_entered_tx.send(()).unwrap();
            })
        });

        assert!(pause_entered_rx
            .recv_timeout(Duration::from_millis(100))
            .is_err());
        release_tx.send(()).unwrap();
        delete.join().unwrap().unwrap();
        pause_entered_rx
            .recv_timeout(Duration::from_secs(2))
            .unwrap();
        let paused = pause.join().unwrap().unwrap();
        let records: Vec<PauseRecord> =
            serde_json::from_slice(&fs::read(&paths.paused_index).unwrap()).unwrap();
        assert_eq!(records.len(), 1);
        assert_eq!(records[0].skill_id, paused.id);
    }

    #[test]
    fn resume_waits_for_paused_delete_and_preserves_index_update() {
        let base = tempdir().unwrap();
        let paths = AppPaths::for_test(base.path());
        write_skill(&paths, "delete-while-resume", "# delete");
        write_skill(&paths, "resume-concurrently", "# resume");
        let skill_repository = SkillRepository::new(paths.clone());
        let skills = skill_repository.scan().unwrap();
        let delete_id = skills
            .iter()
            .find(|skill| skill.name == "delete-while-resume")
            .unwrap()
            .id
            .clone();
        let resume_id = skills
            .iter()
            .find(|skill| skill.name == "resume-concurrently")
            .unwrap()
            .id
            .clone();
        skill_repository.pause(&delete_id).unwrap();
        skill_repository.pause(&resume_id).unwrap();

        let (delete_entered_tx, delete_entered_rx) = mpsc::channel();
        let (release_tx, release_rx) = mpsc::channel();
        let delete_paths = paths.clone();
        let delete = thread::spawn(move || {
            BackupRepository::new(delete_paths).delete_skill_with_hook(&delete_id, || {
                delete_entered_tx.send(()).unwrap();
                release_rx.recv().unwrap();
            })
        });
        delete_entered_rx
            .recv_timeout(Duration::from_secs(2))
            .unwrap();

        let (resume_entered_tx, resume_entered_rx) = mpsc::channel();
        let resume_paths = paths.clone();
        let resume = thread::spawn(move || {
            SkillRepository::new(resume_paths).resume_with_hook(&resume_id, || {
                resume_entered_tx.send(()).unwrap();
            })
        });

        assert!(resume_entered_rx
            .recv_timeout(Duration::from_millis(100))
            .is_err());
        release_tx.send(()).unwrap();
        delete.join().unwrap().unwrap();
        resume_entered_rx
            .recv_timeout(Duration::from_secs(2))
            .unwrap();
        let resumed = resume.join().unwrap().unwrap();
        assert_eq!(resumed.status, SkillStatus::Active);
        let records: Vec<PauseRecord> =
            serde_json::from_slice(&fs::read(&paths.paused_index).unwrap()).unwrap();
        assert!(records.is_empty());
    }

    #[cfg(unix)]
    #[test]
    fn paused_index_update_failure_rolls_delete_back() {
        use std::os::unix::fs::PermissionsExt;

        let base = tempdir().unwrap();
        let mut paths = AppPaths::for_test(base.path());
        paths.disabled_dir = base.path().join("separate-disabled");
        paths.paused_index = paths.app_data_dir.join("paused/paused-index.json");
        fs::create_dir_all(paths.paused_index.parent().unwrap()).unwrap();
        write_skill(&paths, "paused-rollback", "# Paused");
        let skill_repository = SkillRepository::new(paths.clone());
        let id = skill_repository.scan().unwrap()[0].id.clone();
        skill_repository.pause(&id).unwrap();
        let paused_path = paths.disabled_dir.join("cursor/paused-rollback");
        fs::set_permissions(
            paths.paused_index.parent().unwrap(),
            fs::Permissions::from_mode(0o555),
        )
        .unwrap();
        let repository = BackupRepository::new(paths.clone());

        let result = repository.delete_skill(&id);

        fs::set_permissions(
            paths.paused_index.parent().unwrap(),
            fs::Permissions::from_mode(0o755),
        )
        .unwrap();
        assert!(result.is_err());
        assert!(paused_path.exists());
        let detail = SkillRepository::new(paths).detail(&id).unwrap();
        assert_eq!(detail.status, SkillStatus::Paused);
    }

    #[test]
    fn restore_recreates_active_skill_with_archived_contents() {
        let base = tempdir().unwrap();
        let (paths, repository, id) = repository_with_skill(&base, "restore");
        let record = repository.create_backup(&id, BackupReason::Manual).unwrap();
        fs::remove_dir_all(paths.skill_roots[0].path.join("restore")).unwrap();

        let detail = repository.restore_backup(&record.id).unwrap();

        assert_eq!(detail.status, SkillStatus::Active);
        assert_eq!(detail.skill_markdown, "# restore");
    }

    #[test]
    fn restore_target_conflict_never_overwrites() {
        let base = tempdir().unwrap();
        let (paths, repository, id) = repository_with_skill(&base, "conflict");
        let source = paths.skill_roots[0].path.join("conflict");
        let record = repository.create_backup(&id, BackupReason::Manual).unwrap();
        fs::write(source.join("SKILL.md"), "# replacement").unwrap();

        let error = repository.restore_backup(&record.id).unwrap_err();

        assert!(matches!(error, AppError::TargetConflict { .. }));
        assert_eq!(
            fs::read_to_string(source.join("SKILL.md")).unwrap(),
            "# replacement"
        );
    }

    #[test]
    fn no_replace_rename_preserves_racing_target() {
        let base = tempdir().unwrap();
        let source = base.path().join("source");
        let target = base.path().join("target");
        fs::create_dir(&source).unwrap();
        fs::create_dir(&target).unwrap();
        fs::write(source.join("value"), "source").unwrap();
        fs::write(target.join("value"), "target").unwrap();

        let error = rename_directory_no_replace(&source, &target).unwrap_err();

        assert!(matches!(error, AppError::TargetConflict { .. }));
        assert_eq!(fs::read_to_string(target.join("value")).unwrap(), "target");
        assert!(source.exists());
    }

    #[test]
    fn restore_commit_rejects_target_created_after_precheck() {
        let base = tempdir().unwrap();
        let (paths, repository, id) = repository_with_skill(&base, "restore-race");
        let record = repository.create_backup(&id, BackupReason::Manual).unwrap();
        fs::remove_dir_all(&record.original_path).unwrap();

        let error = repository
            .restore_backup_with_hook(&record.id, || {
                fs::create_dir(&record.original_path).unwrap();
                fs::write(record.original_path.join("SKILL.md"), "# racing target").unwrap();
            })
            .unwrap_err();

        assert!(matches!(error, AppError::TargetConflict { .. }));
        assert_eq!(
            fs::read_to_string(paths.skill_roots[0].path.join("restore-race/SKILL.md")).unwrap(),
            "# racing target"
        );
    }

    #[test]
    fn restore_commit_rejects_empty_target_created_after_precheck() {
        let base = tempdir().unwrap();
        let (_, repository, id) = repository_with_skill(&base, "restore-empty-race");
        let record = repository.create_backup(&id, BackupReason::Manual).unwrap();
        fs::remove_dir_all(&record.original_path).unwrap();

        let error = repository
            .restore_backup_with_hook(&record.id, || {
                fs::create_dir(&record.original_path).unwrap();
            })
            .unwrap_err();

        assert!(matches!(error, AppError::TargetConflict { .. }));
        assert!(record.original_path.is_dir());
        assert_eq!(fs::read_dir(&record.original_path).unwrap().count(), 0);
    }

    #[test]
    fn restore_rejects_archive_path_outside_backups_directory() {
        let base = tempdir().unwrap();
        let (paths, repository, id) = repository_with_skill(&base, "outside-archive");
        let mut record = repository.create_backup(&id, BackupReason::Manual).unwrap();
        record.archive_path = paths.disabled_dir.join("cursor/forged-archive");
        fs::create_dir_all(&record.archive_path).unwrap();
        fs::write(record.archive_path.join("SKILL.md"), "# forged").unwrap();
        fs::write(
            &paths.backup_index,
            serde_json::to_vec(&vec![&record]).unwrap(),
        )
        .unwrap();
        fs::remove_dir_all(&record.original_path).unwrap();

        let error = repository.restore_backup(&record.id).unwrap_err();

        assert!(matches!(error, AppError::PathOutsideManagedRoots { .. }));
        assert!(!record.original_path.exists());
    }

    #[test]
    fn restore_rejects_target_under_wrong_provider_root() {
        let base = tempdir().unwrap();
        let (paths, repository, id) = repository_with_skill(&base, "wrong-provider");
        let mut record = repository.create_backup(&id, BackupReason::Manual).unwrap();
        record.original_path = paths.skill_roots[1].path.join("wrong-provider");
        fs::write(
            &paths.backup_index,
            serde_json::to_vec(&vec![&record]).unwrap(),
        )
        .unwrap();
        fs::remove_dir_all(paths.skill_roots[0].path.join("wrong-provider")).unwrap();

        let error = repository.restore_backup(&record.id).unwrap_err();

        assert!(matches!(error, AppError::PathOutsideManagedRoots { .. }));
        assert!(!record.original_path.exists());
    }

    #[test]
    fn restore_rejects_when_same_skill_is_still_paused() {
        let base = tempdir().unwrap();
        let (paths, repository, id) = repository_with_skill(&base, "paused-restore");
        SkillRepository::new(paths.clone()).pause(&id).unwrap();
        let record = repository.create_backup(&id, BackupReason::Manual).unwrap();

        let error = repository.restore_backup(&record.id).unwrap_err();

        assert!(matches!(error, AppError::TargetConflict { .. }));
        assert!(!record.original_path.exists());
        assert_eq!(
            SkillRepository::new(paths).detail(&id).unwrap().status,
            SkillStatus::Paused
        );
    }

    #[test]
    fn restore_and_pause_share_transaction_without_dual_state() {
        let base = tempdir().unwrap();
        let (paths, repository, id) = repository_with_skill(&base, "restore-pause");
        let record = repository.create_backup(&id, BackupReason::Manual).unwrap();
        fs::remove_dir_all(&record.original_path).unwrap();

        let (restore_entered_tx, restore_entered_rx) = mpsc::channel();
        let (release_tx, release_rx) = mpsc::channel();
        let restore_paths = paths.clone();
        let backup_id = record.id.clone();
        let restore = thread::spawn(move || {
            BackupRepository::new(restore_paths).restore_backup_with_hook(&backup_id, || {
                restore_entered_tx.send(()).unwrap();
                release_rx.recv().unwrap();
            })
        });
        restore_entered_rx
            .recv_timeout(Duration::from_secs(2))
            .unwrap();

        let (pause_entered_tx, pause_entered_rx) = mpsc::channel();
        let pause_paths = paths.clone();
        let pause_id = id.clone();
        let pause = thread::spawn(move || {
            SkillRepository::new(pause_paths).pause_with_hook(&pause_id, || {
                pause_entered_tx.send(()).unwrap();
            })
        });

        assert!(pause_entered_rx
            .recv_timeout(Duration::from_millis(100))
            .is_err());
        release_tx.send(()).unwrap();
        assert_eq!(restore.join().unwrap().unwrap().status, SkillStatus::Active);
        pause_entered_rx
            .recv_timeout(Duration::from_secs(2))
            .unwrap();
        assert_eq!(pause.join().unwrap().unwrap().status, SkillStatus::Paused);
        let scanned = SkillRepository::new(paths).scan().unwrap();
        assert_eq!(scanned.len(), 1);
        assert_eq!(scanned[0].id, id);
        assert_eq!(scanned[0].status, SkillStatus::Paused);
        assert!(!record.original_path.exists());
    }

    #[test]
    fn tampered_archive_fails_restore_verification() {
        let base = tempdir().unwrap();
        let (paths, repository, id) = repository_with_skill(&base, "tampered");
        let record = repository.create_backup(&id, BackupReason::Manual).unwrap();
        fs::remove_dir_all(paths.skill_roots[0].path.join("tampered")).unwrap();
        fs::write(record.archive_path.join("SKILL.md"), "# changed").unwrap();

        let error = repository.restore_backup(&record.id).unwrap_err();

        assert!(matches!(
            error,
            AppError::BackupVerificationFailed { id } if id == record.id
        ));
        assert!(!record.original_path.exists());
    }

    #[test]
    fn restore_detail_failure_removes_committed_target() {
        let base = tempdir().unwrap();
        let (_, repository, id) = repository_with_skill(&base, "detail-failure");
        let record = repository.create_backup(&id, BackupReason::Manual).unwrap();
        fs::remove_dir_all(&record.original_path).unwrap();

        assert!(repository
            .restore_backup_with_failures(
                &record.id,
                |path| fs::remove_dir_all(path),
                |_| Err(AppError::Io {
                    message: "detail failed".into(),
                }),
            )
            .is_err());
        assert!(!record.original_path.exists());
    }

    #[test]
    fn restore_rolls_back_when_final_detail_is_not_exact_active_target() {
        let base = tempdir().unwrap();
        let (paths, repository, id) = repository_with_skill(&base, "invalid-final-state");
        let mut invalid_detail = SkillRepository::new(paths.clone()).detail(&id).unwrap();
        let record = repository.create_backup(&id, BackupReason::Manual).unwrap();
        fs::remove_dir_all(&record.original_path).unwrap();
        invalid_detail.status = SkillStatus::Paused;
        invalid_detail.current_path = paths.disabled_dir.join("cursor/invalid-final-state");

        let error = repository
            .restore_backup_with_failures(
                &record.id,
                |path| fs::remove_dir_all(path),
                |_| Ok(invalid_detail),
            )
            .unwrap_err();

        assert!(matches!(
            error,
            AppError::BackupVerificationFailed { id } if id == record.id
        ));
        assert!(!record.original_path.exists());
    }

    #[test]
    fn restore_cleanup_failure_returns_explicit_rollback_error() {
        let base = tempdir().unwrap();
        let (_, repository, id) = repository_with_skill(&base, "rollback-failure");
        let record = repository.create_backup(&id, BackupReason::Manual).unwrap();
        fs::remove_dir_all(&record.original_path).unwrap();

        let error = repository
            .restore_backup_with_failures(
                &record.id,
                |_| Err(std::io::Error::other("cleanup denied")),
                |_| {
                    Err(AppError::PauseIndex {
                        message: "detail JSON failed".into(),
                    })
                },
            )
            .unwrap_err();

        assert!(matches!(
            error,
            AppError::RollbackFailed {
                original_error,
                rollback_error
            } if original_error.contains("JSON") && rollback_error.contains("cleanup denied")
        ));
    }

    #[test]
    fn malformed_backup_index_returns_structured_error() {
        let base = tempdir().unwrap();
        let paths = AppPaths::for_test(base.path());
        fs::create_dir_all(&paths.app_data_dir).unwrap();
        fs::write(&paths.backup_index, "{broken").unwrap();

        let error = BackupRepository::new(paths).list_backups().unwrap_err();

        assert!(matches!(error, AppError::BackupIndex { .. }));
    }

    #[cfg(unix)]
    #[test]
    fn backup_copies_symlink_without_reading_external_target() {
        use std::os::unix::fs::symlink;

        let base = tempdir().unwrap();
        let outside = tempdir().unwrap();
        let (paths, repository, id) = repository_with_skill(&base, "links");
        fs::write(outside.path().join("secret"), "secret").unwrap();
        let source = paths.skill_roots[0].path.join("links");
        symlink(outside.path().join("secret"), source.join("external")).unwrap();

        let record = repository.create_backup(&id, BackupReason::Manual).unwrap();

        let archived_link = record.archive_path.join("external");
        assert!(archived_link
            .symlink_metadata()
            .unwrap()
            .file_type()
            .is_symlink());
        assert_eq!(
            fs::read_link(archived_link).unwrap(),
            outside.path().join("secret")
        );
    }

    #[test]
    fn cleanup_backups_respects_max_count_and_retention_days() {
        use chrono::{Duration, Utc};

        let base = tempdir().unwrap();
        let (_, repository, id) = repository_with_skill(&base, "cleanup");
        let first = repository.create_backup(&id, BackupReason::Manual).unwrap();
        let second = repository.create_backup(&id, BackupReason::Manual).unwrap();
        let third = repository.create_backup(&id, BackupReason::Manual).unwrap();

        let mut records = repository.list_backups().unwrap();
        // list is newest-first; rewrite oldest two with old timestamps
        for record in &mut records {
            if record.id == first.id || record.id == second.id {
                record.created_at = Utc::now() - Duration::days(40);
            }
        }
        repository.write_records(&records).unwrap();

        let deleted_by_age = repository.cleanup_backups(Some(30), None).unwrap();
        assert_eq!(deleted_by_age, 2);
        assert!(!first.archive_path.exists());
        assert!(!second.archive_path.exists());
        assert!(third.archive_path.exists());

        let fourth = repository.create_backup(&id, BackupReason::Manual).unwrap();
        let fifth = repository.create_backup(&id, BackupReason::Manual).unwrap();
        assert_eq!(repository.list_backups().unwrap().len(), 3);

        let deleted_by_count = repository.cleanup_backups(None, Some(2)).unwrap();
        assert_eq!(deleted_by_count, 1);
        let remaining = repository.list_backups().unwrap();
        assert_eq!(remaining.len(), 2);
        assert!(remaining.iter().any(|record| record.id == fourth.id));
        assert!(remaining.iter().any(|record| record.id == fifth.id));
    }
}
