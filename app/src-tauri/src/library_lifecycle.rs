use std::fs;
use std::path::Path;

use uuid::Uuid;

use crate::error::AppError;
use crate::library_repository::{
    project_for_source, replace_project_skills, sync_installation_statuses, validate_skill_dirname,
    LibraryRepository,
};
use crate::model::{LibrarySkillSummary, ProjectSourceType, Provider};
use crate::transaction_lock::lock_app_transaction;

impl LibraryRepository {
    pub fn has_installation(
        &self,
        library_skill_id: &str,
        provider: Provider,
    ) -> Result<bool, AppError> {
        let index = self.load_index()?;
        Ok(index.installations.iter().any(|installation| {
            installation.library_skill_id == library_skill_id && installation.provider == provider
        }))
    }

    pub fn create_library_skill(
        &self,
        name: String,
        description: String,
        project_id: Option<String>,
    ) -> Result<LibrarySkillSummary, AppError> {
        let name = validate_skill_dirname(&name)?;
        let _guard = lock_app_transaction(self.paths())?;
        let mut index = self.load_index()?;

        let project = if let Some(id) = project_id {
            index
                .projects
                .iter()
                .find(|project| project.id == id)
                .cloned()
                .ok_or_else(|| AppError::ProjectNotFound { id })?
        } else {
            let folder = Uuid::new_v4().to_string();
            let dest = self.paths().library_projects_dir.join(&folder);
            self.paths().assert_allowed(&dest)?;
            fs::create_dir_all(&dest)?;
            let project = project_for_source(ProjectSourceType::Local, dest, None);
            index.projects.push(project.clone());
            project
        };

        let skill_dir = project.local_path.join(&name);
        if !crate::path_norm::path_is_under(&skill_dir, &project.local_path) {
            return Err(AppError::PathOutsideManagedRoots {
                path: skill_dir.display().to_string(),
            });
        }
        if skill_dir.exists() {
            return Err(AppError::TargetConflict {
                path: skill_dir.display().to_string(),
            });
        }
        // 库内项目走白名单；外部已登记项目以索引为准（与 read/write_library_skill_file 一致）。
        if is_under_library(self.paths().library_dir.as_path(), &project.local_path) {
            self.paths().assert_allowed(&skill_dir)?;
        }
        fs::create_dir_all(&skill_dir)?;
        let description = description.trim();
        let body = if description.is_empty() {
            format!("# {name}\n")
        } else {
            format!("# {name}\n\n{description}\n")
        };
        let markdown = format!(
            "---\nname: {name}\ndescription: {desc}\n---\n\n{body}",
            desc = if description.is_empty() {
                format!("{name} skill")
            } else {
                description.to_string()
            }
        );
        fs::write(skill_dir.join("SKILL.md"), markdown)?;

        replace_project_skills(&mut index, &project)?;
        sync_installation_statuses(&mut index);
        self.write_index(&index)?;

        index
            .library_skills
            .into_iter()
            .find(|skill| skill.project_id == project.id && skill.name == name)
            .ok_or_else(|| AppError::Io {
                message: "新建后未扫描到 Skill".into(),
            })
    }

    pub fn rename_library_skill(
        &self,
        skill_id: &str,
        new_name: String,
    ) -> Result<LibrarySkillSummary, AppError> {
        self.rename_library_skill_with_writer(skill_id, new_name, |index| self.write_index(index))
    }

