use std::fs;
use std::path::Path;

use chrono::Utc;
use uuid::Uuid;

use crate::error::AppError;
use crate::fs_ops::{path_is_symlink_link, remove_directory_symlink};
use crate::library_repository::{
    adopt_existing_installations, create_directory_symlink, ensure_project_path_is_new,
    project_for_source, prune_missing_installations, provider_order, safe_skill_target,
    scan_project, sync_installation_statuses, LibraryRepository,
};
use crate::model::{
    DuplicateSkillGroup, InstallHealthReport, InstallOverview, MigrateResult, ProjectSourceType,
    Provider, SkillInstallation, SkillSummary, UnmanagedSkill,
};
use crate::transaction_lock::lock_app_transaction;

impl LibraryRepository {
    pub fn install_skill(
        &self,
        library_skill_id: &str,
        provider: Provider,
    ) -> Result<SkillInstallation, AppError> {
        self.install_skill_with_writer(library_skill_id, provider, |index| {
            self.write_index(index)
        })
    }

    pub(crate) fn install_skill_with_writer<Writer>(
        &self,
        library_skill_id: &str,
        provider: Provider,
        write_index: Writer,
    ) -> Result<SkillInstallation, AppError>
    where
        Writer: FnOnce(&crate::library_repository::LibraryIndex) -> Result<(), AppError>,
    {
        let _guard = lock_app_transaction(self.paths())?;
        let mut index = self.load_index()?;
        let skill = index
            .library_skills
            .iter()
            .find(|skill| skill.id == library_skill_id)
            .cloned()
            .ok_or_else(|| AppError::LibrarySkillNotFound {
                id: library_skill_id.to_owned(),
            })?;
        let source_path =
            skill
                .absolute_path
                .canonicalize()
                .map_err(|_| AppError::InvalidProjectPath {
                    path: skill.absolute_path.display().to_string(),
                })?;
        if !source_path.is_dir() {
            return Err(AppError::InvalidProjectPath {
                path: source_path.display().to_string(),
            });
        }
        let root = self.paths().provider_root(provider)?;
        self.paths().assert_allowed(root)?;
        fs::create_dir_all(root)?;
        adopt_existing_installations(&mut index, self.paths());
        prune_missing_installations(&mut index);
        let managed_position = index.installations.iter().position(|installation| {
            installation.library_skill_id == library_skill_id && installation.provider == provider
        });
        let target_path = safe_skill_target(root, &skill.name)?;
        if let Some(position) = managed_position {
            let previous_target = index.installations[position].target_path.clone();
            if !crate::path_norm::paths_eq(&previous_target, &target_path) {
                if !path_is_symlink_link(&previous_target) {
                    return Err(AppError::TargetConflict {
                        path: previous_target.display().to_string(),
                    });
                }
                let previous_resolved = previous_target.canonicalize().map_err(|_| {
                    AppError::TargetConflict {
                        path: previous_target.display().to_string(),
                    }
                })?;
                if previous_resolved != source_path {
                    return Err(AppError::TargetConflict {
                        path: previous_target.display().to_string(),
                    });
                }
                if fs::symlink_metadata(&target_path).is_ok() {
                    return Err(AppError::TargetConflict {
                        path: target_path.display().to_string(),
                    });
                }
                let previous_link = fs::read_link(&previous_target)?;
                create_directory_symlink(&source_path, &target_path)?;
                if let Err(error) =
                    remove_matching_directory_link(&previous_target, Some(&source_path))
                {
                    return Err(remove_new_install_link_after_failure(
                        error,
                        &target_path,
                        &source_path,
                    ));
                }
                let installation = SkillInstallation {
                    library_skill_id: library_skill_id.to_owned(),
                    provider,
                    source_path,
                    target_path: target_path.clone(),
                    installed_at: Utc::now(),
                };
                index.installations[position] = installation.clone();
                sync_installation_statuses(&mut index);
                if let Err(error) = write_index(&index) {
                    return Err(rollback_changed_provider_root_install(
                        error,
                        &previous_link,
                        &previous_target,
                        &target_path,
                        &installation.source_path,
                    ));
                }
                return Ok(installation);
            }
        }
        let old_link = match fs::symlink_metadata(&target_path) {
            Ok(_) if !path_is_symlink_link(&target_path) => {
                return Err(AppError::TargetConflict {
                    path: target_path.display().to_string(),
                });
            }
            Ok(_) if managed_position.is_none() => {
                // 历史工具留下的同名 symlink（如 .cc-switch）：校验为同一 skill 后接管替换
                if unmanaged_symlink_matches_skill(&target_path, &skill.name) {
                    Some(fs::read_link(&target_path)?)
                } else {
                    return Err(AppError::TargetConflict {
                        path: target_path.display().to_string(),
                    });
                }
            }
            Ok(_) => Some(fs::read_link(&target_path)?),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => None,
            Err(error) => return Err(error.into()),
        };

        if old_link.is_some() {
            remove_directory_symlink(&target_path)?;
        }
        if let Err(error) = create_directory_symlink(&source_path, &target_path) {
            if let Some(old_target) = old_link {
                create_directory_symlink(&old_target, &target_path).map_err(|rollback_error| {
                    AppError::RollbackFailed {
                        original_error: error.to_string(),
                        rollback_error: rollback_error.to_string(),
                    }
                })?;
            }
            return Err(error);
        }

        let installation = SkillInstallation {
            library_skill_id: library_skill_id.to_owned(),
            provider,
            source_path,
            target_path: target_path.clone(),
            installed_at: Utc::now(),
        };
        if let Some(position) = managed_position {
            index.installations[position] = installation.clone();
        } else {
            index.installations.push(installation.clone());
        }
        sync_installation_statuses(&mut index);
        if let Err(error) = write_index(&index) {
            remove_matching_directory_link(&target_path, Some(&installation.source_path))
                .map_err(|rollback_error| AppError::RollbackFailed {
                    original_error: error.to_string(),
                    rollback_error: rollback_error.to_string(),
                })?;
            if let Some(old_target) = old_link {
                create_directory_symlink(&old_target, &target_path).map_err(|rollback_error| {
                    AppError::RollbackFailed {
                        original_error: error.to_string(),
                        rollback_error: rollback_error.to_string(),
                    }
                })?;
            }
            return Err(error);
        }
        Ok(installation)
    }

