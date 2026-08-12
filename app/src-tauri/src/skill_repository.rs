use std::fs;
use std::path::Path;

use chrono::Utc;
use serde::Deserialize;
use sha2::{Digest, Sha256};
use uuid::Uuid;
use walkdir::WalkDir;

use crate::error::AppError;
use crate::fs_ops::{
    copy_directory, path_is_symlink_link, rename_directory_no_replace, verify_directory_copy,
};
use crate::json_store::{read_json, write_json};
use crate::model::{
    PauseRecord, Provider, ScanResult, SkillDetail, SkillProviderInstall, SkillStatus, SkillSummary,
};
use crate::paths::AppPaths;
use crate::transaction_lock::lock_app_transaction;

pub struct SkillRepository {
    paths: AppPaths,
}

impl SkillRepository {
    pub fn new(paths: AppPaths) -> Self {
        Self { paths }
    }

    pub fn set_paths(&mut self, paths: AppPaths) {
        self.paths = paths;
    }

    pub fn paths(&self) -> &AppPaths {
        &self.paths
    }

    pub fn scan(&self) -> Result<Vec<SkillSummary>, AppError> {
        // 内部操作（暂停/详情/备份）需要未去重的完整安装列表
        Ok(self.collect_skills()?.skills)
    }

    pub fn scan_with_warnings(&self) -> Result<ScanResult, AppError> {
        let mut result = self.collect_skills()?;
        result.skills = merge_skills_by_canonical_path(result.skills);
        Ok(result)
    }

    fn collect_skills(&self) -> Result<ScanResult, AppError> {
        let mut skills = Vec::new();
        let mut warnings = Vec::new();

        for root in &self.paths.skill_roots {
            if let Err(error) = self.paths.assert_allowed(&root.path) {
                isolate_root_error(&root.path, &error);
                warnings.push(format!(
                    "无法扫描 Skill 根目录 {}：{error}",
                    root.path.display()
                ));
                continue;
            }
            let Some(entries) = read_root_entries_or_isolate(&root.path, &mut warnings) else {
                continue;
            };

            for entry_result in entries {
                let entry = match entry_result {
                    Ok(entry) => entry,
                    Err(error) => {
                        isolate_unattributed_entry_error(&root.path, &error);
                        continue;
                    }
                };
                let skill_path = entry.path();
                // symlink / junction（Windows）统一按安装链接处理
                if path_is_symlink_link(&skill_path) {
                    if skill_path.parent() != Some(root.path.as_path()) {
                        continue;
                    }
                    if is_skill_directory(&skill_path) {
                        skills.push(read_summary(root.provider, &skill_path));
                    }
                    continue;
                }
                match entry.file_type() {
                    Ok(file_type) if file_type.is_dir() && is_skill_directory(&skill_path) => {
                        if let Err(error) = self.paths.assert_allowed(&skill_path) {
                            reject_unsafe_skill_path(&skill_path, &error);
                            continue;
                        }
                        skills.push(read_summary(root.provider, &skill_path));
                    }
                    Ok(_) => {}
                    Err(error) => {
                        if let Ok(_metadata) = fs::symlink_metadata(&skill_path) {
                            if path_is_symlink_link(&skill_path) {
                                if skill_path.parent() == Some(root.path.as_path())
                                    && is_skill_directory(&skill_path)
                                {
                                    let mut summary = read_summary(root.provider, &skill_path);
                                    summary.warnings.push(format!(
                                        "无法读取条目类型：{error}"
                                    ));
                                    skills.push(summary);
                                }
                                continue;
                            }
                        }
                        if let Err(allowed_error) = self.paths.assert_allowed(&skill_path) {
                            reject_unsafe_skill_path(&skill_path, &allowed_error);
                            continue;
                        }
                        if let Some(summary) = recover_summary_after_file_type_error(
                            root.provider,
                            &skill_path,
                            error.to_string(),
                            entry
                                .metadata()
                                .map(|metadata| metadata.is_dir())
                                .map_err(|metadata_error| metadata_error.to_string()),
                        ) {
                            skills.push(summary);
                        }
                    }
                }
            }
        }

        for record in self.load_pause_records()? {
            let provider_root = match self.paths.provider_root(record.provider) {
                Ok(root) => root.to_path_buf(),
                Err(error) => {
                    warnings.push(format!("已忽略无效暂停记录 {}：{error}", record.skill_id));
                    continue;
                }
            };
            let disabled_provider_root = self
                .paths
                .disabled_dir
                .join(provider_directory(record.provider));
            if let Err(error) = self
                .paths
                .assert_within(&record.original_path, &provider_root)
            {
                warnings.push(format!(
                    "已忽略无效暂停记录 {}：原路径不在对应来源根目录内（{error}）",
                    record.skill_id
                ));
                continue;
            }
            if let Err(error) = self
                .paths
                .assert_within(&record.paused_path, &disabled_provider_root)
            {
                warnings.push(format!(
                    "已忽略无效暂停记录 {}：暂停路径不在对应停用目录内（{error}）",
                    record.skill_id
                ));
                continue;
            }
            if record.paused_path.exists() {
                let mut summary = read_summary(record.provider, &record.paused_path);
                let original_path_occupied = record.original_path.exists();
                skills.retain(|skill| skill.id != record.skill_id);
                summary.id = record.skill_id;
                summary.status = SkillStatus::Paused;
                summary.original_path = record.original_path;
                summary.current_path = record.paused_path;
                if original_path_occupied {
                    summary
                        .warnings
                        .push("原路径已被占用，保留暂停项".to_string());
                }
                skills.push(summary);
            }
        }

        skills.sort_by(|left, right| {
            left.name
                .to_lowercase()
                .cmp(&right.name.to_lowercase())
                .then_with(|| left.id.cmp(&right.id))
        });
        Ok(ScanResult { skills, warnings })
    }

    pub fn detail(&self, skill_id: &str) -> Result<SkillDetail, AppError> {
        let skills = self.scan()?;
        let summary = skills
            .iter()
            .find(|skill| skill.id == skill_id)
            .cloned()
            .ok_or_else(|| AppError::SkillNotFound {
                id: skill_id.to_owned(),
            })?;
        self.paths.assert_skill_access(&summary.current_path)?;

        let mut warnings = summary.warnings.clone();
        let skill_markdown = match fs::read_to_string(summary.current_path.join("SKILL.md")) {
            Ok(markdown) => markdown,
            Err(error) => {
                let warning = format!("无法读取 SKILL.md：{error}");
                if !warnings.contains(&warning) {
                    warnings.push(warning);
                }
                String::new()
            }
        };
        let mut files = Vec::new();
        for entry_result in WalkDir::new(&summary.current_path)
            .follow_links(false)
            .min_depth(1)
        {
            let entry = match entry_result {
                Ok(entry) => entry,
                Err(error) => {
                    append_incomplete_file_list_warning(&mut warnings, error.to_string());
                    continue;
                }
            };
            if entry.file_type().is_dir() {
                continue;
            }
            match entry.path().strip_prefix(&summary.current_path) {
                Ok(path) => files.push(path.to_string_lossy().replace('\\', "/")),
                Err(error) => {
                    append_incomplete_file_list_warning(&mut warnings, error.to_string());
                }
            }
        }
        files.sort();

        let key = skill_canonical_key(&summary);
        let mut siblings = skills
            .into_iter()
            .filter(|skill| skill_canonical_key(skill) == key)
            .collect::<Vec<_>>();
        siblings.sort_by(|left, right| {
            provider_sort_key(left.provider).cmp(&provider_sort_key(right.provider))
        });
        let providers = siblings
            .iter()
            .map(|skill| skill.provider)
            .collect::<Vec<_>>();
        let also_installed = siblings
            .into_iter()
            .filter(|skill| skill.id != summary.id)
            .map(|skill| SkillProviderInstall {
                id: skill.id,
                provider: skill.provider,
                current_path: skill.current_path,
                status: skill.status,
            })
            .collect();

        Ok(SkillDetail {
            id: summary.id,
            name: summary.name,
            description: summary.description,
            provider: summary.provider,
            status: summary.status,
            original_path: summary.original_path,
            current_path: summary.current_path,
            resolved_path: summary.resolved_path,
            providers,
            also_installed,
            warnings,
            skill_markdown,
            files,
        })
    }