    pub(crate) fn rename_library_skill_with_writer<Writer>(
        &self,
        skill_id: &str,
        new_name: String,
        write_index: Writer,
    ) -> Result<LibrarySkillSummary, AppError>
    where
        Writer: FnOnce(&crate::library_repository::LibraryIndex) -> Result<(), AppError>,
    {
        let new_name = validate_skill_dirname(&new_name)?;
        let _guard = lock_app_transaction(self.paths())?;
        let mut index = self.load_index()?;
        let skill = index
            .library_skills
            .iter()
            .find(|skill| skill.id == skill_id)
            .cloned()
            .ok_or_else(|| AppError::LibrarySkillNotFound {
                id: skill_id.to_owned(),
            })?;
        if !is_under_library(self.paths().library_dir.as_path(), &skill.absolute_path) {
            return Err(AppError::Io {
                message: "仅支持重命名库目录内的 Skill".into(),
            });
        }
        if !skill.installed_providers.is_empty() {
            return Err(AppError::Io {
                message: "请先卸载所有安装后再重命名".into(),
            });
        }
        let parent = skill.absolute_path.parent().ok_or_else(|| AppError::Io {
            message: "无法解析 Skill 父目录".into(),
        })?;
        let dest = parent.join(&new_name);
        if dest.exists() {
            return Err(AppError::TargetConflict {
                path: dest.display().to_string(),
            });
        }
        self.paths().assert_allowed(&skill.absolute_path)?;
        self.paths().assert_allowed(&dest)?;
        let original_skill_md_path =
            crate::skill_files::resolve_writable_file_path(&skill.absolute_path, "SKILL.md")?;
        let original_skill_md = fs::read(&original_skill_md_path)?;
        fs::rename(&skill.absolute_path, &dest)?;
        let result = (|| {
            rewrite_skill_frontmatter_name(&dest, &new_name)?;
            let project = index
                .projects
                .iter()
                .find(|project| project.id == skill.project_id)
                .cloned()
                .ok_or_else(|| AppError::ProjectNotFound {
                    id: skill.project_id.clone(),
                })?;
            replace_project_skills(&mut index, &project)?;
            // Preserve taxonomy for renamed skill by matching relative path stem when possible.
            if let Some(updated) = index
                .library_skills
                .iter_mut()
                .find(|item| item.project_id == project.id && item.name == new_name)
            {
                updated.group_id = skill.group_id.clone();
                updated.tag_ids = skill.tag_ids.clone();
            }
            sync_installation_statuses(&mut index);
            let updated = index
                .library_skills
                .iter()
                .find(|item| item.project_id == project.id && item.name == new_name)
                .cloned()
                .ok_or_else(|| AppError::Io {
                    message: "重命名后未扫描到 Skill".into(),
                })?;
            write_index(&index)?;
            Ok(updated)
        })();
        match result {
            Ok(updated) => Ok(updated),
            Err(error) => Err(rollback_library_skill_rename(
                error,
                &dest,
                &skill.absolute_path,
                &original_skill_md,
            )),
        }
    }

    pub fn delete_library_skill(&self, skill_id: &str) -> Result<(), AppError> {
        let skill = {
            let index = self.load_index()?;
            index
                .library_skills
                .iter()
                .find(|skill| skill.id == skill_id)
                .cloned()
                .ok_or_else(|| AppError::LibrarySkillNotFound {
                    id: skill_id.to_owned(),
                })?
        };
        if !is_under_library(self.paths().library_dir.as_path(), &skill.absolute_path) {
            return Err(AppError::Io {
                message: "外部引用项目中的 Skill 请到「项目」页移除".into(),
            });
        }

        let providers = skill.installed_providers.clone();
        for provider in providers {
            self.uninstall_skill(skill_id, provider)?;
        }

        let _guard = lock_app_transaction(self.paths())?;
        let mut index = self.load_index()?;
        let skill = index
            .library_skills
            .iter()
            .find(|item| item.id == skill_id)
            .cloned()
            .ok_or_else(|| AppError::LibrarySkillNotFound {
                id: skill_id.to_owned(),
            })?;
        self.paths().assert_allowed(&skill.absolute_path)?;
        if skill.absolute_path.exists() {
            if skill.absolute_path.is_dir() {
                fs::remove_dir_all(&skill.absolute_path)?;
            } else {
                fs::remove_file(&skill.absolute_path)?;
            }
        }

        let project = index
            .projects
            .iter()
            .find(|project| project.id == skill.project_id)
            .cloned()
            .ok_or_else(|| AppError::ProjectNotFound {
                id: skill.project_id.clone(),
            })?;
        replace_project_skills(&mut index, &project)?;
        index
            .installations
            .retain(|installation| installation.library_skill_id != skill_id);

        let remaining = index
            .library_skills
            .iter()
            .filter(|item| item.project_id == project.id)
            .count();
        if remaining == 0
            && project.source_type == ProjectSourceType::Local
            && is_under_library(self.paths().library_dir.as_path(), &project.local_path)
        {
            index.projects.retain(|item| item.id != project.id);
            if project.local_path.exists() {
                let _ = fs::remove_dir_all(&project.local_path);
            }
        }
        sync_installation_statuses(&mut index);
        self.write_index(&index)?;
        Ok(())
    }
}

