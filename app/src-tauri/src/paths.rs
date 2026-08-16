use std::ffi::OsString;
use std::path::{Path, PathBuf};

use crate::error::AppError;
use crate::model::Provider;
use crate::settings::SkillRootOverrides;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SkillRoot {
    pub provider: Provider,
    pub path: PathBuf,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AppPaths {
    pub skill_roots: Vec<SkillRoot>,
    pub app_data_dir: PathBuf,
    pub home_dir: PathBuf,
    pub disabled_dir: PathBuf,
    pub backups_dir: PathBuf,
    pub paused_index: PathBuf,
    pub backup_index: PathBuf,
    pub library_dir: PathBuf,
    pub library_projects_dir: PathBuf,
    pub library_index: PathBuf,
}

impl AppPaths {
    pub fn default_provider_root(home_dir: &Path, provider: Provider) -> PathBuf {
        match provider {
            Provider::Cursor => home_dir.join(".cursor/skills"),
            Provider::Claude => home_dir.join(".claude/skills"),
            Provider::Codex => home_dir.join(".codex/skills"),
        }
    }

    pub fn discover(app_data_dir: PathBuf, home_dir: PathBuf) -> Self {
        let overrides = crate::settings::load_settings(&app_data_dir)
            .unwrap_or_default()
            .skill_root_overrides;
        Self::discover_with_overrides(app_data_dir, home_dir, &overrides)
    }

    pub fn discover_with_overrides(
        app_data_dir: PathBuf,
        home_dir: PathBuf,
        overrides: &SkillRootOverrides,
    ) -> Self {
        let root_for = |provider: Provider| {
            overrides
                .for_provider(provider)
                .cloned()
                .unwrap_or_else(|| Self::default_provider_root(&home_dir, provider))
        };
        Self {
            skill_roots: vec![
                SkillRoot {
                    provider: Provider::Cursor,
                    path: root_for(Provider::Cursor),
                },
                SkillRoot {
                    provider: Provider::Claude,
                    path: root_for(Provider::Claude),
                },
                SkillRoot {
                    provider: Provider::Codex,
                    path: root_for(Provider::Codex),
                },
            ],
            disabled_dir: app_data_dir.join("disabled"),
            backups_dir: app_data_dir.join("backups"),
            paused_index: app_data_dir.join("paused-index.json"),
            backup_index: app_data_dir.join("backup-index.json"),
            library_dir: app_data_dir.join("library"),
            library_projects_dir: app_data_dir.join("library/projects"),
            library_index: app_data_dir.join("library-index.json"),
            home_dir,
            app_data_dir,
        }
    }

    pub fn assert_allowed(&self, path: &Path) -> Result<(), AppError> {
        let requested = resolve_path(path)?;
        let mut allowed_roots: Vec<&Path> = self
            .skill_roots
            .iter()
            .map(|root| root.path.as_path())
            .collect();
        allowed_roots.extend([
            self.app_data_dir.as_path(),
            self.disabled_dir.as_path(),
            self.backups_dir.as_path(),
            self.library_dir.as_path(),
            self.library_projects_dir.as_path(),
        ]);

        for root in allowed_roots {
            let Ok(resolved_root) = resolve_path(root) else {
                continue;
            };
            if crate::path_norm::path_is_under(&requested, &resolved_root) {
                return Ok(());
            }
        }

        Err(AppError::PathOutsideManagedRoots {
            path: path.display().to_string(),
        })
    }

    /// 允许读取/操作「位于 provider Skill 根下的符号链接 Skill」。
    /// 链接本身在白名单根内，目标可指向库路径等白名单外目录。
    pub fn assert_skill_access(&self, path: &Path) -> Result<(), AppError> {
        match self.assert_allowed(path) {
            Ok(()) => Ok(()),
            Err(_) if self.is_provider_skill_symlink(path) => Ok(()),
            Err(error) => Err(error),
        }
    }

    fn is_provider_skill_symlink(&self, path: &Path) -> bool {
        if !crate::fs_ops::path_is_symlink_link(path) {
            return false;
        }
        let Some(parent) = path.parent() else {
            return false;
        };
        let Ok(parent_resolved) = resolve_path(parent) else {
            return false;
        };
        self.skill_roots.iter().any(|root| {
            resolve_path(&root.path)
                .is_ok_and(|resolved_root| crate::path_norm::paths_eq(&resolved_root, &parent_resolved))
        })
    }

    pub fn provider_root(&self, provider: Provider) -> Result<&Path, AppError> {
        self.skill_roots
            .iter()
            .find(|root| root.provider == provider)
            .map(|root| root.path.as_path())
            .ok_or_else(|| AppError::PathOutsideManagedRoots {
                path: format!("未配置 {provider:?} Skill 根目录"),
            })
    }

    pub fn assert_within(&self, path: &Path, root: &Path) -> Result<(), AppError> {
        let requested = resolve_path(path)?;
        let resolved_root = resolve_path(root)?;
        if crate::path_norm::path_is_under(&requested, &resolved_root)
            && !crate::path_norm::paths_eq(&requested, &resolved_root)
        {
            return Ok(());
        }
        Err(AppError::PathOutsideManagedRoots {
            path: path.display().to_string(),
        })
    }

    #[cfg(test)]
    pub fn for_test(base: &Path) -> Self {
        Self::discover(base.join("app-data"), base.to_path_buf())
    }
}

fn resolve_path(path: &Path) -> Result<PathBuf, AppError> {
    let absolute = if path.is_absolute() {
        path.to_path_buf()
    } else {
        std::env::current_dir()?.join(path)
    };
    let mut existing = absolute.as_path();
    let mut missing: Vec<OsString> = Vec::new();

    let _metadata = loop {
        match existing.symlink_metadata() {
            Ok(metadata) => break metadata,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                let segment =
                    existing
                        .file_name()
                        .ok_or_else(|| AppError::PathOutsideManagedRoots {
                            path: path.display().to_string(),
                        })?;
                missing.push(segment.to_os_string());
                existing = existing
                    .parent()
                    .ok_or_else(|| AppError::PathOutsideManagedRoots {
                        path: path.display().to_string(),
                    })?;
            }
            Err(error) => return Err(error.into()),
        }
    };

    let mut resolved = existing.canonicalize().map_err(|error| {
        if crate::fs_ops::path_is_symlink_link(path) && error.kind() == std::io::ErrorKind::NotFound
        {
            AppError::PathOutsideManagedRoots {
                path: path.display().to_string(),
            }
        } else {
            error.into()
        }
    })?;
    for segment in missing.iter().rev() {
        resolved.push(segment);
    }
    Ok(resolved)
}