    pub fn uninstall_skill(
        &self,
        library_skill_id: &str,
        provider: Provider,
    ) -> Result<(), AppError> {
        let _guard = lock_app_transaction(self.paths())?;
        let mut index = self.load_index()?;
        let skill_name = index
            .library_skills
            .iter()
            .find(|skill| skill.id == library_skill_id)
            .map(|skill| skill.name.clone())
            .ok_or_else(|| AppError::LibrarySkillNotFound {
                id: library_skill_id.to_owned(),
            })?;
        let root = self.paths().provider_root(provider)?;
        self.paths().assert_allowed(root)?;
        adopt_existing_installations(&mut index, self.paths());
        prune_missing_installations(&mut index);
        let managed_position = index.installations.iter().position(|installation| {
            installation.library_skill_id == library_skill_id && installation.provider == provider
        });
        let target_path = match managed_position {
            Some(position) => index.installations[position].target_path.clone(),
            None => safe_skill_target(root, &skill_name)?,
        };
        match fs::symlink_metadata(&target_path) {
            Ok(_) if !path_is_symlink_link(&target_path) => {
                return Err(AppError::TargetConflict {
                    path: target_path.display().to_string(),
                });
            }
            Ok(_) if managed_position.is_none() => {
                return Err(AppError::TargetConflict {
                    path: target_path.display().to_string(),
                });
            }
            Ok(_) => remove_directory_symlink(&target_path)?,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(error) => return Err(error.into()),
        }
        if let Some(position) = managed_position {
            index.installations.remove(position);
            sync_installation_statuses(&mut index);
            self.write_index(&index)?;
        }
        Ok(())
    }

    pub fn list_installations(&self) -> Result<Vec<SkillInstallation>, AppError> {
        let mut installations = self.load_index()?.installations;
        installations.sort_by(|left, right| {
            left.library_skill_id
                .cmp(&right.library_skill_id)
                .then(provider_order(left.provider).cmp(&provider_order(right.provider)))
        });
        Ok(installations)
    }

    pub fn scan_install_health(&self) -> Result<InstallHealthReport, AppError> {
        let index = self.load_index()?;
        Ok(InstallHealthReport {
            issues: crate::install_health::collect_health_issues(&index, self.paths()),
            repaired: 0,
        })
    }

