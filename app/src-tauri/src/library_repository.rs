use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::{Path, PathBuf};

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use uuid::Uuid;
use walkdir::WalkDir;

use crate::error::AppError;
use crate::fs_ops::{create_directory_link, path_is_symlink_link};
use crate::git_ops::{
    browse_url_from_git_url, clone_repository, latest_commit_time, project_name_from_git_url,
    pull_fast_forward, read_origin_url, source_repo_from_git_url, validate_git_url,
};
use crate::json_store::{read_json_value, write_json_value};
use crate::model::{
    FileContent, FileNode, LibrarySkillDetail, LibrarySkillSummary, Project, ProjectSourceType,
    Provider, SkillGroup, SkillInstallation, Tag,
};
use crate::paths::AppPaths;
use crate::skill_files::{list_skill_tree_at, read_skill_file_at};
use crate::skill_repository::read_skill_metadata;
use crate::transaction_lock::lock_app_transaction;

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub(crate) struct LibraryIndex {
    pub(crate) projects: Vec<Project>,
    pub(crate) library_skills: Vec<LibrarySkillSummary>,
    pub(crate) installations: Vec<SkillInstallation>,
    pub(crate) tags: Vec<Tag>,
    pub(crate) groups: Vec<SkillGroup>,
}

pub struct LibraryRepository {
    paths: AppPaths,
}

impl LibraryRepository {
    pub fn new(paths: AppPaths) -> Self {
        Self { paths }
    }

    pub fn set_paths(&mut self, paths: AppPaths) {
        self.paths = paths;
    }

    pub(crate) fn paths(&self) -> &AppPaths {
        &self.paths
    }

    pub fn add_local_project(&self, path: impl AsRef<Path>) -> Result<Project, AppError> {
        let path = canonical_project_path(path.as_ref())?;
        let _guard = lock_app_transaction(&self.paths)?;
        let mut index = self.load_index()?;
        ensure_project_path_is_new(&index, &path)?;
        let project = project_for_source(ProjectSourceType::Local, path, None);
        let skills = scan_project(&project, &[])?;
        index.projects.push(project.clone());
        index.library_skills.extend(skills);
        self.write_index(&index)?;
        Ok(project)
    }

    pub fn add_git_project(&self, url: &str) -> Result<Project, AppError> {
        validate_git_url(url)?;
        let _guard = lock_app_transaction(&self.paths)?;
        let mut index = self.load_index()?;
        if index
            .projects
            .iter()
            .any(|project| project.remote_url.as_deref() == Some(url))
        {
            return Err(AppError::ProjectAlreadyExists {
                value: url.to_owned(),
            });
        }
        let id = stable_id(&format!("git:{url}"));
        let destination = self.paths.library_projects_dir.join(&id);
        self.paths
            .assert_within(&destination, &self.paths.library_projects_dir)?;
        if destination.exists() {
            return Err(AppError::TargetConflict {
                path: destination.display().to_string(),
            });
        }
        fs::create_dir_all(&self.paths.library_projects_dir)?;
        if let Err(error) = clone_repository(url, &destination) {
            let _ = fs::remove_dir_all(&destination);
            return Err(error);
        }
        let mut project = project_for_source(
            ProjectSourceType::Git,
            destination.clone(),
            Some(url.to_owned()),
        );
        project.id = id;
        project.last_synced_at = Some(Utc::now());
        project.last_updated_at = latest_commit_time(&destination)?.or_else(|| Some(Utc::now()));
        let result = (|| {
            let skills = scan_project(&project, &[])?;
            index.projects.push(project.clone());
            index.library_skills.extend(skills);
            self.write_index(&index)
        })();
        if let Err(error) = result {
            let _ = fs::remove_dir_all(destination);
            return Err(error);
        }
        Ok(project)
    }

    pub fn pull_git_project(
        &self,
        project_id: &str,
    ) -> Result<crate::model::ProjectPullResult, AppError> {
        let _guard = lock_app_transaction(&self.paths)?;
        let mut index = self.load_index()?;
        let position = project_position(&index, project_id)?;
        if index.projects[position].source_type != ProjectSourceType::Git {
            return Err(AppError::GitOperation {
                message: "本地引用项目不能执行 Git 拉取".to_string(),
            });
        }
        let path = index.projects[position].local_path.clone();
        self.paths
            .assert_within(&path, &self.paths.library_projects_dir)?;
        let previous = project_skills(&index, project_id);
        let previous_fingerprints = previous
            .iter()
            .map(|skill| {
                (
                    skill.relative_path.clone(),
                    (
                        skill.name.clone(),
                        skill.description.clone(),
                        crate::skill_metadata::skill_content_fingerprint(&skill.absolute_path),
                    ),
                )
            })
            .collect::<HashMap<_, _>>();
        pull_fast_forward(&path)?;
        index.projects[position].last_synced_at = Some(Utc::now());
        index.projects[position].last_updated_at =
            latest_commit_time(&path)?.or_else(|| Some(Utc::now()));
        let project = index.projects[position].clone();
        let rescanned = scan_project(&project, &previous)?;
        let previous_by_rel = previous
            .iter()
            .map(|skill| (skill.relative_path.clone(), skill.clone()))
            .collect::<HashMap<_, _>>();
        let mut added = Vec::new();
        let mut changed = Vec::new();
        for skill in &rescanned {
            match previous_by_rel.get(&skill.relative_path) {
                None => added.push(skill.clone()),
                Some(_) => {
                    let fingerprint =
                        crate::skill_metadata::skill_content_fingerprint(&skill.absolute_path);
                    if previous_fingerprints.get(&skill.relative_path).is_some_and(
                        |(name, description, prev_fp)| {
                            name != &skill.name
                                || description != &skill.description
                                || prev_fp != &fingerprint
                        },
                    ) {
                        changed.push(skill.clone());
                    }
                }
            }
        }
        let rescanned_rels = rescanned
            .iter()
            .map(|skill| skill.relative_path.clone())
            .collect::<HashSet<_>>();
        let removed = previous
            .into_iter()
            .filter(|skill| !rescanned_rels.contains(&skill.relative_path))
            .collect::<Vec<_>>();
        index
            .library_skills
            .retain(|skill| skill.project_id != project_id);
        index.library_skills.extend(rescanned);
        self.write_index(&index)?;
        Ok(crate::model::ProjectPullResult {
            project,
            added,
            removed,
            changed,
        })
    }

    pub fn remove_project(&self, project_id: &str) -> Result<(), AppError> {
        let _guard = lock_app_transaction(&self.paths)?;
        let mut index = self.load_index()?;
        let position = project_position(&index, project_id)?;
        let project = index.projects[position].clone();
        if project.source_type == ProjectSourceType::Git {
            self.paths
                .assert_within(&project.local_path, &self.paths.library_projects_dir)?;
            match fs::remove_dir_all(&project.local_path) {
                Ok(()) => {}
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
                Err(error) => return Err(error.into()),
            }
        }
        index.projects.remove(position);
        index
            .library_skills
            .retain(|skill| skill.project_id != project_id);
        self.write_index(&index)
    }