#[cfg(test)]
mod tests {
    use std::fs;
    use std::path::PathBuf;

    use tempfile::tempdir;

    use super::AppPaths;
    use crate::model::Provider;

    #[test]
    fn rejects_path_outside_managed_roots() {
        let base = tempdir().unwrap();
        let paths = AppPaths::for_test(base.path());
        let outside = tempdir().unwrap();

        assert!(paths.assert_allowed(outside.path()).is_err());
    }

    #[test]
    fn accepts_skill_and_app_data_paths() {
        let base = tempdir().unwrap();
        let paths = AppPaths::for_test(base.path());
        let skill_path = paths.skill_roots[0].path.join("example/SKILL.md");
        let disabled_path = paths.disabled_dir.join("example");
        let backup_path = paths.backups_dir.join("backup.zip");

        assert!(paths.assert_allowed(&paths.skill_roots[0].path).is_ok());
        assert!(paths.assert_allowed(&skill_path).is_ok());
        assert!(paths.assert_allowed(&paths.disabled_dir).is_ok());
        assert!(paths.assert_allowed(&disabled_path).is_ok());
        assert!(paths.assert_allowed(&paths.backups_dir).is_ok());
        assert!(paths.assert_allowed(&backup_path).is_ok());
    }

    #[test]
    fn rejects_parent_traversal_for_missing_target() {
        let base = tempdir().unwrap();
        let paths = AppPaths::for_test(base.path());
        fs::create_dir_all(&paths.disabled_dir).unwrap();
        let escaped = paths.disabled_dir.join("missing/../../../outside");

        assert!(paths.assert_allowed(&escaped).is_err());
    }

    #[cfg(unix)]
    #[test]
    fn rejects_parent_traversal_through_symlink() {
        use std::os::unix::fs::symlink;

        let base = tempdir().unwrap();
        let outside = tempdir().unwrap();
        let paths = AppPaths::for_test(base.path());
        fs::create_dir_all(&paths.disabled_dir).unwrap();
        symlink(outside.path(), paths.disabled_dir.join("link")).unwrap();
        let escaped = paths.disabled_dir.join("link/../outside");

        assert!(paths.assert_allowed(&escaped).is_err());
    }

    #[cfg(unix)]
    #[test]
    fn rejects_dangling_symlink_in_managed_root() {
        use std::os::unix::fs::symlink;

        let base = tempdir().unwrap();
        let outside = tempdir().unwrap();
        let paths = AppPaths::for_test(base.path());
        fs::create_dir_all(&paths.disabled_dir).unwrap();
        let link = paths.disabled_dir.join("escape");
        symlink(outside.path().join("not-created"), &link).unwrap();

        assert!(paths.assert_allowed(&link).is_err());
    }

    #[cfg(unix)]
    #[test]
    fn skill_access_allows_provider_root_symlink_to_outside_skill() {
        use std::os::unix::fs::symlink;

        let base = tempdir().unwrap();
        let outside = tempdir().unwrap();
        let paths = AppPaths::for_test(base.path());
        fs::create_dir_all(&paths.skill_roots[0].path).unwrap();
        fs::write(outside.path().join("SKILL.md"), "# Outside").unwrap();
        let link = paths.skill_roots[0].path.join("linked-skill");
        symlink(outside.path(), &link).unwrap();

        assert!(paths.assert_allowed(&link).is_err());
        assert!(paths.assert_skill_access(&link).is_ok());
    }