    pub fn pause(&self, skill_id: &str) -> Result<SkillDetail, AppError> {
        let _guard = lock_app_transaction(&self.paths)?;
        self.pause_unlocked(skill_id, || {})
    }

    #[cfg(test)]
    pub(crate) fn pause_with_hook<Action>(
        &self,
        skill_id: &str,
        after_lock: Action,
    ) -> Result<SkillDetail, AppError>
    where
        Action: FnOnce(),
    {
        let _guard = lock_app_transaction(&self.paths)?;
        after_lock();
        self.pause_unlocked(skill_id, || {})
    }

    fn pause_unlocked<Action>(
        &self,
        skill_id: &str,
        before_index_write: Action,
    ) -> Result<SkillDetail, AppError>
    where
        Action: FnOnce(),
    {
        let skills = self.scan()?;
        if skills
            .iter()
            .any(|skill| skill.id == skill_id && skill.status == SkillStatus::Paused)
        {
            return Err(AppError::SkillAlreadyPaused {
                id: skill_id.to_owned(),
            });
        }
        let skill = skills
            .into_iter()
            .find(|skill| skill.id == skill_id && skill.status == SkillStatus::Active)
            .ok_or_else(|| AppError::SkillNotFound {
                id: skill_id.to_owned(),
            })?;
        let directory_name = skill.current_path.file_name().ok_or_else(|| AppError::Io {
            message: format!("Skill 路径缺少目录名：{}", skill.current_path.display()),
        })?;
        let paused_path = self
            .paths
            .disabled_dir
            .join(provider_directory(skill.provider))
            .join(directory_name);
        self.paths.assert_skill_access(&skill.current_path)?;
        self.paths.assert_allowed(&paused_path)?;
        self.paths.assert_allowed(&self.paths.paused_index)?;
        if paused_path.exists() {
            return Err(AppError::TargetConflict {
                path: paused_path.display().to_string(),
            });
        }

        let mut records = self.load_pause_records()?;
        fs::create_dir_all(paused_path.parent().expect("暂停路径应有父目录"))?;
        move_directory(&skill.current_path, &paused_path)?;
        records.push(PauseRecord {
            skill_id: skill.id.clone(),
            provider: skill.provider,
            original_path: skill.original_path,
            paused_path: paused_path.clone(),
            paused_at: Utc::now(),
        });
        before_index_write();
        if let Err(index_error) = self.write_pause_records(&records) {
            if let Err(rollback_error) = move_directory(&paused_path, &skill.current_path) {
                return Err(AppError::MoveRollback {
                    message: format!(
                        "{index_error}；目录回滚 {} -> {} 失败：{rollback_error}",
                        paused_path.display(),
                        skill.current_path.display()
                    ),
                });
            }
            return Err(index_error);
        }
        self.detail(skill_id)
    }

    pub fn resume(&self, skill_id: &str) -> Result<SkillDetail, AppError> {
        let _guard = lock_app_transaction(&self.paths)?;
        self.resume_unlocked(skill_id, || {}, || {})
    }

    #[cfg(test)]
    pub(crate) fn resume_with_hook<Action>(
        &self,
        skill_id: &str,
        after_lock: Action,
    ) -> Result<SkillDetail, AppError>
    where
        Action: FnOnce(),
    {
        let _guard = lock_app_transaction(&self.paths)?;
        after_lock();
        self.resume_unlocked(skill_id, || {}, || {})
    }

    #[cfg(test)]
    fn resume_with_commit_hook<Action>(
        &self,
        skill_id: &str,
        before_commit: Action,
    ) -> Result<SkillDetail, AppError>
    where
        Action: FnOnce(),
    {
        let _guard = lock_app_transaction(&self.paths)?;
        self.resume_unlocked(skill_id, before_commit, || {})
    }

    fn resume_unlocked<CommitAction, IndexAction>(
        &self,
        skill_id: &str,
        before_commit: CommitAction,
        before_index_write: IndexAction,
    ) -> Result<SkillDetail, AppError>
    where
        CommitAction: FnOnce(),
        IndexAction: FnOnce(),
    {
        let mut records = self.load_pause_records()?;
        let position = records
            .iter()
            .position(|record| record.skill_id == skill_id)
            .ok_or_else(|| AppError::SkillNotFound {
                id: skill_id.to_owned(),
            })?;
        let record = records[position].clone();
        let provider_root = self.paths.provider_root(record.provider)?;
        self.paths
            .assert_within(&record.original_path, provider_root)?;
        let disabled_provider_root = self
            .paths
            .disabled_dir
            .join(provider_directory(record.provider));
        self.paths
            .assert_within(&record.paused_path, &disabled_provider_root)?;
        self.paths.assert_allowed(&self.paths.paused_index)?;
        if record.original_path.exists() {
            return Err(AppError::TargetConflict {
                path: record.original_path.display().to_string(),
            });
        }

        if let Some(parent) = record.original_path.parent() {
            self.paths.assert_allowed(parent)?;
            fs::create_dir_all(parent)?;
        }
        before_commit();
        move_directory(&record.paused_path, &record.original_path)?;
        records.remove(position);
        before_index_write();
        if let Err(index_error) = self.write_pause_records(&records) {
            if let Err(rollback_error) = move_directory(&record.original_path, &record.paused_path)
            {
                return Err(AppError::MoveRollback {
                    message: format!(
                        "{index_error}；目录回滚 {} -> {} 失败：{rollback_error}",
                        record.original_path.display(),
                        record.paused_path.display()
                    ),
                });
            }
            return Err(index_error);
        }
        self.detail(skill_id)
    }

    pub(crate) fn load_pause_records(&self) -> Result<Vec<PauseRecord>, AppError> {
        self.paths.assert_allowed(&self.paths.paused_index)?;
        read_json(&self.paths.paused_index, |error| AppError::PauseIndex {
            message: format!(
                "无法解析 JSON {}：{error}",
                self.paths.paused_index.display()
            ),
        })
    }