    pub fn list_projects(&self) -> Result<Vec<Project>, AppError> {
        let _guard = lock_app_transaction(&self.paths)?;
        let mut index = self.load_index()?;
        let dirty = normalize_projects(&mut index.projects);
        if dirty {
            self.write_index(&index)?;
        }
        let mut projects = index.projects;
        projects.sort_by(|left, right| left.name.cmp(&right.name).then(left.id.cmp(&right.id)));
        Ok(projects)
    }

    pub fn list_library_skills(&self) -> Result<Vec<LibrarySkillSummary>, AppError> {
        let _guard = lock_app_transaction(&self.paths)?;
        let mut index = self.load_index()?;
        let mut refreshed = Vec::new();
        for project in &index.projects {
            let previous = project_skills(&index, &project.id);
            match scan_project(project, &previous) {
                Ok(skills) => refreshed.extend(skills),
                Err(error) => {
                    // Keep previous skills for this project if a single project becomes unreadable.
                    refreshed.extend(previous);
                    eprintln!(
                        "刷新库项目扫描失败 {}：{error}",
                        project.local_path.display()
                    );
                }
            }
        }
        index.library_skills = refreshed;
        adopt_existing_installations(&mut index, &self.paths);
        prune_missing_installations(&mut index);
        sync_installation_statuses(&mut index);
        self.write_index(&index)?;
        let mut skills = index.library_skills;
        skills.sort_by(|left, right| left.name.cmp(&right.name).then(left.id.cmp(&right.id)));
        Ok(skills)
    }

    pub fn get_library_skill_detail(&self, skill_id: &str) -> Result<LibrarySkillDetail, AppError> {
        let summary = self.library_skill(skill_id)?;
        let skill_markdown =
            fs::read_to_string(summary.absolute_path.join("SKILL.md")).map_err(AppError::from)?;
        let mut files = WalkDir::new(&summary.absolute_path)
            .follow_links(false)
            .min_depth(1)
            .into_iter()
            .filter_map(Result::ok)
            .filter(|entry| entry.file_type().is_file())
            .filter_map(|entry| {
                entry
                    .path()
                    .strip_prefix(&summary.absolute_path)
                    .ok()
                    .map(|path| path.to_string_lossy().into_owned())
            })
            .collect::<Vec<_>>();
        files.sort();
        Ok(LibrarySkillDetail {
            summary,
            skill_markdown,
            files,
        })
    }

    pub fn list_library_skill_tree(&self, skill_id: &str) -> Result<Vec<FileNode>, AppError> {
        let skill = self.library_skill(skill_id)?;
        list_skill_tree_at(&skill.absolute_path)
    }

    pub fn read_library_skill_file(
        &self,
        skill_id: &str,
        relative_path: &str,
    ) -> Result<FileContent, AppError> {
        let skill = self.library_skill(skill_id)?;
        read_skill_file_at(&skill.absolute_path, relative_path)
    }

    pub fn write_library_skill_file(
        &self,
        skill_id: &str,
        relative_path: &str,
        content: &str,
    ) -> Result<(), AppError> {
        let skill = self.library_skill(skill_id)?;
        crate::skill_files::write_skill_file_at(&skill.absolute_path, relative_path, content)
    }

    pub fn export_library_skill_zip(
        &self,
        skill_id: &str,
        dest_path: &Path,
    ) -> Result<(), AppError> {
        let skill = self.library_skill(skill_id)?;
        crate::zip_ops::export_directory_to_zip(&skill.absolute_path, dest_path)
    }

    pub fn export_project_zip(&self, project_id: &str, dest_path: &Path) -> Result<(), AppError> {
        let project = self
            .list_projects()?
            .into_iter()
            .find(|project| project.id == project_id)
            .ok_or_else(|| AppError::ProjectNotFound {
                id: project_id.to_owned(),
            })?;
        crate::zip_ops::export_directory_to_zip(&project.local_path, dest_path)
    }

    pub fn import_skill_zip(&self, zip_path: &Path) -> Result<Project, AppError> {
        let id = Uuid::new_v4().to_string();
        let dest = self.paths.library_projects_dir.join(&id);
        self.paths.assert_allowed(&dest)?;
        crate::zip_ops::import_zip_to_directory(zip_path, &dest)?;
        match self.add_local_project(&dest) {
            Ok(project) => Ok(project),
            Err(error) => {
                let _ = fs::remove_dir_all(&dest);
                Err(error)
            }
        }
    }

    pub(crate) fn mutate_index<T>(
        &self,
        action: impl FnOnce(&mut LibraryIndex) -> Result<T, AppError>,
    ) -> Result<T, AppError> {
        let _guard = lock_app_transaction(&self.paths)?;
        let mut index = self.load_index()?;
        let result = action(&mut index)?;
        self.write_index(&index)?;
        Ok(result)
    }

    fn library_skill(&self, skill_id: &str) -> Result<LibrarySkillSummary, AppError> {
        self.load_index()?
            .library_skills
            .into_iter()
            .find(|skill| skill.id == skill_id)
            .ok_or_else(|| AppError::LibrarySkillNotFound {
                id: skill_id.to_owned(),
            })
    }

    pub(crate) fn load_index(&self) -> Result<LibraryIndex, AppError> {
        read_json_value(
            &self.paths.library_index,
            LibraryIndex::default,
            |message| AppError::LibraryIndex { message },
        )
    }

    pub(crate) fn write_index(&self, index: &LibraryIndex) -> Result<(), AppError> {
        self.paths.assert_allowed(&self.paths.library_index)?;
        fs::create_dir_all(&self.paths.app_data_dir)?;
        write_json_value(&self.paths.library_index, index, |message| {
            AppError::LibraryIndex { message }
        })
    }
}

pub(crate) fn validate_skill_dirname(name: &str) -> Result<String, AppError> {
    let name = name.trim();
    if name.is_empty()
        || name.len() > 64
        || !name
            .chars()
            .all(|ch| ch.is_ascii_alphanumeric() || ch == '-' || ch == '_')
    {
        return Err(AppError::Io {
            message: "Skill 名称仅允许字母、数字、连字符与下划线".into(),
        });
    }
    Ok(name.to_string())
}

pub(crate) fn replace_project_skills(
    index: &mut LibraryIndex,
    project: &Project,
) -> Result<(), AppError> {
    let previous: Vec<LibrarySkillSummary> = index
        .library_skills
        .iter()
        .filter(|skill| skill.project_id == project.id)
        .cloned()
        .collect();
    let scanned = scan_project(project, &previous)?;
    index
        .library_skills
        .retain(|skill| skill.project_id != project.id);
    index.library_skills.extend(scanned);
    Ok(())
}