    #[cfg(unix)]
    #[test]
    fn rejects_descendant_of_dangling_symlink() {
        use std::os::unix::fs::symlink;

        let base = tempdir().unwrap();
        let outside = tempdir().unwrap();
        let paths = AppPaths::for_test(base.path());
        fs::create_dir_all(&paths.disabled_dir).unwrap();
        let link = paths.disabled_dir.join("escape");
        symlink(outside.path().join("not-created"), &link).unwrap();

        assert!(paths.assert_allowed(&link.join("child")).is_err());
    }

    #[cfg(unix)]
    #[test]
    fn allows_paths_when_earlier_root_is_dangling_symlink() {
        use std::os::unix::fs::symlink;

        let base = tempdir().unwrap();
        let paths = AppPaths::for_test(base.path());
        let outside = tempdir().unwrap();

        fs::create_dir_all(base.path().join(".cursor")).unwrap();
        symlink(
            outside.path().join("not-created"),
            paths.skill_roots[0].path.as_path(),
        )
        .unwrap();
        fs::create_dir_all(&paths.skill_roots[1].path).unwrap();
        fs::create_dir_all(&paths.disabled_dir).unwrap();
        fs::create_dir_all(&paths.backups_dir).unwrap();

        let claude_skill = paths.skill_roots[1].path.join("example/SKILL.md");
        let disabled_path = paths.disabled_dir.join("example");
        let backup_path = paths.backups_dir.join("backup.zip");

        assert!(paths.assert_allowed(&paths.skill_roots[1].path).is_ok());
        assert!(paths.assert_allowed(&claude_skill).is_ok());
        assert!(paths.assert_allowed(&paths.disabled_dir).is_ok());
        assert!(paths.assert_allowed(&disabled_path).is_ok());
        assert!(paths.assert_allowed(&paths.backups_dir).is_ok());
        assert!(paths.assert_allowed(&backup_path).is_ok());
    }

    #[cfg(unix)]
    #[test]
    fn rejects_parent_traversal_through_dangling_symlink() {
        use std::os::unix::fs::symlink;

        let base = tempdir().unwrap();
        let outside = tempdir().unwrap();
        let paths = AppPaths::for_test(base.path());
        fs::create_dir_all(&paths.disabled_dir).unwrap();
        let link = paths.disabled_dir.join("escape");
        symlink(outside.path().join("not-created"), &link).unwrap();
        let escaped = link.join("../child");

        assert!(paths.assert_allowed(&escaped).is_err());
    }

    #[test]
    fn discover_builds_three_default_roots() {
        let app_data_dir = PathBuf::from("/tmp/skill-manager");
        let home_dir = PathBuf::from("/Users/tester");

        let paths = AppPaths::discover(app_data_dir.clone(), home_dir.clone());

        assert_eq!(paths.skill_roots.len(), 3);
        assert_eq!(paths.skill_roots[0].provider, Provider::Cursor);
        assert_eq!(paths.skill_roots[0].path, home_dir.join(".cursor/skills"));
        assert_eq!(paths.skill_roots[1].provider, Provider::Claude);
        assert_eq!(paths.skill_roots[1].path, home_dir.join(".claude/skills"));
        assert_eq!(paths.skill_roots[2].provider, Provider::Codex);
        assert_eq!(paths.skill_roots[2].path, home_dir.join(".codex/skills"));
        assert_eq!(paths.app_data_dir, app_data_dir);
        assert_eq!(paths.disabled_dir, app_data_dir.join("disabled"));
        assert_eq!(paths.backups_dir, app_data_dir.join("backups"));
        assert_eq!(paths.paused_index, app_data_dir.join("paused-index.json"));
        assert_eq!(paths.backup_index, app_data_dir.join("backup-index.json"));
        assert_eq!(paths.library_dir, app_data_dir.join("library"));
        assert_eq!(
            paths.library_projects_dir,
            app_data_dir.join("library/projects")
        );
        assert_eq!(paths.library_index, app_data_dir.join("library-index.json"));
    }

    #[cfg(windows)]
    #[test]
    fn assert_allowed_ignores_windows_path_case() {
        let base = tempdir().unwrap();
        let paths = AppPaths::for_test(base.path());
        fs::create_dir_all(&paths.library_dir).unwrap();
        let child = paths.library_dir.join("example");
        fs::create_dir_all(&child).unwrap();
        let mixed = PathBuf::from(child.to_string_lossy().to_ascii_uppercase());

        assert!(paths.assert_allowed(&mixed).is_ok());
        assert!(paths.assert_within(&mixed, &paths.library_dir).is_ok());
    }

    #[cfg(windows)]
    #[test]
    fn skill_access_matches_provider_root_case() {
        let base = tempdir().unwrap();
        let paths = AppPaths::for_test(base.path());
        fs::create_dir_all(&paths.skill_roots[0].path).unwrap();
        let link = paths.skill_roots[0].path.join("linked-skill");
        crate::fs_ops::create_directory_link(base.path(), &link).unwrap();
        let mixed_link = PathBuf::from(link.to_string_lossy().to_ascii_uppercase());

        assert!(paths.assert_skill_access(&mixed_link).is_ok());
    }
}