    pub(crate) fn write_pause_records(&self, records: &[PauseRecord]) -> Result<(), AppError> {
        self.paths.assert_allowed(&self.paths.app_data_dir)?;
        self.paths.assert_allowed(&self.paths.paused_index)?;
        fs::create_dir_all(&self.paths.app_data_dir)?;
        write_json(&self.paths.paused_index, records, |error| {
            AppError::PauseIndex {
                message: format!("无法序列化 JSON：{error}"),
            }
        })
    }
}

fn provider_directory(provider: Provider) -> &'static str {
    match provider {
        Provider::Cursor => "cursor",
        Provider::Claude => "claude",
        Provider::Codex => "codex",
    }
}

fn move_directory(source: &Path, target: &Path) -> Result<(), AppError> {
    match rename_directory_no_replace(source, target) {
        Ok(()) => return Ok(()),
        Err(AppError::CrossDevice { .. }) => {}
        Err(error) => return Err(error),
    }

    let parent = target.parent().ok_or_else(|| AppError::Io {
        message: format!("移动目标缺少父目录：{}", target.display()),
    })?;
    let temp_path = parent.join(format!(".skill-move-{}.tmp", Uuid::new_v4()));
    let source_parent = source.parent().ok_or_else(|| AppError::Io {
        message: format!("移动源缺少父目录：{}", source.display()),
    })?;
    let tombstone_path = source_parent.join(format!(".skill-source-{}.tombstone", Uuid::new_v4()));
    let result = (|| {
        copy_directory(source, &temp_path)?;
        verify_directory_copy(source, &temp_path)?;
        commit_verified_copy(
            source,
            &temp_path,
            target,
            &tombstone_path,
            rename_directory_no_replace,
            |tombstone| fs::remove_dir_all(tombstone),
        )
    })();
    if result.is_err() && temp_path.exists() {
        let _ = fs::remove_dir_all(&temp_path);
    }
    result
}

fn commit_verified_copy<Rename, Remove>(
    source: &Path,
    temp_path: &Path,
    target: &Path,
    tombstone_path: &Path,
    mut rename: Rename,
    mut remove_tombstone: Remove,
) -> Result<(), AppError>
where
    Rename: FnMut(&Path, &Path) -> Result<(), AppError>,
    Remove: FnMut(&Path) -> std::io::Result<()>,
{
    rename(source, tombstone_path)?;
    match rename(temp_path, target) {
        Ok(()) => {
            if let Err(error) = remove_tombstone(tombstone_path) {
                eprintln!(
                    "已隔离无法清理的移动墓碑目录 {}：{error}",
                    tombstone_path.display()
                );
            }
            Ok(())
        }
        Err(commit_error) => match rename_directory_no_replace(tombstone_path, source) {
            Ok(()) => Err(commit_error),
            Err(restore_error) => Err(AppError::RollbackFailed {
                original_error: format!("提交移动目标 {} 失败：{commit_error}", target.display()),
                rollback_error: format!("恢复源目录 {} 失败：{restore_error}", source.display()),
            }),
        },
    }
}

#[derive(Deserialize)]
#[cfg_attr(not(test), allow(dead_code))]
struct Frontmatter {
    name: Option<String>,
    description: Option<String>,
}

pub(crate) use crate::skill_metadata::SkillMetadata;

fn read_root_entries_or_isolate(
    root_path: &Path,
    warnings: &mut Vec<String>,
) -> Option<fs::ReadDir> {
    match fs::read_dir(root_path) {
        Ok(entries) => Some(entries),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => None,
        Err(error) => {
            isolate_root_error(
                root_path,
                &AppError::Io {
                    message: error.to_string(),
                },
            );
            warnings.push(format!(
                "无法读取 Skill 根目录 {}：{error}",
                root_path.display()
            ));
            None
        }
    }
}

fn isolate_root_error(root_path: &Path, error: &AppError) {
    eprintln!(
        "已隔离无法扫描的 Skill 根目录 {}：{error}",
        root_path.display()
    );
}

fn isolate_unattributed_entry_error(root_path: &Path, error: &std::io::Error) {
    eprintln!(
        "已隔离无法取得路径的目录条目（根目录 {}）：{error}",
        root_path.display()
    );
}

fn reject_unsafe_skill_path(skill_path: &Path, error: &AppError) {
    eprintln!(
        "已拒绝不安全的 Skill 路径 {}：{error}",
        skill_path.display()
    );
}

fn recover_summary_after_file_type_error(
    provider: Provider,
    skill_path: &Path,
    file_type_error: impl AsRef<str>,
    metadata_is_directory: Result<bool, String>,
) -> Option<SkillSummary> {
    match metadata_is_directory {
        Ok(true) if is_skill_directory(skill_path) => {
            let mut summary = read_summary(provider, skill_path);
            summary
                .warnings
                .push(format!("无法读取条目类型：{}", file_type_error.as_ref()));
            Some(summary)
        }
        Ok(_) => {
            eprintln!(
                "已隔离非 Skill 条目 {}：无法读取条目类型（{}）",
                skill_path.display(),
                file_type_error.as_ref()
            );
            None
        }
        Err(metadata_error) => {
            eprintln!(
                "已隔离无法确认是否为目录的条目 {}：无法读取条目类型（{}）；{metadata_error}",
                skill_path.display(),
                file_type_error.as_ref()
            );
            None
        }
    }
}

fn is_skill_directory(path: &Path) -> bool {
    let is_hidden = path
        .file_name()
        .and_then(|name| name.to_str())
        .is_some_and(|name| name.starts_with('.'));
    if is_hidden {
        return false;
    }

    crate::skill_detect::dir_has_skill_md(path)
}

fn append_incomplete_file_list_warning(warnings: &mut Vec<String>, error: impl AsRef<str>) {
    warnings.push(format!(
        "文件清单可能不完整：遍历目录失败（{}）",
        error.as_ref()
    ));
}

fn read_summary(provider: Provider, skill_path: &Path) -> SkillSummary {
    let mut summary = summary_with_warnings(provider, skill_path, Vec::new());
    let metadata = read_skill_metadata(skill_path);
    summary.name = metadata.name;
    summary.description = metadata.description;
    summary.warnings.extend(metadata.warnings);

    summary
}

pub(crate) fn read_skill_metadata(skill_path: &Path) -> SkillMetadata {
    crate::skill_metadata::read_skill_metadata(skill_path)
}

fn summary_with_warnings(
    provider: Provider,
    skill_path: &Path,
    warnings: Vec<String>,
) -> SkillSummary {
    let name = skill_path
        .file_name()
        .map(|name| name.to_string_lossy().into_owned())
        .unwrap_or_default();
    let id_input = format!("{provider:?}:{}", skill_path.display());
    let id = Sha256::digest(id_input.as_bytes())
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect();
    let current_path = skill_path.to_path_buf();
    let resolved_path = if path_is_symlink_link(skill_path) {
        skill_path.canonicalize().ok()
    } else {
        None
    };

    SkillSummary {
        id,
        name,
        description: String::new(),
        provider,
        status: SkillStatus::Active,
        original_path: current_path.clone(),
        current_path,
        resolved_path,
        providers: vec![provider],
        also_installed: Vec::new(),
        warnings,
    }
}