fn canonical_project_path(path: &Path) -> Result<PathBuf, AppError> {
    let canonical = path
        .canonicalize()
        .map_err(|_| AppError::InvalidProjectPath {
            path: path.display().to_string(),
        })?;
    if !canonical.is_dir() || fs::read_dir(&canonical).is_err() {
        return Err(AppError::InvalidProjectPath {
            path: path.display().to_string(),
        });
    }
    Ok(canonical)
}

pub(crate) fn ensure_project_path_is_new(
    index: &LibraryIndex,
    path: &Path,
) -> Result<(), AppError> {
    if index
        .projects
        .iter()
        .any(|project| project.local_path == path)
    {
        return Err(AppError::ProjectAlreadyExists {
            value: path.display().to_string(),
        });
    }
    Ok(())
}

pub(crate) fn project_for_source(
    source_type: ProjectSourceType,
    local_path: PathBuf,
    remote_url: Option<String>,
) -> Project {
    let identity = remote_url
        .as_deref()
        .map(|url| format!("git:{url}"))
        .unwrap_or_else(|| format!("local:{}", local_path.display()));
    let name = remote_url
        .as_deref()
        .map(project_name_from_git_url)
        .unwrap_or_else(|| {
            local_path
                .file_name()
                .map(|name| name.to_string_lossy().into_owned())
                .unwrap_or_else(|| "project".to_string())
        });
    let last_updated_at = path_modified_at(&local_path).or_else(|| Some(Utc::now()));
    Project {
        id: stable_id(&identity),
        name,
        source_type,
        local_path,
        remote_url,
        added_at: Utc::now(),
        last_updated_at,
        last_synced_at: None,
        warnings: Vec::new(),
    }
}

fn path_modified_at(path: &Path) -> Option<DateTime<Utc>> {
    fs::metadata(path)
        .ok()
        .and_then(|metadata| metadata.modified().ok())
        .map(DateTime::<Utc>::from)
}

fn normalize_projects(projects: &mut [Project]) -> bool {
    let mut dirty = false;
    for project in projects.iter_mut() {
        if let Some(url) = project.remote_url.clone() {
            let name = project_name_from_git_url(&url);
            if project.name != name {
                project.name = name;
                dirty = true;
            }
            if project.last_updated_at.is_none() {
                if let Ok(Some(time)) = latest_commit_time(&project.local_path) {
                    project.last_updated_at = Some(time);
                    dirty = true;
                }
            }
        } else if project.last_updated_at.is_none() {
            if let Some(time) = path_modified_at(&project.local_path) {
                project.last_updated_at = Some(time);
                dirty = true;
            }
        }
    }
    dirty
}

pub(crate) fn scan_project(
    project: &Project,
    previous: &[LibrarySkillSummary],
) -> Result<Vec<LibrarySkillSummary>, AppError> {
    let mut directories = Vec::new();
    collect_skill_directories(&project.local_path, Path::new(""), &mut directories)?;
    directories.sort();
    let id_for = |relative_path: &Path| {
        stable_id(&format!(
            "{}:{}",
            project.id,
            relative_path.to_string_lossy()
        ))
    };
    let (source_repo, source_url) = resolve_project_source(project);
    Ok(directories
        .iter()
        .map(|relative_path| {
            let absolute_path = if relative_path.as_os_str().is_empty() {
                project.local_path.clone()
            } else {
                project.local_path.join(relative_path)
            };
            let metadata = read_skill_metadata(&absolute_path);
            let id = id_for(relative_path);
            let old = previous.iter().find(|skill| skill.id == id);
            let parent_skill_id =
                parent_skill_relative(relative_path, &directories).map(|parent| id_for(&parent));
            LibrarySkillSummary {
                id,
                project_id: project.id.clone(),
                name: metadata.name,
                description: metadata.description,
                relative_path: relative_path.clone(),
                absolute_path,
                parent_skill_id,
                group_id: old.and_then(|skill| skill.group_id.clone()),
                tag_ids: old.map(|skill| skill.tag_ids.clone()).unwrap_or_default(),
                installed_providers: old
                    .map(|skill| skill.installed_providers.clone())
                    .unwrap_or_default(),
                source_repo: source_repo.clone(),
                source_url: source_url.clone(),
                warnings: metadata.warnings,
            }
        })
        .collect())
}

/// 项目级 remote 落到其下每个 skill；无 remote 时尝试读 `.git/config` origin。
fn resolve_project_source(project: &Project) -> (Option<String>, Option<String>) {
    let remote = project
        .remote_url
        .as_deref()
        .map(str::trim)
        .filter(|url| !url.is_empty())
        .map(str::to_owned)
        .or_else(|| read_origin_url(&project.local_path));
    let Some(url) = remote else {
        return (None, None);
    };
    (
        source_repo_from_git_url(&url),
        browse_url_from_git_url(&url),
    )
}

/// Recursively find Skill directories.
/// A directory with `SKILL.md` is a Skill；一般不再下钻，但会继续扫描其子目录
/// `skills/`，以便识别嵌套子 Skill（如 auto-code/skills/foo）。
fn collect_skill_directories(
    absolute: &Path,
    relative: &Path,
    out: &mut Vec<PathBuf>,
) -> Result<(), AppError> {
    if is_skill_directory(absolute) {
        out.push(relative.to_path_buf());
        let nested_skills = absolute.join("skills");
        if is_plain_directory(&nested_skills) {
            let nested_relative = if relative.as_os_str().is_empty() {
                PathBuf::from("skills")
            } else {
                relative.join("skills")
            };
            collect_child_skill_directories(&nested_skills, &nested_relative, out)?;
        }
        return Ok(());
    }

    collect_child_skill_directories(absolute, relative, out)
}

fn collect_child_skill_directories(
    absolute: &Path,
    relative: &Path,
    out: &mut Vec<PathBuf>,
) -> Result<(), AppError> {
    let entries = fs::read_dir(absolute).map_err(|_| AppError::InvalidProjectPath {
        path: absolute.display().to_string(),
    })?;
    for entry in entries {
        let entry = entry?;
        let name = entry.file_name();
        if name.to_string_lossy().starts_with('.') {
            continue;
        }
        let child_absolute = entry.path();
        if !is_plain_directory(&child_absolute) {
            continue;
        }
        let child_relative = if relative.as_os_str().is_empty() {
            PathBuf::from(&name)
        } else {
            relative.join(&name)
        };
        collect_skill_directories(&child_absolute, &child_relative, out)?;
    }
    Ok(())
}

fn is_plain_directory(path: &Path) -> bool {
    fs::symlink_metadata(path)
        .map(|metadata| metadata.is_dir() && !path_is_symlink_link(path))
        .unwrap_or(false)
}