    pub fn repair_installations(&self) -> Result<InstallHealthReport, AppError> {
        let _guard = lock_app_transaction(self.paths())?;
        let mut index = self.load_index()?;
        let (repaired, report) = crate::install_health::repair_index(&mut index, self.paths())?;
        self.write_index(&index)?;
        Ok(InstallHealthReport {
            issues: report.issues,
            repaired,
        })
    }

    /// Copy a provider skill directory into the library and optionally replace it with a managed link.
    pub fn migrate_provider_skill(
        &self,
        skill_name: &str,
        provider: Provider,
        source_path: &Path,
        replace_with_link: bool,
    ) -> Result<MigrateResult, AppError> {
        self.migrate_provider_skill_with_hooks(
            skill_name,
            provider,
            source_path,
            replace_with_link,
            create_directory_symlink,
            |index| self.write_index(index),
        )
    }

    pub(crate) fn migrate_provider_skill_with_hooks<Link, Writer>(
        &self,
        skill_name: &str,
        provider: Provider,
        source_path: &Path,
        replace_with_link: bool,
        create_link: Link,
        write_index: Writer,
    ) -> Result<MigrateResult, AppError>
    where
        Link: FnOnce(&Path, &Path) -> Result<(), AppError>,
        Writer: FnOnce(&crate::library_repository::LibraryIndex) -> Result<(), AppError>,
    {
        let _guard = lock_app_transaction(self.paths())?;
        let provider_root = self.paths().provider_root(provider)?;
        ensure_provider_source_path(source_path, provider_root)?;
        self.paths().assert_skill_access(source_path)?;
        if path_is_symlink_link(source_path) {
            let resolved = fs::canonicalize(source_path)?;
            if crate::path_norm::path_is_under(&resolved, &self.paths().library_dir) {
                return Err(AppError::Io {
                    message: "该 Skill 已是库安装链接，无需迁移".into(),
                });
            }
            return Err(AppError::Io {
                message: "不支持迁移符号链接 Skill，请迁移真实目录".into(),
            });
        }
        if !source_path.is_dir() {
            return Err(AppError::InvalidProjectPath {
                path: source_path.display().to_string(),
            });
        }

        let replace_target = if replace_with_link {
            let target = safe_skill_target(provider_root, skill_name)?;
            if target != source_path && fs::symlink_metadata(&target).is_ok() {
                return Err(AppError::TargetConflict {
                    path: target.display().to_string(),
                });
            }
            Some(target)
        } else {
            None
        };

        let project_id = Uuid::new_v4().to_string();
        let dest_root = self.paths().library_projects_dir.join(&project_id);
        let dest_skill = dest_root.join(skill_name);
        self.paths().assert_allowed(&dest_root)?;
        self.paths().assert_allowed(&dest_skill)?;
        fs::create_dir_all(&dest_root)?;
        if let Err(error) = crate::fs_ops::copy_directory(source_path, &dest_skill) {
            let _ = fs::remove_dir_all(&dest_root);
            return Err(error);
        }
        if !dest_skill.join("SKILL.md").is_file() {
            let _ = fs::remove_dir_all(&dest_root);
            return Err(AppError::Io {
                message: "迁移结果缺少 SKILL.md".into(),
            });
        }

        let mut index = match self.load_index() {
            Ok(index) => index,
            Err(error) => {
                let _ = fs::remove_dir_all(&dest_root);
                return Err(error);
            }
        };
        if let Err(error) = ensure_project_path_is_new(&index, &dest_root) {
            let _ = fs::remove_dir_all(&dest_root);
            return Err(error);
        }
        let project = project_for_source(ProjectSourceType::Local, dest_root.clone(), None);
        let skills = match scan_project(&project, &[]) {
            Ok(skills) => skills,
            Err(error) => {
                let _ = fs::remove_dir_all(&dest_root);
                return Err(error);
            }
        };
        let library_skill_id = skills
            .iter()
            .find(|skill| skill.name == skill_name || skill.relative_path.as_os_str().is_empty())
            .or_else(|| skills.first())
            .map(|skill| skill.id.clone())
            .ok_or_else(|| AppError::Io {
                message: "迁移后未扫描到 Skill".into(),
            });
        let library_skill_id = match library_skill_id {
            Ok(id) => id,
            Err(error) => {
                let _ = fs::remove_dir_all(&dest_root);
                return Err(error);
            }
        };
        index.projects.push(project.clone());
        index.library_skills.extend(skills);

        let mut replaced_with_link = false;
        if let Some(target) = replace_target {
            let source_canon = match dest_skill.canonicalize() {
                Ok(path) => path,
                Err(error) => {
                    let _ = fs::remove_dir_all(&dest_root);
                    return Err(error.into());
                }
            };
            let Some(parent) = source_path.parent() else {
                let _ = fs::remove_dir_all(&dest_root);
                return Err(AppError::Io {
                    message: format!("迁移源缺少父目录：{}", source_path.display()),
                });
            };
            let tombstone = parent.join(format!(
                ".skill-migrate-{}.tombstone",
                Uuid::new_v4()
            ));
            if let Err(error) = self.paths().assert_allowed(&tombstone) {
                let _ = fs::remove_dir_all(&dest_root);
                return Err(error);
            }
            if let Err(error) = fs::rename(source_path, &tombstone) {
                let _ = fs::remove_dir_all(&dest_root);
                return Err(error.into());
            }
            index.installations.retain(|installation| {
                !(installation.library_skill_id == library_skill_id
                    && installation.provider == provider)
            });
            index.installations.push(SkillInstallation {
                library_skill_id: library_skill_id.clone(),
                provider,
                source_path: source_canon.clone(),
                target_path: target.clone(),
                installed_at: Utc::now(),
            });
            sync_installation_statuses(&mut index);
            if let Err(error) = create_link(&source_canon, &target) {
                return Err(rollback_migration(
                    error,
                    false,
                    &source_canon,
                    &target,
                    &tombstone,
                    source_path,
                    &dest_root,
                ));
            }
            if let Err(error) = write_index(&index) {
                return Err(rollback_migration(
                    error,
                    true,
                    &source_canon,
                    &target,
                    &tombstone,
                    source_path,
                    &dest_root,
                ));
            }
            if let Err(error) = fs::remove_dir_all(&tombstone) {
                eprintln!(
                    "迁移成功后无法清理墓碑目录 {}：{error}",
                    tombstone.display()
                );
            }
            replaced_with_link = true;
        } else if let Err(error) = write_index(&index) {
            let _ = fs::remove_dir_all(&dest_root);
            return Err(error);
        }

        Ok(MigrateResult {
            project,
            library_skill_id,
            replaced_with_link,
        })
    }