fn rollback_library_skill_rename(
    original_error: AppError,
    renamed_path: &Path,
    original_path: &Path,
    original_skill_md: &[u8],
) -> AppError {
    let mut rollback_errors = Vec::new();
    match crate::skill_files::resolve_writable_file_path(renamed_path, "SKILL.md") {
        Ok(path) => {
            if let Err(error) = fs::write(path, original_skill_md) {
                rollback_errors.push(error.to_string());
            }
        }
        Err(error) => rollback_errors.push(error.to_string()),
    }
    if let Err(error) = crate::fs_ops::rename_directory_no_replace(renamed_path, original_path) {
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

fn is_under_library(library_dir: &Path, path: &Path) -> bool {
    let Ok(canon) = path.canonicalize() else {
        return crate::path_norm::path_is_under(path, library_dir);
    };
    let Ok(lib) = library_dir.canonicalize() else {
        return crate::path_norm::path_is_under(&canon, library_dir);
    };
    crate::path_norm::path_is_under(&canon, &lib)
}

fn rewrite_skill_frontmatter_name(skill_dir: &Path, new_name: &str) -> Result<(), AppError> {
    crate::skill_metadata::rewrite_skill_frontmatter_name(skill_dir, new_name)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::paths::AppPaths;
    use tempfile::tempdir;

    fn write_skill(path: &Path, name: &str) {
        fs::create_dir_all(path).unwrap();
        fs::write(
            path.join("SKILL.md"),
            format!("---\nname: {name}\ndescription: {name}\n---\n\n# {name}\n"),
        )
        .unwrap();
    }

    #[test]
    fn create_rename_delete_library_skill_round_trip() {
        let base = tempdir().unwrap();
        let repository = LibraryRepository::new(AppPaths::for_test(base.path()));

        let created = repository
            .create_library_skill("demo-skill".into(), "演示".into(), None)
            .unwrap();
        assert_eq!(created.name, "demo-skill");
        assert!(created.absolute_path.join("SKILL.md").is_file());
        assert!(is_under_library(
            repository.paths().library_dir.as_path(),
            &created.absolute_path
        ));

        let renamed = repository
            .rename_library_skill(&created.id, "demo-renamed".into())
            .unwrap();
        assert_eq!(renamed.name, "demo-renamed");
        assert!(renamed.absolute_path.join("SKILL.md").is_file());
        assert!(!created.absolute_path.exists());

        repository.delete_library_skill(&renamed.id).unwrap();
        assert!(repository.list_library_skills().unwrap().is_empty());
    }

    #[test]
    fn create_library_skill_in_external_project() {
        let base = tempdir().unwrap();
        let external = tempdir().unwrap();
        write_skill(&external.path().join("existing"), "existing");
        let repository = LibraryRepository::new(AppPaths::for_test(base.path()));
        let project = repository.add_local_project(external.path()).unwrap();

        let created = repository
            .create_library_skill(
                "brand-new".into(),
                "外部项目新建".into(),
                Some(project.id.clone()),
            )
            .unwrap();
        assert_eq!(created.name, "brand-new");
        assert_eq!(created.project_id, project.id);
        assert!(created.absolute_path.join("SKILL.md").is_file());
        assert!(!is_under_library(
            repository.paths().library_dir.as_path(),
            &created.absolute_path
        ));
    }

    #[test]
    fn delete_external_skill_is_rejected() {
        let base = tempdir().unwrap();
        let external = tempdir().unwrap();
        write_skill(&external.path().join("ext"), "ext");
        let repository = LibraryRepository::new(AppPaths::for_test(base.path()));
        let project = repository.add_local_project(external.path()).unwrap();
        let skill = repository
            .list_library_skills()
            .unwrap()
            .into_iter()
            .find(|skill| skill.project_id == project.id)
            .unwrap();

        let err = repository.delete_library_skill(&skill.id).unwrap_err();
        assert!(err.to_string().contains("项目"));
        assert!(skill.absolute_path.exists());
    }

    #[test]
    fn rename_conflict_does_not_overwrite() {
        let base = tempdir().unwrap();
        let repository = LibraryRepository::new(AppPaths::for_test(base.path()));
        let first = repository
            .create_library_skill("alpha".into(), "".into(), None)
            .unwrap();
        let _second = repository
            .create_library_skill("beta".into(), "".into(), Some(first.project_id.clone()))
            .unwrap();
        let err = repository
            .rename_library_skill(&first.id, "beta".into())
            .unwrap_err();
        assert!(matches!(err, AppError::TargetConflict { .. }));
        assert!(first.absolute_path.exists());
    }

    #[test]
    fn rename_index_failure_restores_directory_and_frontmatter() {
        let base = tempdir().unwrap();
        let repository = LibraryRepository::new(AppPaths::for_test(base.path()));
        let created = repository
            .create_library_skill("alpha".into(), "original".into(), None)
            .unwrap();
        let original = fs::read(created.absolute_path.join("SKILL.md")).unwrap();

        let error = repository
            .rename_library_skill_with_writer(&created.id, "beta".into(), |_| {
                Err(AppError::Io {
                    message: "injected rename index failure".into(),
                })
            })
            .unwrap_err();

        assert!(error.to_string().contains("injected rename index failure"));
        assert!(created.absolute_path.is_dir());
        assert!(!created.absolute_path.with_file_name("beta").exists());
        assert_eq!(
            fs::read(created.absolute_path.join("SKILL.md")).unwrap(),
            original
        );
        assert_eq!(repository.list_library_skills().unwrap()[0].name, "alpha");
    }
}