fn provider_sort_key(provider: Provider) -> u8 {
    match provider {
        Provider::Cursor => 0,
        Provider::Claude => 1,
        Provider::Codex => 2,
    }
}

/// 去重键：symlink 解析目标，否则 canonicalize(current_path)，再退回 current_path。
fn skill_canonical_key(skill: &SkillSummary) -> String {
    let path = if let Some(resolved) = &skill.resolved_path {
        resolved.clone()
    } else {
        fs::canonicalize(&skill.current_path).unwrap_or_else(|_| skill.current_path.clone())
    };
    crate::path_norm::normalize_path_key(&path)
}

/// 同一原始源路径（多 Provider 仅引用/symlink）合并为一行。
pub(crate) fn merge_skills_by_canonical_path(skills: Vec<SkillSummary>) -> Vec<SkillSummary> {
    use std::collections::BTreeMap;

    let mut groups: BTreeMap<String, Vec<SkillSummary>> = BTreeMap::new();
    for skill in skills {
        let key = skill_canonical_key(&skill);
        groups.entry(key).or_default().push(skill);
    }

    let mut merged = groups
        .into_values()
        .map(|mut group| {
            group.sort_by(|left, right| {
                provider_sort_key(left.provider)
                    .cmp(&provider_sort_key(right.provider))
                    .then_with(|| left.id.cmp(&right.id))
            });
            let mut primary = group.remove(0);
            let mut providers = vec![primary.provider];
            let mut also_installed = Vec::new();
            for other in group {
                if !providers.contains(&other.provider) {
                    providers.push(other.provider);
                }
                also_installed.push(SkillProviderInstall {
                    id: other.id,
                    provider: other.provider,
                    current_path: other.current_path,
                    status: other.status,
                });
                for warning in other.warnings {
                    if !primary.warnings.contains(&warning) {
                        primary.warnings.push(warning);
                    }
                }
                // 优先保留已解析的源路径，便于前端展示真实位置
                if primary.resolved_path.is_none() {
                    if let Some(resolved) = other.resolved_path {
                        primary.resolved_path = Some(resolved);
                    }
                }
                if primary.description.is_empty() && !other.description.is_empty() {
                    primary.description = other.description;
                }
                if primary.name.is_empty() && !other.name.is_empty() {
                    primary.name = other.name;
                }
            }
            primary.providers = providers;
            primary.also_installed = also_installed;
            primary
        })
        .collect::<Vec<_>>();

    merged.sort_by(|left, right| {
        left.name
            .to_lowercase()
            .cmp(&right.name.to_lowercase())
            .then_with(|| left.id.cmp(&right.id))
    });
    merged
}

#[cfg(test)]
mod tests {
    use std::fs;

    use tempfile::tempdir;

    use super::{
        append_incomplete_file_list_warning, commit_verified_copy,
        merge_skills_by_canonical_path, recover_summary_after_file_type_error, SkillRepository,
    };
    use crate::error::AppError;
    use crate::json_store::replace_existing_index_with_backup;
    use crate::model::{PauseRecord, Provider, SkillStatus, SkillSummary};
    use crate::paths::AppPaths;

    fn write_skill(paths: &AppPaths, root_index: usize, directory: &str, markdown: &str) {
        let skill_dir = paths.skill_roots[root_index].path.join(directory);
        fs::create_dir_all(&skill_dir).unwrap();
        fs::write(skill_dir.join("SKILL.md"), markdown).unwrap();
    }

    #[test]
    fn file_type_fallback_parses_valid_frontmatter_and_appends_warning() {
        let base = tempdir().unwrap();
        let path = base.path().join("fallback-skill");
        fs::create_dir_all(&path).unwrap();
        fs::write(
            path.join("SKILL.md"),
            "---\nname: Parsed Name\ndescription: Parsed description\n---\nBody",
        )
        .unwrap();

        let summary =
            recover_summary_after_file_type_error(Provider::Cursor, &path, "拒绝访问", Ok(true))
                .unwrap();

        assert_eq!(summary.name, "Parsed Name");
        assert_eq!(summary.description, "Parsed description");
        assert!(summary
            .warnings
            .iter()
            .any(|warning| warning == "无法读取条目类型：拒绝访问"));
    }

    #[test]
    fn file_type_fallback_preserves_yaml_and_file_type_warnings() {
        let base = tempdir().unwrap();
        let path = base.path().join("broken-yaml");
        fs::create_dir_all(&path).unwrap();
        fs::write(path.join("SKILL.md"), "---\nname: [invalid\n---\nBody").unwrap();

        let summary =
            recover_summary_after_file_type_error(Provider::Cursor, &path, "拒绝访问", Ok(true))
                .unwrap();

        assert_eq!(summary.name, "broken-yaml");
        assert!(summary
            .warnings
            .iter()
            .any(|warning| warning.contains("YAML 格式错误")));
        assert!(summary
            .warnings
            .iter()
            .any(|warning| warning == "无法读取条目类型：拒绝访问"));
    }

    #[test]
    fn file_type_fallback_ignores_directory_without_skill_markdown() {
        let base = tempdir().unwrap();
        let path = base.path().join("missing-markdown");
        fs::create_dir_all(&path).unwrap();

        let summary =
            recover_summary_after_file_type_error(Provider::Cursor, &path, "拒绝访问", Ok(true));

        assert!(summary.is_none());
    }

    #[test]
    fn file_type_error_does_not_create_actionable_skill_when_directory_is_unconfirmed() {
        let path = std::path::Path::new("/managed/broken-entry");

        let summary = recover_summary_after_file_type_error(
            Provider::Cursor,
            path,
            "拒绝访问",
            Err("无法读取元数据".to_string()),
        );

        assert!(summary.is_none());
    }