    pub fn get_install_overview(
        &self,
        provider_skills: &[SkillSummary],
    ) -> Result<InstallOverview, AppError> {
        let managed = self.list_installations()?;
        let health = self.scan_install_health()?;
        let library_dir = &self.paths().library_dir;
        let managed_targets = managed
            .iter()
            .map(|installation| crate::path_norm::normalize_path_key(&installation.target_path))
            .collect::<std::collections::HashSet<_>>();
        let unmanaged = provider_skills
            .iter()
            .filter(|skill| {
                if managed_targets
                    .contains(&crate::path_norm::normalize_path_key(&skill.current_path))
                {
                    return false;
                }
                if let Some(resolved) = &skill.resolved_path {
                    if crate::path_norm::path_is_under(resolved, library_dir) {
                        return false;
                    }
                }
                true
            })
            .map(|skill| UnmanagedSkill {
                skill_id: skill.id.clone(),
                name: skill.name.clone(),
                provider: skill.provider,
                path: skill.current_path.clone(),
                description: skill.description.clone(),
            })
            .collect::<Vec<_>>();

        let mut by_name: std::collections::HashMap<String, DuplicateSkillGroup> =
            std::collections::HashMap::new();
        for skill in provider_skills {
            let entry = by_name
                .entry(skill.name.clone())
                .or_insert_with(|| DuplicateSkillGroup {
                    name: skill.name.clone(),
                    providers: Vec::new(),
                    library_skill_ids: Vec::new(),
                    unmanaged_skill_ids: Vec::new(),
                });
            if !entry.providers.contains(&skill.provider) {
                entry.providers.push(skill.provider);
            }
            if unmanaged.iter().any(|item| item.skill_id == skill.id) {
                entry.unmanaged_skill_ids.push(skill.id.clone());
            }
        }
        for skill in self.list_library_skills().unwrap_or_default() {
            let entry = by_name
                .entry(skill.name.clone())
                .or_insert_with(|| DuplicateSkillGroup {
                    name: skill.name.clone(),
                    providers: Vec::new(),
                    library_skill_ids: Vec::new(),
                    unmanaged_skill_ids: Vec::new(),
                });
            entry.library_skill_ids.push(skill.id);
        }
        let duplicates = by_name
            .into_values()
            .filter(|group| {
                group.providers.len() > 1
                    || (!group.library_skill_ids.is_empty()
                        && !group.unmanaged_skill_ids.is_empty())
            })
            .collect();

        Ok(InstallOverview {
            managed,
            unmanaged,
            duplicates,
            health,
        })
    }
}