/// 最近一层祖先 Skill 路径（路径前缀最长者）。
fn parent_skill_relative(relative_path: &Path, all: &[PathBuf]) -> Option<PathBuf> {
    all.iter()
        .filter(|candidate| {
            if candidate.as_os_str() == relative_path.as_os_str() {
                return false;
            }
            if candidate.as_os_str().is_empty() {
                return !relative_path.as_os_str().is_empty();
            }
            relative_path.starts_with(candidate)
        })
        .max_by_key(|candidate| candidate.as_os_str().len())
        .cloned()
}

fn is_skill_directory(path: &Path) -> bool {
    crate::skill_detect::dir_has_skill_md(path)
}

fn stable_id(value: &str) -> String {
    Sha256::digest(value.as_bytes())
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect()
}

pub(crate) fn safe_skill_target(root: &Path, name: &str) -> Result<PathBuf, AppError> {
    let path = Path::new(name);
    let mut components = path.components();
    let valid = matches!(components.next(), Some(std::path::Component::Normal(_)))
        && components.next().is_none();
    if !valid {
        return Err(AppError::PathOutsideManagedRoots {
            path: root.join(path).display().to_string(),
        });
    }
    Ok(root.join(path))
}

pub(crate) fn create_directory_symlink(source: &Path, target: &Path) -> Result<(), AppError> {
    create_directory_link(source, target)
}

/// 发现各 provider 根下已指向库 Skill 的符号链接，回填到 installations。
pub(crate) fn adopt_existing_installations(index: &mut LibraryIndex, paths: &AppPaths) {
    let sources = index
        .library_skills
        .iter()
        .filter_map(|skill| {
            skill
                .absolute_path
                .canonicalize()
                .ok()
                .map(|source| (source, skill.id.clone()))
        })
        .collect::<Vec<_>>();
    if sources.is_empty() {
        return;
    }

    for provider in [Provider::Cursor, Provider::Claude, Provider::Codex] {
        let Ok(root) = paths.provider_root(provider) else {
            continue;
        };
        let Ok(entries) = fs::read_dir(root) else {
            continue;
        };
        for entry in entries.flatten() {
            let target_path = entry.path();
            if !path_is_symlink_link(&target_path) {
                continue;
            }
            let Ok(resolved) = target_path.canonicalize() else {
                continue;
            };
            let Some((_, skill_id)) = sources
                .iter()
                .find(|(source, _)| crate::path_norm::paths_eq(source, &resolved))
            else {
                continue;
            };
            let already = index.installations.iter().any(|installation| {
                installation.library_skill_id == *skill_id && installation.provider == provider
            });
            if already {
                continue;
            }
            index.installations.push(SkillInstallation {
                library_skill_id: skill_id.clone(),
                provider,
                source_path: resolved,
                target_path,
                installed_at: Utc::now(),
            });
        }
    }
}

pub(crate) fn prune_missing_installations(index: &mut LibraryIndex) {
    index
        .installations
        .retain(|installation| path_is_symlink_link(&installation.target_path));
}

pub(crate) fn sync_installation_statuses(index: &mut LibraryIndex) {
    for skill in &mut index.library_skills {
        skill.installed_providers = index
            .installations
            .iter()
            .filter(|installation| installation.library_skill_id == skill.id)
            .map(|installation| installation.provider)
            .collect();
        skill
            .installed_providers
            .sort_by_key(|provider| provider_order(*provider));
        skill.installed_providers.dedup();
    }
}

pub(crate) fn provider_order(provider: Provider) -> u8 {
    match provider {
        Provider::Cursor => 0,
        Provider::Claude => 1,
        Provider::Codex => 2,
    }
}

fn project_position(index: &LibraryIndex, id: &str) -> Result<usize, AppError> {
    index
        .projects
        .iter()
        .position(|project| project.id == id)
        .ok_or_else(|| AppError::ProjectNotFound { id: id.to_owned() })
}

fn project_skills(index: &LibraryIndex, project_id: &str) -> Vec<LibrarySkillSummary> {
    index
        .library_skills
        .iter()
        .filter(|skill| skill.project_id == project_id)
        .cloned()
        .collect()
}

pub(crate) fn find_skill_mut<'a>(
    index: &'a mut LibraryIndex,
    skill_id: &str,
) -> Result<&'a mut LibrarySkillSummary, AppError> {
    index
        .library_skills
        .iter_mut()
        .find(|skill| skill.id == skill_id)
        .ok_or_else(|| AppError::LibrarySkillNotFound {
            id: skill_id.to_owned(),
        })
}