    #[test]
    fn merge_skills_by_canonical_path_dedups_same_source_keeps_different_sources() {
        use std::path::PathBuf;

        let shared = PathBuf::from("/library/grill-me");
        let a = SkillSummary {
            id: "cursor-1".into(),
            name: "grill-me".into(),
            description: "desc".into(),
            provider: Provider::Cursor,
            status: SkillStatus::Active,
            original_path: PathBuf::from("/cursor/grill-me"),
            current_path: PathBuf::from("/cursor/grill-me"),
            resolved_path: Some(shared.clone()),
            providers: vec![Provider::Cursor],
            also_installed: vec![],
            warnings: vec![],
        };
        let b = SkillSummary {
            id: "claude-1".into(),
            name: "grill-me".into(),
            description: "desc".into(),
            provider: Provider::Claude,
            status: SkillStatus::Active,
            original_path: PathBuf::from("/claude/grill-me"),
            current_path: PathBuf::from("/claude/grill-me"),
            resolved_path: Some(shared),
            providers: vec![Provider::Claude],
            also_installed: vec![],
            warnings: vec![],
        };
        let other = SkillSummary {
            id: "cursor-2".into(),
            name: "grill-me".into(),
            description: "other source".into(),
            provider: Provider::Cursor,
            status: SkillStatus::Active,
            original_path: PathBuf::from("/other/grill-me"),
            current_path: PathBuf::from("/other/grill-me"),
            resolved_path: Some(PathBuf::from("/library/other-grill-me")),
            providers: vec![Provider::Cursor],
            also_installed: vec![],
            warnings: vec![],
        };

        let merged = merge_skills_by_canonical_path(vec![a, b, other]);
        assert_eq!(merged.len(), 2);

        let grouped = merged
            .iter()
            .find(|skill| skill.also_installed.len() == 1)
            .unwrap();
        assert_eq!(grouped.provider, Provider::Cursor);
        assert_eq!(
            grouped.providers,
            vec![Provider::Cursor, Provider::Claude]
        );
        assert_eq!(grouped.also_installed[0].provider, Provider::Claude);
        assert_eq!(grouped.also_installed[0].id, "claude-1");

        let distinct = merged
            .iter()
            .find(|skill| skill.id == "cursor-2")
            .unwrap();
        assert!(distinct.also_installed.is_empty());
        assert_eq!(distinct.providers, vec![Provider::Cursor]);
    }

    #[cfg(unix)]
    #[test]
    fn scan_with_warnings_merges_multi_provider_symlinks_to_same_source() {
        use std::os::unix::fs::symlink;

        let base = tempdir().unwrap();
        let outside = tempdir().unwrap();
        let paths = AppPaths::for_test(base.path());
        fs::create_dir_all(&paths.skill_roots[0].path).unwrap();
        fs::create_dir_all(&paths.skill_roots[1].path).unwrap();
        fs::create_dir_all(&paths.skill_roots[2].path).unwrap();
        fs::write(
            outside.path().join("SKILL.md"),
            "---\nname: grill-me\ndescription: shared\n---\nBody",
        )
        .unwrap();
        for root in &paths.skill_roots {
            symlink(outside.path(), root.path.join("grill-me")).unwrap();
        }

        let repository = SkillRepository::new(paths);
        assert_eq!(repository.scan().unwrap().len(), 3);

        let result = repository.scan_with_warnings().unwrap();
        assert_eq!(result.skills.len(), 1);
        assert_eq!(
            result.skills[0].providers,
            vec![Provider::Cursor, Provider::Claude, Provider::Codex]
        );
        assert_eq!(result.skills[0].also_installed.len(), 2);
        assert_eq!(result.skills[0].name, "grill-me");
    }

    #[cfg(unix)]
    #[test]
    fn scan_includes_provider_symlink_skills_outside_allowed_roots() {
        use std::os::unix::fs::symlink;

        let base = tempdir().unwrap();
        let outside = tempdir().unwrap();
        let paths = AppPaths::for_test(base.path());
        fs::create_dir_all(&paths.skill_roots[0].path).unwrap();
        fs::write(
            outside.path().join("SKILL.md"),
            "---\nname: Library Skill\ndescription: from library\n---\nBody",
        )
        .unwrap();
        fs::write(outside.path().join("notes.txt"), "note").unwrap();
        symlink(
            outside.path(),
            paths.skill_roots[0].path.join("library-skill"),
        )
        .unwrap();

        let repository = SkillRepository::new(paths);
        let skills = repository.scan().unwrap();

        assert_eq!(skills.len(), 1);
        assert_eq!(skills[0].provider, Provider::Cursor);
        assert_eq!(skills[0].name, "Library Skill");
        assert!(skills[0].current_path.is_symlink());
        assert_eq!(
            skills[0].resolved_path.as_deref(),
            Some(outside.path().canonicalize().unwrap().as_path())
        );

        let detail = repository.detail(&skills[0].id).unwrap();
        assert!(detail.skill_markdown.contains("Library Skill"));
        assert!(detail.files.iter().any(|file| file == "notes.txt"));
        assert_eq!(
            detail.resolved_path.as_deref(),
            Some(outside.path().canonicalize().unwrap().as_path())
        );
    }

    #[cfg(unix)]
    #[test]
    fn scan_reports_unusable_root_and_continues_other_providers() {
        use std::os::unix::fs::symlink;

        let base = tempdir().unwrap();
        let paths = AppPaths::for_test(base.path());
        fs::create_dir_all(base.path().join(".cursor")).unwrap();
        symlink(base.path().join("missing-root"), &paths.skill_roots[0].path).unwrap();
        write_skill(&paths, 1, "available", "# Available");

        let result = SkillRepository::new(paths).scan_with_warnings().unwrap();

        assert_eq!(result.skills.len(), 1);
        assert_eq!(result.skills[0].provider, Provider::Claude);
        assert_eq!(result.warnings.len(), 1);
        assert!(result.warnings[0].contains("无法扫描 Skill 根目录"));
    }

    #[test]
    fn traversal_error_marks_file_list_as_incomplete() {
        let mut warnings = vec!["已有警告".to_string()];

        append_incomplete_file_list_warning(&mut warnings, "拒绝访问 nested");

        assert_eq!(warnings.len(), 2);
        assert_eq!(
            warnings[1],
            "文件清单可能不完整：遍历目录失败（拒绝访问 nested）"
        );
    }

    #[test]
    fn scans_all_providers_and_uses_valid_frontmatter() {
        let base = tempdir().unwrap();
        let paths = AppPaths::for_test(base.path());
        write_skill(
            &paths,
            0,
            "cursor-dir",
            "---\nname: Cursor Skill\ndescription: Cursor description\n---\nBody",
        );
        write_skill(&paths, 1, "claude-dir", "# Claude");
        write_skill(&paths, 2, "codex-dir", "# Codex");

        let skills = SkillRepository::new(paths).scan().unwrap();

        assert_eq!(skills.len(), 3);
        let cursor = skills
            .iter()
            .find(|skill| skill.provider == Provider::Cursor)
            .unwrap();
        assert_eq!(cursor.name, "Cursor Skill");
        assert_eq!(cursor.description, "Cursor description");
        assert!(skills
            .iter()
            .any(|skill| skill.provider == Provider::Claude));
        assert!(skills.iter().any(|skill| skill.provider == Provider::Codex));
    }

    #[test]
    fn scan_ignores_directories_without_skill_markdown_hidden_directories_and_plain_files() {
        let base = tempdir().unwrap();
        let paths = AppPaths::for_test(base.path());
        fs::create_dir_all(paths.skill_roots[0].path.join("not-a-skill")).unwrap();
        fs::create_dir_all(paths.skill_roots[0].path.join(".hidden-skill")).unwrap();
        fs::write(
            paths.skill_roots[0].path.join(".hidden-skill/SKILL.md"),
            "# Hidden",
        )
        .unwrap();
        fs::create_dir_all(&paths.skill_roots[0].path).unwrap();
        fs::write(paths.skill_roots[0].path.join("plain.txt"), "ignored").unwrap();
        write_skill(&paths, 0, "valid", "# Valid");

        let skills = SkillRepository::new(paths).scan().unwrap();

        assert_eq!(skills.len(), 1);
        assert_eq!(skills[0].name, "valid");
    }