fn remove_new_install_link_after_failure(
    original_error: AppError,
    target: &Path,
    expected_source: &Path,
) -> AppError {
    match remove_matching_directory_link(target, Some(expected_source)) {
        Ok(()) => original_error,
        Err(rollback_error) => AppError::RollbackFailed {
            original_error: original_error.to_string(),
            rollback_error: rollback_error.to_string(),
        },
    }
}

fn ensure_provider_source_path(source_path: &Path, provider_root: &Path) -> Result<(), AppError> {
    let parent = source_path.parent().ok_or_else(|| AppError::PathOutsideManagedRoots {
        path: source_path.display().to_string(),
    })?;
    let resolved_parent = parent.canonicalize()?;
    let resolved_root = provider_root.canonicalize()?;
    if crate::path_norm::path_is_under(&resolved_parent, &resolved_root) {
        Ok(())
    } else {
        Err(AppError::PathOutsideManagedRoots {
            path: source_path.display().to_string(),
        })
    }
}

fn rollback_changed_provider_root_install(
    original_error: AppError,
    previous_link: &Path,
    previous_target: &Path,
    new_target: &Path,
    expected_source: &Path,
) -> AppError {
    let mut rollback_errors = Vec::new();
    if let Err(error) = create_directory_symlink(previous_link, previous_target) {
        rollback_errors.push(error.to_string());
    }
    if let Err(error) = remove_matching_directory_link(new_target, Some(expected_source)) {
        rollback_errors.push(error.to_string());
    }
    if rollback_errors.is_empty() {
        original_error
    } else {
        AppError::RollbackFailed {
            original_error: original_error.to_string(),
            rollback_error: rollback_errors.join("; "),
        }
    }
}

fn rollback_migration(
    original_error: AppError,
    link_created: bool,
    expected_source: &Path,
    target: &Path,
    tombstone: &Path,
    source_path: &Path,
    dest_root: &Path,
) -> AppError {
    let mut rollback_errors = Vec::new();
    if link_created {
        if let Err(error) = remove_matching_directory_link(target, Some(expected_source)) {
            rollback_errors.push(error.to_string());
        }
    }
    if let Err(error) = crate::fs_ops::rename_directory_no_replace(tombstone, source_path) {
        rollback_errors.push(error.to_string());
    }
    if let Err(error) = fs::remove_dir_all(dest_root) {
        rollback_errors.push(error.to_string());
    }
    if rollback_errors.is_empty() {
        original_error
    } else {
        AppError::RollbackFailed {
            original_error: original_error.to_string(),
            rollback_error: rollback_errors.join("; "),
        }
    }
}

fn remove_matching_directory_link(
    target: &Path,
    expected_source: Option<&Path>,
) -> Result<(), AppError> {
    match fs::symlink_metadata(target) {
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(()),
        Err(error) => return Err(error.into()),
        Ok(_) if !path_is_symlink_link(target) => {
            return Err(AppError::TargetConflict {
                path: target.display().to_string(),
            });
        }
        Ok(_) => {}
    }
    if let Some(expected_source) = expected_source {
        let resolved = target.canonicalize().map_err(|_| AppError::TargetConflict {
            path: target.display().to_string(),
        })?;
        let expected = expected_source
            .canonicalize()
            .unwrap_or_else(|_| expected_source.to_path_buf());
        if !crate::path_norm::paths_eq(&resolved, &expected) {
            return Err(AppError::TargetConflict {
                path: target.display().to_string(),
            });
        }
    }
    remove_directory_symlink(target)
}

/// 未纳管 symlink 是否与库 Skill 同名（目录名或 SKILL.md frontmatter name）。
fn unmanaged_symlink_matches_skill(target_path: &Path, skill_name: &str) -> bool {
    let Ok(resolved) = target_path.canonicalize() else {
        return false;
    };
    if resolved
        .file_name()
        .and_then(|name| name.to_str())
        .is_some_and(|name| name.eq_ignore_ascii_case(skill_name))
    {
        return true;
    }
    let metadata = crate::skill_repository::read_skill_metadata(&resolved);
    !metadata.name.is_empty() && metadata.name.eq_ignore_ascii_case(skill_name)
}