pub(crate) fn ensure_unique_name<T>(
    values: &[T],
    name: &str,
    excluded_id: Option<&str>,
    kind: &'static str,
    fields: impl Fn(&T) -> (&String, &String),
) -> Result<(), AppError> {
    if values.iter().any(|value| {
        let (id, existing_name) = fields(value);
        excluded_id != Some(id.as_str()) && existing_name.eq_ignore_ascii_case(name)
    }) {
        return Err(AppError::TaxonomyNameConflict {
            kind,
            name: name.to_owned(),
        });
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use std::fs;

    use tempfile::tempdir;

    use super::{create_directory_symlink, LibraryRepository};
    use crate::error::AppError;
    use crate::model::{InstallHealthKind, ProjectSourceType, Provider};
    use crate::paths::AppPaths;

    fn write_skill(path: &std::path::Path, name: &str) {
        fs::create_dir_all(path).unwrap();
        fs::write(
            path.join("SKILL.md"),
            format!("---\nname: {name}\ndescription: {name} 描述\n---\n正文"),
        )
        .unwrap();
    }

    #[test]
    fn skills_inherit_source_repo_from_git_config_origin() {
        let base = tempdir().unwrap();
        let source = tempdir().unwrap();
        write_skill(&source.path().join("ask-matt"), "ask-matt");
        let git = source.path().join(".git");
        fs::create_dir_all(&git).unwrap();
        fs::write(
            git.join("config"),
            "[remote \"origin\"]\n\turl = https://github.com/acme/ask-matt.git\n",
        )
        .unwrap();
        let paths = AppPaths::for_test(base.path());
        let repository = LibraryRepository::new(paths);
        repository.add_local_project(source.path()).unwrap();
        let skills = repository.list_library_skills().unwrap();
        assert_eq!(skills.len(), 1);
        assert_eq!(skills[0].source_repo.as_deref(), Some("acme/ask-matt"));
        assert_eq!(
            skills[0].source_url.as_deref(),
            Some("https://github.com/acme/ask-matt")
        );
    }

    #[test]
    fn local_project_deep_scans_nested_skill_directories() {
        let base = tempdir().unwrap();
        let source = tempdir().unwrap();
        write_skill(&source.path().join("alpha"), "Alpha");
        fs::create_dir_all(source.path().join("ordinary")).unwrap();
        fs::write(source.path().join("plain.txt"), "ignored").unwrap();
        write_skill(&source.path().join(".hidden"), "Hidden");
        write_skill(&source.path().join("nested/deep"), "Deep");
        write_skill(&source.path().join("skills/group/gamma"), "Gamma");
        // Nested SKILL.md inside an existing skill package (非 skills/) must not create another skill.
        write_skill(&source.path().join("alpha/references/inner"), "Inner");
        let paths = AppPaths::for_test(base.path());
        let repository = LibraryRepository::new(paths);

        let project = repository.add_local_project(source.path()).unwrap();
        let skills = repository.list_library_skills().unwrap();
        let names: Vec<_> = skills.iter().map(|skill| skill.name.as_str()).collect();

        assert_eq!(project.source_type, ProjectSourceType::Local);
        assert_eq!(project.local_path, source.path().canonicalize().unwrap());
        assert_eq!(skills.len(), 3);
        assert!(names.contains(&"Alpha"));
        assert!(names.contains(&"Deep"));
        assert!(names.contains(&"Gamma"));
        assert!(!names.contains(&"Hidden"));
        assert!(!names.contains(&"Inner"));
        assert!(skills
            .iter()
            .any(|skill| skill.relative_path == std::path::PathBuf::from("nested/deep")));
        assert!(skills.iter().any(|skill| {
            skill.relative_path == std::path::PathBuf::from("skills/group/gamma")
        }));
    }

    #[test]
    fn skill_package_skills_directory_is_scanned_as_sub_skills() {
        let base = tempdir().unwrap();
        let source = tempdir().unwrap();
        write_skill(&source.path().join("auto-code-codex"), "auto-code-codex");
        write_skill(
            &source
                .path()
                .join("auto-code-codex/skills/adversarial-design-review"),
            "adversarial-design-review",
        );
        write_skill(
            &source
                .path()
                .join("auto-code-codex/skills/atom-controller-gen"),
            "atom-controller-gen",
        );
        // Still ignore nested packages outside the conventional skills/ folder.
        write_skill(
            &source.path().join("auto-code-codex/agents/inner"),
            "inner-agent",
        );
        let repository = LibraryRepository::new(AppPaths::for_test(base.path()));

        repository.add_local_project(source.path()).unwrap();
        let skills = repository.list_library_skills().unwrap();

        assert_eq!(skills.len(), 3);
        let parent = skills
            .iter()
            .find(|skill| skill.name == "auto-code-codex")
            .unwrap();
        assert!(parent.parent_skill_id.is_none());
        let children: Vec<_> = skills
            .iter()
            .filter(|skill| skill.parent_skill_id.as_deref() == Some(parent.id.as_str()))
            .map(|skill| skill.name.as_str())
            .collect();
        assert!(children.contains(&"adversarial-design-review"));
        assert!(children.contains(&"atom-controller-gen"));
        assert!(!skills.iter().any(|skill| skill.name == "inner-agent"));
    }

    #[test]
    fn project_root_with_skill_md_is_a_single_skill() {
        let base = tempdir().unwrap();
        let source = tempdir().unwrap();
        write_skill(source.path(), "Root Skill");
        write_skill(&source.path().join("child"), "Child");
        let repository = LibraryRepository::new(AppPaths::for_test(base.path()));

        repository.add_local_project(source.path()).unwrap();
        let skills = repository.list_library_skills().unwrap();

        assert_eq!(skills.len(), 1);
        assert_eq!(skills[0].name, "Root Skill");
        assert!(skills[0].relative_path.as_os_str().is_empty());
    }

    #[test]
    fn library_skill_tree_and_preview_are_scoped_to_skill_directory() {
        let base = tempdir().unwrap();
        let source = tempdir().unwrap();
        write_skill(&source.path().join("alpha"), "Alpha");
        fs::create_dir_all(source.path().join("alpha/references")).unwrap();
        fs::write(
            source.path().join("alpha/references/example.txt"),
            "example",
        )
        .unwrap();
        fs::write(source.path().join("secret.txt"), "secret").unwrap();
        let repository = LibraryRepository::new(AppPaths::for_test(base.path()));
        repository.add_local_project(source.path()).unwrap();
        let skill_id = repository.list_library_skills().unwrap()[0].id.clone();

        let tree = repository.list_library_skill_tree(&skill_id).unwrap();
        let preview = repository
            .read_library_skill_file(&skill_id, "references/example.txt")
            .unwrap();

        assert!(tree.iter().any(|node| node.name == "SKILL.md"));
        assert_eq!(preview.content.as_deref(), Some("example"));
        assert!(matches!(
            repository.read_library_skill_file(&skill_id, "../secret.txt"),
            Err(AppError::PathOutsideManagedRoots { .. })
        ));
    }

    #[test]
    fn tags_and_group_persist_and_deletion_only_clears_references() {
        let base = tempdir().unwrap();
        let source = tempdir().unwrap();
        write_skill(&source.path().join("alpha"), "Alpha");
        let paths = AppPaths::for_test(base.path());
        let repository = LibraryRepository::new(paths.clone());
        repository.add_local_project(source.path()).unwrap();
        let skill_id = repository.list_library_skills().unwrap()[0].id.clone();
        let tag_a = repository.create_tag("后端".into(), None).unwrap();
        let tag_b = repository
            .create_tag("常用".into(), Some("#fff".into()))
            .unwrap();
        let group = repository
            .create_group("开发".into(), Some("#007AFF".into()))
            .unwrap();
        assert_eq!(group.order, 0);
        let next_group = repository.create_group("运维".into(), None).unwrap();
        assert_eq!(next_group.order, 1);

        repository
            .set_skill_tags(&skill_id, vec![tag_a.id.clone(), tag_b.id.clone()])
            .unwrap();
        repository
            .set_skill_group(&skill_id, Some(group.id.clone()))
            .unwrap();
        let reopened = LibraryRepository::new(paths);
        let assigned = reopened.list_library_skills().unwrap()[0].clone();
        assert_eq!(assigned.tag_ids.len(), 2);
        assert_eq!(assigned.group_id.as_deref(), Some(group.id.as_str()));

        reopened.delete_tag(&tag_a.id).unwrap();
        reopened.delete_group(&group.id).unwrap();
        let cleared = reopened.list_library_skills().unwrap()[0].clone();
        assert_eq!(cleared.tag_ids, vec![tag_b.id]);
        assert_eq!(cleared.group_id, None);
        assert!(source.path().join("alpha/SKILL.md").exists());
    }

    #[test]
    fn removing_local_project_never_deletes_source_directory() {
        let base = tempdir().unwrap();
        let source = tempdir().unwrap();
        write_skill(&source.path().join("alpha"), "Alpha");
        let repository = LibraryRepository::new(AppPaths::for_test(base.path()));
        let project = repository.add_local_project(source.path()).unwrap();

        repository.remove_project(&project.id).unwrap();

        assert!(source.path().join("alpha/SKILL.md").exists());
        assert!(repository.list_projects().unwrap().is_empty());
        assert!(repository.list_library_skills().unwrap().is_empty());
    }

    #[test]
    fn malformed_frontmatter_keeps_skill_with_chinese_warning() {
        let base = tempdir().unwrap();
        let source = tempdir().unwrap();
        let skill = source.path().join("broken");
        fs::create_dir_all(&skill).unwrap();
        fs::write(skill.join("SKILL.md"), "---\nname: [broken\n---\n").unwrap();
        let repository = LibraryRepository::new(AppPaths::for_test(base.path()));

        repository.add_local_project(source.path()).unwrap();
        let skills = repository.list_library_skills().unwrap();

        assert_eq!(skills.len(), 1);
        assert!(skills[0]
            .warnings
            .iter()
            .any(|warning| warning.contains("YAML 格式错误")));
    }

    #[cfg(unix)]
    #[test]
    fn list_adopts_existing_provider_symlinks_into_installations() {
        let base = tempdir().unwrap();
        let source = tempdir().unwrap();
        write_skill(&source.path().join("alpha"), "Alpha");
        let paths = AppPaths::for_test(base.path());
        let repository = LibraryRepository::new(paths.clone());
        repository.add_local_project(source.path()).unwrap();
        let skill = repository.list_library_skills().unwrap()[0].clone();
        let claude_root = paths.provider_root(Provider::Claude).unwrap();
        fs::create_dir_all(claude_root).unwrap();
        // 链接名与 frontmatter name 不同，仍应按解析目标认领
        let link = claude_root.join("alpha-link");
        std::os::unix::fs::symlink(&skill.absolute_path, &link).unwrap();

        let skills = repository.list_library_skills().unwrap();
        let adopted = skills.iter().find(|item| item.id == skill.id).unwrap();

        assert_eq!(adopted.installed_providers, vec![Provider::Claude]);
        let installations = repository.list_installations().unwrap();
        assert_eq!(installations.len(), 1);
        assert_eq!(installations[0].library_skill_id, skill.id);
        assert_eq!(installations[0].provider, Provider::Claude);
        assert_eq!(installations[0].target_path, link);
    }

    #[cfg(unix)]
    #[test]
    fn install_creates_symlink_and_persists_status() {
        let base = tempdir().unwrap();
        let source = tempdir().unwrap();
        write_skill(&source.path().join("alpha"), "Alpha");
        let paths = AppPaths::for_test(base.path());
        let repository = LibraryRepository::new(paths.clone());
        repository.add_local_project(source.path()).unwrap();
        let skill_id = repository.list_library_skills().unwrap()[0].id.clone();

        let installation = repository
            .install_skill(&skill_id, Provider::Cursor)
            .unwrap();

        assert!(installation.target_path.is_symlink());
        assert_eq!(
            fs::read_link(&installation.target_path).unwrap(),
            source.path().join("alpha").canonicalize().unwrap()
        );
        assert_eq!(repository.list_installations().unwrap(), vec![installation]);
        assert_eq!(
            repository.list_library_skills().unwrap()[0].installed_providers,
            vec![Provider::Cursor]
        );
        assert!(paths.library_index.exists());
    }

    #[cfg(unix)]
    #[test]
    fn install_updates_only_a_managed_symlink() {
        let base = tempdir().unwrap();
        let source = tempdir().unwrap();
        write_skill(&source.path().join("alpha"), "Alpha");
        let paths = AppPaths::for_test(base.path());
        let repository = LibraryRepository::new(paths);
        repository.add_local_project(source.path()).unwrap();
        let skill_id = repository.list_library_skills().unwrap()[0].id.clone();
        let original = repository
            .install_skill(&skill_id, Provider::Cursor)
            .unwrap();
        fs::remove_file(&original.target_path).unwrap();
        std::os::unix::fs::symlink(source.path(), &original.target_path).unwrap();

        repository
            .install_skill(&skill_id, Provider::Cursor)
            .unwrap();

        assert_eq!(
            fs::read_link(&original.target_path).unwrap(),
            source.path().join("alpha").canonicalize().unwrap()
        );
    }

    #[cfg(unix)]
    #[test]
    fn install_moves_matching_link_when_provider_root_changes() {
        let base = tempdir().unwrap();
        let source = tempdir().unwrap();
        write_skill(&source.path().join("alpha"), "Alpha");
        let paths = AppPaths::for_test(base.path());
        let repository = LibraryRepository::new(paths.clone());
        repository.add_local_project(source.path()).unwrap();
        let skill_id = repository.list_library_skills().unwrap()[0].id.clone();
        let old = repository
            .install_skill(&skill_id, Provider::Cursor)
            .unwrap();

        let mut moved_paths = paths;
        let new_root = base.path().join("new-cursor-root");
        moved_paths
            .skill_roots
            .iter_mut()
            .find(|root| root.provider == Provider::Cursor)
            .unwrap()
            .path = new_root.clone();
        let moved_repository = LibraryRepository::new(moved_paths);
        let moved = moved_repository
            .install_skill(&skill_id, Provider::Cursor)
            .unwrap();

        assert_eq!(moved.target_path, new_root.join("Alpha"));
        assert!(crate::fs_ops::path_is_symlink_link(&moved.target_path));
        assert!(fs::symlink_metadata(old.target_path).is_err());
        moved_repository
            .uninstall_skill(&skill_id, Provider::Cursor)
            .unwrap();
        assert!(fs::symlink_metadata(moved.target_path).is_err());
    }

    #[cfg(unix)]
    #[test]
    fn install_root_change_rejects_mismatched_old_link() {
        let base = tempdir().unwrap();
        let source = tempdir().unwrap();
        let other = tempdir().unwrap();
        write_skill(&source.path().join("alpha"), "Alpha");
        write_skill(&other.path().join("other"), "Other");
        let paths = AppPaths::for_test(base.path());
        let repository = LibraryRepository::new(paths.clone());
        repository.add_local_project(source.path()).unwrap();
        let skill_id = repository.list_library_skills().unwrap()[0].id.clone();
        let old = repository
            .install_skill(&skill_id, Provider::Cursor)
            .unwrap();
        fs::remove_file(&old.target_path).unwrap();
        std::os::unix::fs::symlink(other.path().join("other"), &old.target_path).unwrap();

        let mut moved_paths = paths;
        let new_root = base.path().join("new-cursor-root");
        moved_paths
            .skill_roots
            .iter_mut()
            .find(|root| root.provider == Provider::Cursor)
            .unwrap()
            .path = new_root.clone();
        let moved_repository = LibraryRepository::new(moved_paths);

        assert!(matches!(
            moved_repository.install_skill(&skill_id, Provider::Cursor),
            Err(AppError::TargetConflict { .. })
        ));
        assert!(crate::fs_ops::path_is_symlink_link(&old.target_path));
        assert!(!new_root.join("Alpha").exists());
    }

    #[cfg(unix)]
    #[test]
    fn install_root_change_index_failure_restores_old_link() {
        let base = tempdir().unwrap();
        let source = tempdir().unwrap();
        write_skill(&source.path().join("alpha"), "Alpha");
        let paths = AppPaths::for_test(base.path());
        let repository = LibraryRepository::new(paths.clone());
        repository.add_local_project(source.path()).unwrap();
        let skill_id = repository.list_library_skills().unwrap()[0].id.clone();
        let old = repository
            .install_skill(&skill_id, Provider::Cursor)
            .unwrap();

        let mut moved_paths = paths;
        let new_root = base.path().join("new-cursor-root");
        moved_paths
            .skill_roots
            .iter_mut()
            .find(|root| root.provider == Provider::Cursor)
            .unwrap()
            .path = new_root.clone();
        let moved_repository = LibraryRepository::new(moved_paths);

        let error = moved_repository
            .install_skill_with_writer(&skill_id, Provider::Cursor, |_| {
                Err(AppError::Io {
                    message: "injected install index failure".into(),
                })
            })
            .unwrap_err();

        assert!(error.to_string().contains("injected install index failure"));
        assert!(crate::fs_ops::path_is_symlink_link(&old.target_path));
        assert_eq!(
            old.target_path.canonicalize().unwrap(),
            source.path().join("alpha").canonicalize().unwrap()
        );
        assert!(fs::symlink_metadata(new_root.join("Alpha")).is_err());
    }

    #[cfg(unix)]
    #[test]
    fn install_rejects_real_directory_conflict() {
        let base = tempdir().unwrap();
        let source = tempdir().unwrap();
        write_skill(&source.path().join("alpha"), "Alpha");
        let paths = AppPaths::for_test(base.path());
        let repository = LibraryRepository::new(paths.clone());
        repository.add_local_project(source.path()).unwrap();
        let skill_id = repository.list_library_skills().unwrap()[0].id.clone();
        let target = paths.provider_root(Provider::Cursor).unwrap().join("Alpha");
        fs::create_dir_all(&target).unwrap();

        assert!(matches!(
            repository.install_skill(&skill_id, Provider::Cursor),
            Err(AppError::TargetConflict { .. })
        ));
    }

    #[cfg(unix)]
    #[test]
    fn install_takes_over_same_name_historical_symlink() {
        let base = tempdir().unwrap();
        let source = tempdir().unwrap();
        let historical = tempdir().unwrap();
        write_skill(&source.path().join("grill-me"), "grill-me");
        write_skill(&historical.path().join("grill-me"), "grill-me");
        let paths = AppPaths::for_test(base.path());
        let repository = LibraryRepository::new(paths.clone());
        repository.add_local_project(source.path()).unwrap();
        let skill = repository.list_library_skills().unwrap()[0].clone();
        let target = paths
            .provider_root(Provider::Claude)
            .unwrap()
            .join("grill-me");
        fs::create_dir_all(target.parent().unwrap()).unwrap();
        // 模拟 cc-switch 等历史工具留下的同名外链
        std::os::unix::fs::symlink(historical.path().join("grill-me"), &target).unwrap();

        let installation = repository
            .install_skill(&skill.id, Provider::Claude)
            .unwrap();

        assert_eq!(
            fs::read_link(&installation.target_path).unwrap(),
            skill.absolute_path.canonicalize().unwrap()
        );
        assert_eq!(
            repository.list_library_skills().unwrap()[0].installed_providers,
            vec![Provider::Claude]
        );
    }

    #[cfg(unix)]
    #[test]
    fn install_rejects_unmanaged_symlink_with_different_skill_name() {
        let base = tempdir().unwrap();
        let source = tempdir().unwrap();
        let other = tempdir().unwrap();
        write_skill(&source.path().join("alpha"), "Alpha");
        write_skill(&other.path().join("beta"), "Beta");
        let paths = AppPaths::for_test(base.path());
        let repository = LibraryRepository::new(paths.clone());
        repository.add_local_project(source.path()).unwrap();
        let skill_id = repository.list_library_skills().unwrap()[0].id.clone();
        let target = paths.provider_root(Provider::Cursor).unwrap().join("Alpha");
        fs::create_dir_all(target.parent().unwrap()).unwrap();
        std::os::unix::fs::symlink(other.path().join("beta"), &target).unwrap();

        assert!(matches!(
            repository.install_skill(&skill_id, Provider::Cursor),
            Err(AppError::TargetConflict { .. })
        ));
    }

    #[cfg(unix)]
    #[test]
    fn uninstall_deletes_only_managed_symlink() {
        let base = tempdir().unwrap();
        let source = tempdir().unwrap();
        write_skill(&source.path().join("alpha"), "Alpha");
        let paths = AppPaths::for_test(base.path());
        let repository = LibraryRepository::new(paths.clone());
        repository.add_local_project(source.path()).unwrap();
        let skill_id = repository.list_library_skills().unwrap()[0].id.clone();
        let installation = repository
            .install_skill(&skill_id, Provider::Claude)
            .unwrap();

        repository
            .uninstall_skill(&skill_id, Provider::Claude)
            .unwrap();

        assert!(fs::symlink_metadata(&installation.target_path).is_err());
        assert!(repository.list_installations().unwrap().is_empty());
        assert!(repository.list_library_skills().unwrap()[0]
            .installed_providers
            .is_empty());

        fs::create_dir_all(&installation.target_path).unwrap();
        assert!(matches!(
            repository.uninstall_skill(&skill_id, Provider::Claude),
            Err(AppError::TargetConflict { .. })
        ));
        assert!(installation.target_path.is_dir());
    }

    #[cfg(windows)]
    #[test]
    fn uninstall_removes_directory_symlink_on_windows() {
        let base = tempdir().unwrap();
        let source = tempdir().unwrap();
        write_skill(&source.path().join("alpha"), "Alpha");
        let paths = AppPaths::for_test(base.path());
        let repository = LibraryRepository::new(paths);
        repository.add_local_project(source.path()).unwrap();
        let skill_id = repository.list_library_skills().unwrap()[0].id.clone();
        let installation = match repository.install_skill(&skill_id, Provider::Claude) {
            Ok(installation) => installation,
            Err(error) => {
                let message = error.to_string();
                if message.contains("特权")
                    || message.contains("privilege")
                    || message.contains("os error 1314")
                {
                    eprintln!("skip: creating directory symlink requires privilege: {message}");
                    return;
                }
                panic!("install_skill failed: {message}");
            }
        };
        let source_marker = installation.source_path.join("SKILL.md");
        assert!(source_marker.is_file());

        repository
            .uninstall_skill(&skill_id, Provider::Claude)
            .unwrap();

        assert!(fs::symlink_metadata(&installation.target_path).is_err());
        assert!(source_marker.is_file(), "卸载不得删除库内目标文件");
        assert!(repository.list_installations().unwrap().is_empty());
    }

    #[test]
    fn install_rejects_skill_name_that_escapes_provider_root() {
        let base = tempdir().unwrap();
        let source = tempdir().unwrap();
        write_skill(&source.path().join("escape"), "../escape");
        let repository = LibraryRepository::new(AppPaths::for_test(base.path()));
        repository.add_local_project(source.path()).unwrap();
        let skill_id = repository.list_library_skills().unwrap()[0].id.clone();

        assert!(matches!(
            repository.install_skill(&skill_id, Provider::Codex),
            Err(AppError::PathOutsideManagedRoots { .. })
        ));
    }

    #[test]
    fn scan_install_health_detects_missing_target_and_repair_trims_index() {
        use crate::model::SkillInstallation;
        use chrono::Utc;

        let base = tempdir().unwrap();
        let source = tempdir().unwrap();
        write_skill(&source.path().join("alpha"), "Alpha");
        let paths = AppPaths::for_test(base.path());
        let repository = LibraryRepository::new(paths.clone());
        repository.add_local_project(source.path()).unwrap();
        let skill_id = repository.list_library_skills().unwrap()[0].id.clone();
        let missing_target = paths.provider_root(Provider::Cursor).unwrap().join("Alpha");
        fs::create_dir_all(missing_target.parent().unwrap()).unwrap();

        let mut index = repository.load_index().unwrap();
        index.installations.push(SkillInstallation {
            library_skill_id: skill_id,
            provider: Provider::Cursor,
            source_path: source.path().join("alpha"),
            target_path: missing_target.clone(),
            installed_at: Utc::now(),
        });
        repository.write_index(&index).unwrap();

        let report = repository.scan_install_health().unwrap();
        assert!(report
            .issues
            .iter()
            .any(|issue| { issue.kind == InstallHealthKind::MissingTarget && issue.repairable }));

        let repaired = repository.repair_installations().unwrap();
        assert!(repaired.repaired >= 1);
        assert!(repository.list_installations().unwrap().is_empty());
        assert!(!missing_target.exists());
    }

    #[test]
    fn migrate_provider_skill_copies_into_library_without_overwrite() {
        let base = tempdir().unwrap();
        let paths = AppPaths::for_test(base.path());
        let cursor_root = paths.provider_root(Provider::Cursor).unwrap().to_path_buf();
        let skill_dir = cursor_root.join("local-skill");
        write_skill(&skill_dir, "local-skill");
        let repository = LibraryRepository::new(paths);

        let result = repository
            .migrate_provider_skill("local-skill", Provider::Cursor, &skill_dir, false)
            .unwrap();

        assert!(!result.replaced_with_link);
        assert!(skill_dir.join("SKILL.md").is_file());
        let skills = repository.list_library_skills().unwrap();
        assert!(skills
            .iter()
            .any(|skill| skill.id == result.library_skill_id));
        assert!(skills
            .iter()
            .any(|skill| skill.name == "local-skill" && skill.absolute_path.is_dir()));
    }

    #[test]
    fn migrate_provider_skill_replace_aborts_on_real_directory_conflict() {
        let base = tempdir().unwrap();
        let paths = AppPaths::for_test(base.path());
        let cursor_root = paths.provider_root(Provider::Cursor).unwrap().to_path_buf();
        let source = cursor_root.join("to-migrate");
        write_skill(&source, "to-migrate");
        // Conflict at a different target name path shouldn't apply; force conflict by
        // creating a sibling that would collide only if names differ. Here we migrate
        // then try replace when target already exists as real dir under another path —
        // use replace=true while leaving an extra real dir at the same target after copy
        // by renaming: first migrate without replace, recreate source, then place a
        // blocker at target and ask replace from a different source name.
        let blocker = cursor_root.join("blocked");
        write_skill(&blocker, "blocked");
        let repository = LibraryRepository::new(paths);

        // replace_with_link on a path that already exists as real dir (same path) removes it;
        // for conflict, create a different source and ensure target path already occupied.
        let other = cursor_root.join("blocked-copy");
        write_skill(&other, "blocked");
        let err = repository
            .migrate_provider_skill("blocked", Provider::Cursor, &other, true)
            .unwrap_err();
        assert!(matches!(err, AppError::TargetConflict { .. }));
        assert!(other.is_dir());
        assert!(blocker.is_dir());
    }

    #[test]
    fn migrate_provider_skill_rejects_source_from_other_provider_root() {
        let base = tempdir().unwrap();
        let paths = AppPaths::for_test(base.path());
        let source = paths
            .provider_root(Provider::Claude)
            .unwrap()
            .join("wrong-root");
        write_skill(&source, "wrong-root");
        let repository = LibraryRepository::new(paths);

        let error = repository
            .migrate_provider_skill("wrong-root", Provider::Cursor, &source, false)
            .unwrap_err();

        assert!(matches!(error, AppError::PathOutsideManagedRoots { .. }));
        assert!(source.join("SKILL.md").is_file());
        assert!(repository.list_library_skills().unwrap().is_empty());
    }

    #[cfg(unix)]
    #[test]
    fn migrate_provider_skill_boundary_allows_then_rejects_source_symlink() {
        let base = tempdir().unwrap();
        let outside = tempdir().unwrap();
        let paths = AppPaths::for_test(base.path());
        write_skill(&outside.path().join("linked"), "linked");
        let source = paths
            .provider_root(Provider::Cursor)
            .unwrap()
            .join("linked");
        fs::create_dir_all(source.parent().unwrap()).unwrap();
        std::os::unix::fs::symlink(outside.path().join("linked"), &source).unwrap();
        let repository = LibraryRepository::new(paths);

        let error = repository
            .migrate_provider_skill("linked", Provider::Cursor, &source, false)
            .unwrap_err();

        assert!(error.to_string().contains("符号链接"));
        assert!(crate::fs_ops::path_is_symlink_link(&source));
        assert!(repository.list_library_skills().unwrap().is_empty());
    }

    #[cfg(unix)]
    #[test]
    fn migrate_replace_index_failure_restores_source_and_removes_copy_and_link() {
        let base = tempdir().unwrap();
        let paths = AppPaths::for_test(base.path());
        let source = paths
            .provider_root(Provider::Cursor)
            .unwrap()
            .join("rollback");
        write_skill(&source, "rollback");
        let repository = LibraryRepository::new(paths.clone());

        let error = repository
            .migrate_provider_skill_with_hooks(
                "rollback",
                Provider::Cursor,
                &source,
                true,
                create_directory_symlink,
                |_| {
                    Err(AppError::Io {
                        message: "injected index failure".into(),
                    })
                },
            )
            .unwrap_err();

        assert!(error.to_string().contains("injected index failure"));
        assert!(source.is_dir());
        assert!(!crate::fs_ops::path_is_symlink_link(&source));
        assert!(source.join("SKILL.md").is_file());
        assert!(repository.list_library_skills().unwrap().is_empty());
        let project_count = fs::read_dir(&paths.library_projects_dir)
            .map(|entries| entries.count())
            .unwrap_or(0);
        assert_eq!(project_count, 0);
    }
}