    #[test]
    fn malformed_frontmatter_returns_warning() {
        let base = tempdir().unwrap();
        let paths = AppPaths::for_test(base.path());
        write_skill(&paths, 0, "broken", "---\nname: [invalid\n---\nBody");

        let skills = SkillRepository::new(paths).scan().unwrap();

        let broken = skills.iter().find(|skill| skill.name == "broken").unwrap();
        assert!(broken
            .warnings
            .iter()
            .any(|warning| warning.contains("YAML")));
    }

    #[test]
    fn ignores_plain_files_and_markdown_body_is_not_frontmatter() {
        let base = tempdir().unwrap();
        let paths = AppPaths::for_test(base.path());
        fs::create_dir_all(&paths.skill_roots[0].path).unwrap();
        fs::write(paths.skill_roots[0].path.join("plain.txt"), "ignored").unwrap();
        write_skill(
            &paths,
            0,
            "body-only",
            "# Heading\nname: Not Frontmatter\ndescription: ignored",
        );

        let skills = SkillRepository::new(paths).scan().unwrap();

        assert_eq!(skills.len(), 1);
        assert_eq!(skills[0].name, "body-only");
        assert_eq!(skills[0].description, "");
    }

    #[test]
    fn ids_are_stable_and_distinguish_providers() {
        let base = tempdir().unwrap();
        let mut paths = AppPaths::for_test(base.path());
        let shared_root = base.path().join("shared");
        paths.skill_roots[0].path = shared_root.clone();
        paths.skill_roots[1].path = shared_root;
        write_skill(&paths, 0, "same", "# Same");
        let repository = SkillRepository::new(paths);

        let first = repository.scan().unwrap();
        let second = repository.scan().unwrap();

        assert_eq!(first.len(), 2);
        assert_eq!(first[0].id, second[0].id);
        assert_eq!(first[1].id, second[1].id);
        assert_ne!(first[0].id, first[1].id);
        assert!(first.iter().all(|skill| skill.id.len() == 64));
    }

    #[test]
    fn sorts_names_case_insensitively() {
        let base = tempdir().unwrap();
        let paths = AppPaths::for_test(base.path());
        write_skill(&paths, 0, "z-dir", "---\nname: zebra\n---");
        write_skill(&paths, 0, "a-dir", "---\nname: Alpha\n---");

        let skills = SkillRepository::new(paths).scan().unwrap();

        assert_eq!(
            skills
                .iter()
                .map(|skill| skill.name.as_str())
                .collect::<Vec<_>>(),
            vec!["Alpha", "zebra"]
        );
    }

    #[test]
    fn detail_returns_markdown_and_sorted_relative_file_list() {
        let base = tempdir().unwrap();
        let paths = AppPaths::for_test(base.path());
        write_skill(&paths, 0, "detail", "---\nname: Detail\n---\nContent");
        let skill_dir = paths.skill_roots[0].path.join("detail");
        fs::create_dir_all(skill_dir.join("nested")).unwrap();
        fs::write(skill_dir.join("z.txt"), "z").unwrap();
        fs::write(skill_dir.join("nested/a.txt"), "a").unwrap();
        let repository = SkillRepository::new(paths);
        let id = repository.scan().unwrap()[0].id.clone();

        let detail = repository.detail(&id).unwrap();

        assert_eq!(detail.skill_markdown, "---\nname: Detail\n---\nContent");
        assert_eq!(detail.files, vec!["SKILL.md", "nested/a.txt", "z.txt"]);
    }

    #[cfg(unix)]
    #[test]
    fn detail_lists_symlinks_without_following_them() {
        use std::os::unix::fs::symlink;

        let base = tempdir().unwrap();
        let outside = tempdir().unwrap();
        let paths = AppPaths::for_test(base.path());
        write_skill(&paths, 0, "links", "# Links");
        fs::create_dir_all(outside.path().join("target")).unwrap();
        fs::write(outside.path().join("target/secret.txt"), "secret").unwrap();
        let skill_dir = paths.skill_roots[0].path.join("links");
        symlink(outside.path().join("target"), skill_dir.join("linked-dir")).unwrap();
        symlink(
            outside.path().join("target/secret.txt"),
            skill_dir.join("linked-file"),
        )
        .unwrap();
        let repository = SkillRepository::new(paths);
        let id = repository.scan().unwrap()[0].id.clone();

        let detail = repository.detail(&id).unwrap();

        assert_eq!(detail.files, vec!["SKILL.md", "linked-dir", "linked-file"]);
    }

    #[test]
    fn unknown_detail_id_returns_skill_not_found() {
        let base = tempdir().unwrap();
        let repository = SkillRepository::new(AppPaths::for_test(base.path()));

        let error = repository.detail("unknown").unwrap_err();

        assert!(matches!(error, AppError::SkillNotFound { id } if id == "unknown"));
    }

    #[test]
    fn pause_moves_skill_and_scan_and_detail_include_paused_skill() {
        let base = tempdir().unwrap();
        let paths = AppPaths::for_test(base.path());
        write_skill(&paths, 0, "pausable", "---\nname: Pausable\n---\nBody");
        let original_path = paths.skill_roots[0].path.join("pausable");
        fs::write(original_path.join("extra.txt"), "extra").unwrap();
        let paused_path = paths.disabled_dir.join("cursor/pausable");
        let repository = SkillRepository::new(paths);
        let id = repository.scan().unwrap()[0].id.clone();

        let paused = repository.pause(&id).unwrap();

        assert!(!original_path.exists());
        assert!(paused_path.exists());
        assert_eq!(paused.status, SkillStatus::Paused);
        assert_eq!(paused.original_path, original_path);
        assert_eq!(paused.current_path, paused_path);
        let scanned = repository.scan().unwrap();
        assert_eq!(scanned.len(), 1);
        assert_eq!(scanned[0].status, SkillStatus::Paused);
        let detail = repository.detail(&id).unwrap();
        assert_eq!(detail.skill_markdown, "---\nname: Pausable\n---\nBody");
        assert_eq!(detail.files, vec!["SKILL.md", "extra.txt"]);
    }

    #[test]
    fn resume_moves_paused_skill_back_and_scan_marks_it_active() {
        let base = tempdir().unwrap();
        let paths = AppPaths::for_test(base.path());
        write_skill(&paths, 1, "resumable", "# Resumable");
        let original_path = paths.skill_roots[1].path.join("resumable");
        let paused_path = paths.disabled_dir.join("claude/resumable");
        let repository = SkillRepository::new(paths);
        let id = repository.scan().unwrap()[0].id.clone();
        repository.pause(&id).unwrap();

        let resumed = repository.resume(&id).unwrap();

        assert!(original_path.exists());
        assert!(!paused_path.exists());
        assert_eq!(resumed.status, SkillStatus::Active);
        let scanned = repository.scan().unwrap();
        assert_eq!(scanned.len(), 1);
        assert_eq!(scanned[0].status, SkillStatus::Active);
    }

