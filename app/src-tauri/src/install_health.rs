use std::collections::HashSet;
use std::fs;

use crate::error::AppError;
use crate::fs_ops::{path_is_symlink_link, remove_directory_symlink};
use crate::library_repository::LibraryIndex;
use crate::model::{InstallHealthIssue, InstallHealthKind, InstallHealthReport};
use crate::path_norm::{normalize_path_key, path_is_under_resolved, paths_eq};
use crate::paths::AppPaths;

pub fn collect_health_issues(index: &LibraryIndex, paths: &AppPaths) -> Vec<InstallHealthIssue> {
    let mut issues = Vec::new();
    let mut indexed_targets = HashSet::new();

    for installation in &index.installations {
        indexed_targets.insert(normalize_path_key(&installation.target_path));
        let skill = index
            .library_skills
            .iter()
            .find(|skill| skill.id == installation.library_skill_id);
        let expected_source = skill.and_then(|skill| skill.absolute_path.canonicalize().ok());

        match fs::symlink_metadata(&installation.target_path) {
            Err(_) => issues.push(InstallHealthIssue {
                kind: InstallHealthKind::MissingTarget,
                provider: installation.provider,
                library_skill_id: Some(installation.library_skill_id.clone()),
                target_path: installation.target_path.clone(),
                message: "索引中的安装目标不存在".into(),
                repairable: true,
            }),
            Ok(_) if !path_is_symlink_link(&installation.target_path) => issues.push(InstallHealthIssue {
                kind: InstallHealthKind::NotSymlink,
                provider: installation.provider,
                library_skill_id: Some(installation.library_skill_id.clone()),
                target_path: installation.target_path.clone(),
                message: "目标存在但不是符号链接，需手动处理".into(),
                repairable: false,
            }),
            Ok(_) => match fs::canonicalize(&installation.target_path) {
                Err(_) => issues.push(InstallHealthIssue {
                    kind: InstallHealthKind::BrokenLink,
                    provider: installation.provider,
                    library_skill_id: Some(installation.library_skill_id.clone()),
                    target_path: installation.target_path.clone(),
                    message: "符号链接已损坏".into(),
                    repairable: true,
                }),
                Ok(resolved) => {
                    if expected_source
                        .as_ref()
                        .is_some_and(|expected| !paths_eq(expected, &resolved))
                    {
                        issues.push(InstallHealthIssue {
                            kind: InstallHealthKind::SourceMismatch,
                            provider: installation.provider,
                            library_skill_id: Some(installation.library_skill_id.clone()),
                            target_path: installation.target_path.clone(),
                            message: "链接指向与库源不一致".into(),
                            repairable: true,
                        });
                    } else if skill.is_none() {
                        issues.push(InstallHealthIssue {
                            kind: InstallHealthKind::IndexOrphan,
                            provider: installation.provider,
                            library_skill_id: Some(installation.library_skill_id.clone()),
                            target_path: installation.target_path.clone(),
                            message: "安装记录对应的库 Skill 已不存在".into(),
                            repairable: true,
                        });
                    }
                }
            },
        }
    }

    for provider in [
        crate::model::Provider::Cursor,
        crate::model::Provider::Claude,
        crate::model::Provider::Codex,
    ] {
        let Ok(root) = paths.provider_root(provider) else {
            continue;
        };
        let Ok(entries) = fs::read_dir(root) else {
            continue;
        };
        for entry in entries.flatten() {
            let path = entry.path();
            let Ok(_metadata) = fs::symlink_metadata(&path) else {
                continue;
            };
            if !path_is_symlink_link(&path) {
                continue;
            }
            if indexed_targets.contains(&normalize_path_key(&path)) {
                continue;
            }
            let Ok(resolved) = fs::canonicalize(&path) else {
                continue;
            };
            if !path_is_under_resolved(&resolved, &paths.library_dir) {
                continue;
            }
            issues.push(InstallHealthIssue {
                kind: InstallHealthKind::DiskOrphan,
                provider,
                library_skill_id: None,
                target_path: path,
                message: "磁盘上存在指向库的链接，但未登记到索引".into(),
                repairable: true,
            });
        }
    }

    issues
}

pub fn repair_index(
    index: &mut LibraryIndex,
    paths: &AppPaths,
) -> Result<(usize, InstallHealthReport), AppError> {
    let issues = collect_health_issues(index, paths);
    let mut repaired = 0usize;
    for issue in &issues {
        if !issue.repairable {
            continue;
        }
        match issue.kind {
            InstallHealthKind::MissingTarget
            | InstallHealthKind::BrokenLink
            | InstallHealthKind::SourceMismatch
            | InstallHealthKind::IndexOrphan => {
                if matches!(
                    issue.kind,
                    InstallHealthKind::BrokenLink | InstallHealthKind::SourceMismatch
                ) {
                    if let Ok(_metadata) = fs::symlink_metadata(&issue.target_path) {
                        if path_is_symlink_link(&issue.target_path) {
                            let _ = remove_directory_symlink(&issue.target_path);
                        }
                    }
                }
                let before = index.installations.len();
                index.installations.retain(|installation| {
                    installation.target_path != issue.target_path
                        && !(issue.library_skill_id.as_ref().is_some_and(|id| {
                            &installation.library_skill_id == id
                                && installation.provider == issue.provider
                        }))
                });
                if index.installations.len() != before {
                    repaired += 1;
                }
            }
            InstallHealthKind::DiskOrphan => {
                if let Ok(_metadata) = fs::symlink_metadata(&issue.target_path) {
                    if path_is_symlink_link(&issue.target_path) {
                        remove_directory_symlink(&issue.target_path)?;
                        repaired += 1;
                    }
                }
            }
            InstallHealthKind::NotSymlink => {}
        }
    }
    crate::library_repository::sync_installation_statuses(index);
    let remaining = collect_health_issues(index, paths);
    Ok((
        repaired,
        InstallHealthReport {
            issues: remaining,
            repaired,
        },
    ))
}

pub fn is_rebuildable(issue: &InstallHealthIssue) -> bool {
    match issue.kind {
        InstallHealthKind::MissingTarget
        | InstallHealthKind::BrokenLink
        | InstallHealthKind::SourceMismatch => issue.library_skill_id.is_some(),
        InstallHealthKind::DiskOrphan => true,
        InstallHealthKind::NotSymlink | InstallHealthKind::IndexOrphan => false,
    }
}