    #[test]
    fn pause_target_conflict_does_not_move_source() {
        let base = tempdir().unwrap();
        let paths = AppPaths::for_test(base.path());
        write_skill(&paths, 2, "conflict", "# Conflict");
        let original_path = paths.skill_roots[2].path.join("conflict");
        let paused_path = paths.disabled_dir.join("codex/conflict");
        fs::create_dir_all(&paused_path).unwrap();
        let repository = SkillRepository::new(paths);
        let id = repository.scan().unwrap()[0].id.clone();

        let error = repository.pause(&id).unwrap_err();

        assert!(matches!(error, AppError::TargetConflict { .. }));
        assert!(original_path.exists());
        assert!(paused_path.exists());
    }

    #[test]
    fn resume_target_conflict_does_not_move_paused_skill() {
        let base = tempdir().unwrap();
        let paths = AppPaths::for_test(base.path());
        write_skill(&paths, 0, "resume-conflict", "# Conflict");
        let original_path = paths.skill_roots[0].path.join("resume-conflict");
        let paused_path = paths.disabled_dir.join("cursor/resume-conflict");
        let repository = SkillRepository::new(paths);
        let id = repository.scan().unwrap()[0].id.clone();
        repository.pause(&id).unwrap();
        fs::create_dir_all(&original_path).unwrap();

        let error = repository.resume(&id).unwrap_err();

        assert!(matches!(error, AppError::TargetConflict { .. }));
        assert!(original_path.exists());
        assert!(paused_path.exists());
    }

    #[test]
    fn resume_commit_rejects_empty_target_created_after_precheck() {
        let base = tempdir().unwrap();
        let paths = AppPaths::for_test(base.path());
        write_skill(&paths, 0, "resume-empty-race", "# Race");
        let original_path = paths.skill_roots[0].path.join("resume-empty-race");
        let paused_path = paths.disabled_dir.join("cursor/resume-empty-race");
        let repository = SkillRepository::new(paths);
        let id = repository.scan().unwrap()[0].id.clone();
        repository.pause(&id).unwrap();

        let error = repository
            .resume_with_commit_hook(&id, || fs::create_dir(&original_path).unwrap())
            .unwrap_err();

        assert!(matches!(error, AppError::TargetConflict { .. }));
        assert!(paused_path.exists());
        assert!(original_path.is_dir());
        assert_eq!(fs::read_dir(original_path).unwrap().count(), 0);
    }

    #[test]
    fn resume_rejects_original_path_under_wrong_provider_root() {
        let base = tempdir().unwrap();
        let paths = AppPaths::for_test(base.path());
        write_skill(&paths, 0, "wrong-original", "# Wrong");
        let repository = SkillRepository::new(paths.clone());
        let id = repository.scan().unwrap()[0].id.clone();
        repository.pause(&id).unwrap();
        let mut records = repository.load_pause_records().unwrap();
        records[0].original_path = paths.skill_roots[1].path.join("wrong-original");
        repository.write_pause_records(&records).unwrap();

        let error = repository.resume(&id).unwrap_err();

        assert!(matches!(error, AppError::PathOutsideManagedRoots { .. }));
        assert!(records[0].paused_path.exists());
        assert!(!records[0].original_path.exists());
    }

    #[test]
    fn resume_rejects_paused_path_outside_provider_disabled_root() {
        let base = tempdir().unwrap();
        let paths = AppPaths::for_test(base.path());
        write_skill(&paths, 0, "wrong-paused", "# Wrong");
        let repository = SkillRepository::new(paths.clone());
        let id = repository.scan().unwrap()[0].id.clone();
        repository.pause(&id).unwrap();
        let mut records = repository.load_pause_records().unwrap();
        records[0].paused_path = paths.disabled_dir.join("claude/wrong-paused");
        repository.write_pause_records(&records).unwrap();

        let error = repository.resume(&id).unwrap_err();

        assert!(matches!(error, AppError::PathOutsideManagedRoots { .. }));
        assert!(!records[0].original_path.exists());
    }

    #[test]
    fn scan_ignores_pause_record_pointing_at_backups_directory() {
        let base = tempdir().unwrap();
        let paths = AppPaths::for_test(base.path());
        write_skill(&paths, 0, "forged-pause", "# Forged");
        let repository = SkillRepository::new(paths.clone());
        let id = repository.scan().unwrap()[0].id.clone();
        repository.pause(&id).unwrap();

        let forged_backup = paths.backups_dir.join("trap");
        fs::create_dir_all(&forged_backup).unwrap();
        fs::write(forged_backup.join("SKILL.md"), "# Trap").unwrap();
        let mut records = repository.load_pause_records().unwrap();
        records[0].paused_path = forged_backup.clone();
        repository.write_pause_records(&records).unwrap();

        let result = repository.scan_with_warnings().unwrap();

        assert!(result
            .warnings
            .iter()
            .any(|warning| warning.contains("暂停路径不在对应停用目录内")));
        assert!(!result
            .skills
            .iter()
            .any(|skill| skill.current_path == forged_backup));
        assert!(forged_backup.exists());
    }

    #[test]
    fn malformed_pause_index_returns_error_without_losing_contents() {
        let base = tempdir().unwrap();
        let paths = AppPaths::for_test(base.path());
        fs::create_dir_all(&paths.app_data_dir).unwrap();
        fs::write(&paths.paused_index, "{broken json").unwrap();
        let repository = SkillRepository::new(paths.clone());

        let error = repository.scan().unwrap_err();

        assert!(error.to_string().contains("JSON"));
        assert_eq!(
            fs::read_to_string(paths.paused_index).unwrap(),
            "{broken json"
        );
    }

    #[test]
    fn repeated_pause_returns_clear_error() {
        let base = tempdir().unwrap();
        let paths = AppPaths::for_test(base.path());
        write_skill(&paths, 0, "twice", "# Twice");
        let repository = SkillRepository::new(paths);
        let id = repository.scan().unwrap()[0].id.clone();
        repository.pause(&id).unwrap();

        let error = repository.pause(&id).unwrap_err();

        assert!(error.to_string().contains("已暂停"));
    }

    #[cfg(unix)]
    #[test]
    fn pause_rolls_back_move_when_index_write_fails() {
        use std::os::unix::fs::PermissionsExt;

        let base = tempdir().unwrap();
        let mut paths = AppPaths::for_test(base.path());
        paths.disabled_dir = base.path().join("separate-disabled");
        write_skill(&paths, 0, "pause-rollback", "# Rollback");
        let original_path = paths.skill_roots[0].path.join("pause-rollback");
        fs::create_dir_all(&paths.app_data_dir).unwrap();
        fs::set_permissions(&paths.app_data_dir, fs::Permissions::from_mode(0o555)).unwrap();
        let repository = SkillRepository::new(paths.clone());
        let id = repository.scan().unwrap()[0].id.clone();

        let result = repository.pause(&id);

        fs::set_permissions(&paths.app_data_dir, fs::Permissions::from_mode(0o755)).unwrap();
        assert!(result.is_err());
        assert!(original_path.exists());
        assert!(!paths.disabled_dir.join("cursor/pause-rollback").exists());
    }

    #[cfg(unix)]
    #[test]
    fn resume_rolls_back_move_when_index_write_fails() {
        use std::os::unix::fs::PermissionsExt;

        let base = tempdir().unwrap();
        let mut paths = AppPaths::for_test(base.path());
        paths.disabled_dir = base.path().join("separate-disabled");
        write_skill(&paths, 0, "resume-rollback", "# Rollback");
        let original_path = paths.skill_roots[0].path.join("resume-rollback");
        let paused_path = paths.disabled_dir.join("cursor/resume-rollback");
        let repository = SkillRepository::new(paths.clone());
        let id = repository.scan().unwrap()[0].id.clone();
        repository.pause(&id).unwrap();
        fs::set_permissions(&paths.app_data_dir, fs::Permissions::from_mode(0o555)).unwrap();

        let result = repository.resume(&id);

        fs::set_permissions(&paths.app_data_dir, fs::Permissions::from_mode(0o755)).unwrap();
        assert!(result.is_err());
        assert!(!original_path.exists());
        assert!(paused_path.exists());
        let records: Vec<PauseRecord> =
            serde_json::from_slice(&fs::read(paths.paused_index).unwrap()).unwrap();
        assert_eq!(records.len(), 1);
    }

    #[test]
    fn cross_device_tombstone_rollback_never_overwrites_racing_target() {
        let base = tempdir().unwrap();
        let source = base.path().join("source");
        let temp = base.path().join("target-temp");
        let target = base.path().join("target");
        let tombstone = base.path().join("source-tombstone");
        fs::create_dir(&source).unwrap();
        fs::create_dir(&temp).unwrap();

        let result = commit_verified_copy(
            &source,
            &temp,
            &target,
            &tombstone,
            |from, to| {
                if from == temp {
                    fs::create_dir(&source).unwrap();
                    Err(AppError::Io {
                        message: "target commit failed".into(),
                    })
                } else {
                    fs::rename(from, to).map_err(AppError::from)
                }
            },
            |path| fs::remove_dir_all(path),
        );

        assert!(matches!(result, Err(AppError::RollbackFailed { .. })));
        assert!(source.exists());
        assert_eq!(fs::read_dir(&source).unwrap().count(), 0);
        assert!(!target.exists());
        assert!(tombstone.exists());
    }

    #[test]
    fn cross_device_tombstone_cleanup_failure_does_not_block_reverse_move() {
        let base = tempdir().unwrap();
        let original = base.path().join("original");
        let paused_temp = base.path().join("paused-temp");
        let paused = base.path().join("paused");
        let original_tombstone = base.path().join("original-tombstone");
        fs::create_dir(&original).unwrap();
        fs::create_dir(&paused_temp).unwrap();

        commit_verified_copy(
            &original,
            &paused_temp,
            &paused,
            &original_tombstone,
            |from, to| fs::rename(from, to).map_err(AppError::from),
            |_| Err(std::io::Error::other("cleanup denied")),
        )
        .unwrap();

        let restore_temp = base.path().join("restore-temp");
        let paused_tombstone = base.path().join("paused-tombstone");
        fs::create_dir(&restore_temp).unwrap();
        commit_verified_copy(
            &paused,
            &restore_temp,
            &original,
            &paused_tombstone,
            |from, to| fs::rename(from, to).map_err(AppError::from),
            |_| Err(std::io::Error::other("cleanup denied")),
        )
        .unwrap();

        assert!(original.exists());
        assert!(!paused.exists());
        assert!(original_tombstone.exists());
        assert!(paused_tombstone.exists());
    }

    #[test]
    fn successful_index_replacement_ignores_old_index_cleanup_failure() {
        let base = tempdir().unwrap();
        let index = base.path().join("paused-index.json");
        let temp = base.path().join("paused-index.tmp");
        let old = base.path().join("paused-index.old");
        fs::write(&index, "old").unwrap();
        fs::write(&temp, "new").unwrap();

        let result = replace_existing_index_with_backup(
            &temp,
            &index,
            &old,
            |from, to| fs::rename(from, to),
            |_| Err(std::io::Error::other("cleanup denied")),
        );

        assert!(result.is_ok());
        assert_eq!(fs::read_to_string(index).unwrap(), "new");
        assert_eq!(fs::read_to_string(old).unwrap(), "old");
    }

    #[test]
    fn occupied_original_path_keeps_only_paused_summary_and_detail() {
        let base = tempdir().unwrap();
        let paths = AppPaths::for_test(base.path());
        write_skill(&paths, 0, "occupied", "# Paused content");
        let repository = SkillRepository::new(paths.clone());
        let id = repository.scan().unwrap()[0].id.clone();
        repository.pause(&id).unwrap();
        write_skill(&paths, 0, "occupied", "# Replacement content");

        let scanned = repository.scan().unwrap();

        assert_eq!(scanned.len(), 1);
        assert_eq!(scanned[0].id, id);
        assert_eq!(scanned[0].status, SkillStatus::Paused);
        assert!(scanned[0]
            .warnings
            .iter()
            .any(|warning| warning.contains("原路径已被占用")));
        let detail = repository.detail(&id).unwrap();
        assert_eq!(detail.status, SkillStatus::Paused);
        assert_eq!(detail.skill_markdown, "# Paused content");
    }
}

#[cfg(test)]
mod frontmatter_fold_tests {
    use crate::skill_metadata::frontmatter_yaml;
    use super::read_skill_metadata;
    use std::fs;
    use tempfile::tempdir;

    #[test]
    fn parses_folded_description_block() {
        let base = tempdir().unwrap();
        let skill = base.path().join("java-test-coverage-assessment");
        fs::create_dir_all(&skill).unwrap();
        fs::write(
            skill.join("SKILL.md"),
            r#"---
name: java-test-coverage-assessment
description: >
  Evaluate Java project test coverage metrics. Parses JaCoCo XML reports to compute
  unit-test line/branch coverage scores, and optionally integration-test API/scenario
  coverage scores. Computes the composite coverage score per the quality assessment spec.
  TRIGGER when user mentions: 'test coverage', 'JaCoCo', 'unit test coverage',
  'integration test coverage', 'code coverage', '测试覆盖率', '单元测试', '集成测试覆盖',
  '覆盖率报告', 'coverage report'.
type: skill
---

# Java Test Coverage Assessment Skill
"#,
        )
        .unwrap();
        let metadata = read_skill_metadata(&skill);
        assert_eq!(metadata.name, "java-test-coverage-assessment");
        assert!(metadata.description.starts_with("Evaluate Java project"));
        assert!(!metadata.description.contains("name:"));
        assert!(!metadata.description.contains("type: skill"));
        assert!(metadata.warnings.is_empty(), "{:?}", metadata.warnings);
        let markdown = fs::read_to_string(skill.join("SKILL.md")).unwrap();
        let yaml = frontmatter_yaml(&markdown).unwrap();
        assert!(serde_yaml::from_str::<super::Frontmatter>(yaml).is_ok());
    }
}
