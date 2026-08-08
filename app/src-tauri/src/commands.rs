use std::sync::Mutex;

use serde::Serialize;
use tauri::State;

use crate::backup_repository::BackupRepository;
use crate::error::AppError;
use crate::library_repository::LibraryRepository;
use crate::model::{
    BackupReason, BackupRecord, FileContent, FileNode, LibrarySkillDetail, LibrarySkillSummary,
    Project, Provider, ScanResult, SkillDetail, SkillGroup, SkillInstallation, Tag,
};
use crate::skill_files::{list_skill_tree as build_skill_tree, read_skill_file as load_skill_file};
use crate::skill_repository::SkillRepository;

pub struct AppState {
    pub skills: Mutex<SkillRepository>,
    pub backups: Mutex<BackupRepository>,
    pub library: Mutex<LibraryRepository>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CommandError {
    pub code: &'static str,
    pub message: String,
}

pub(crate) fn map_app_error(error: AppError) -> CommandError {
    let code = match &error {
        AppError::PathOutsideManagedRoots { .. } => "PATH_OUTSIDE_MANAGED_ROOTS",
        AppError::TargetConflict { .. } => "TARGET_CONFLICT",
        AppError::SkillNotFound { .. } => "SKILL_NOT_FOUND",
        AppError::SkillAlreadyPaused { .. } => "SKILL_ALREADY_PAUSED",
        AppError::PauseIndex { .. } => "PAUSE_INDEX",
        AppError::MoveRollback { .. } => "MOVE_ROLLBACK",
        AppError::Io { .. } => "IO",
        AppError::BackupVerificationFailed { .. } => "BACKUP_VERIFICATION_FAILED",
        AppError::BackupNotFound { .. } => "BACKUP_NOT_FOUND",
        AppError::BackupIndex { .. } => "BACKUP_INDEX",
        AppError::LibraryIndex { .. } => "LIBRARY_INDEX",
        AppError::InvalidProjectPath { .. } => "INVALID_PROJECT_PATH",
        AppError::InvalidGitUrl { .. } => "INVALID_GIT_URL",
        AppError::GitNotFound => "GIT_NOT_FOUND",
        AppError::GitOperation { .. } => "GIT_OPERATION",
        AppError::ProjectNotFound { .. } => "PROJECT_NOT_FOUND",
        AppError::ProjectAlreadyExists { .. } => "PROJECT_ALREADY_EXISTS",
        AppError::LibrarySkillNotFound { .. } => "LIBRARY_SKILL_NOT_FOUND",
        AppError::TaxonomyNameConflict { .. } => "TAXONOMY_NAME_CONFLICT",
        AppError::TagNotFound { .. } => "TAG_NOT_FOUND",
        AppError::GroupNotFound { .. } => "GROUP_NOT_FOUND",
        AppError::RollbackFailed { .. } => "ROLLBACK_FAILED",
    };
    CommandError {
        code,
        message: error.to_string(),
    }
}

fn state_lock_error() -> CommandError {
    CommandError {
        code: "STATE_LOCK_POISONED",
        message: "应用状态锁已损坏".to_string(),
    }
}

fn scan_skills_with_state(state: &AppState) -> Result<ScanResult, CommandError> {
    state
        .skills
        .lock()
        .map_err(|_| state_lock_error())?
        .scan_with_warnings()
        .map_err(map_app_error)
}

fn get_skill_detail_with_state(
    state: &AppState,
    skill_id: String,
) -> Result<SkillDetail, CommandError> {
    state
        .skills
        .lock()
        .map_err(|_| state_lock_error())?
        .detail(&skill_id)
        .map_err(map_app_error)
}

fn list_skill_tree_with_state(
    state: &AppState,
    skill_id: String,
) -> Result<Vec<FileNode>, CommandError> {
    let repository = state.skills.lock().map_err(|_| state_lock_error())?;
    build_skill_tree(&repository, &skill_id).map_err(map_app_error)
}

fn read_skill_file_with_state(
    state: &AppState,
    skill_id: String,
    relative_path: String,
) -> Result<FileContent, CommandError> {
    let repository = state.skills.lock().map_err(|_| state_lock_error())?;
    load_skill_file(&repository, &skill_id, &relative_path).map_err(map_app_error)
}

fn pause_skill_with_state(state: &AppState, skill_id: String) -> Result<SkillDetail, CommandError> {
    state
        .skills
        .lock()
        .map_err(|_| state_lock_error())?
        .pause(&skill_id)
        .map_err(map_app_error)
}

fn resume_skill_with_state(
    state: &AppState,
    skill_id: String,
) -> Result<SkillDetail, CommandError> {
    state
        .skills
        .lock()
        .map_err(|_| state_lock_error())?
        .resume(&skill_id)
        .map_err(map_app_error)
}

fn create_backup_with_state(
    state: &AppState,
    skill_id: String,
) -> Result<BackupRecord, CommandError> {
    state
        .backups
        .lock()
        .map_err(|_| state_lock_error())?
        .create_backup(&skill_id, BackupReason::Manual)
        .map_err(map_app_error)
}

fn list_backups_with_state(state: &AppState) -> Result<Vec<BackupRecord>, CommandError> {
    state
        .backups
        .lock()
        .map_err(|_| state_lock_error())?
        .list_backups()
        .map_err(map_app_error)
}

fn restore_backup_with_state(
    state: &AppState,
    backup_id: String,
) -> Result<SkillDetail, CommandError> {
    state
        .backups
        .lock()
        .map_err(|_| state_lock_error())?
        .restore_backup(&backup_id)
        .map_err(map_app_error)
}

fn delete_skill_with_state(
    state: &AppState,
    skill_id: String,
) -> Result<BackupRecord, CommandError> {
    state
        .backups
        .lock()
        .map_err(|_| state_lock_error())?
        .delete_skill(&skill_id)
        .map_err(map_app_error)
}

#[tauri::command]
pub fn scan_skills(state: State<'_, AppState>) -> Result<ScanResult, CommandError> {
    scan_skills_with_state(state.inner())
}

#[tauri::command]
pub fn get_skill_detail(
    state: State<'_, AppState>,
    skill_id: String,
) -> Result<SkillDetail, CommandError> {
    get_skill_detail_with_state(state.inner(), skill_id)
}

#[tauri::command]
pub fn list_skill_tree(
    state: State<'_, AppState>,
    skill_id: String,
) -> Result<Vec<FileNode>, CommandError> {
    list_skill_tree_with_state(state.inner(), skill_id)
}

#[tauri::command]
pub fn read_skill_file(
    state: State<'_, AppState>,
    skill_id: String,
    relative_path: String,
) -> Result<FileContent, CommandError> {
    read_skill_file_with_state(state.inner(), skill_id, relative_path)
}

#[tauri::command]
pub fn pause_skill(
    state: State<'_, AppState>,
    skill_id: String,
) -> Result<SkillDetail, CommandError> {
    pause_skill_with_state(state.inner(), skill_id)
}

#[tauri::command]
pub fn resume_skill(
    state: State<'_, AppState>,
    skill_id: String,
) -> Result<SkillDetail, CommandError> {
    resume_skill_with_state(state.inner(), skill_id)
}

#[tauri::command]
pub fn create_backup(
    state: State<'_, AppState>,
    skill_id: String,
) -> Result<BackupRecord, CommandError> {
    create_backup_with_state(state.inner(), skill_id)
}

#[tauri::command]
pub fn list_backups(state: State<'_, AppState>) -> Result<Vec<BackupRecord>, CommandError> {
    list_backups_with_state(state.inner())
}

#[tauri::command]
pub fn restore_backup(
    state: State<'_, AppState>,
    backup_id: String,
) -> Result<SkillDetail, CommandError> {
    restore_backup_with_state(state.inner(), backup_id)
}

#[tauri::command]
pub fn delete_skill(
    state: State<'_, AppState>,
    skill_id: String,
) -> Result<BackupRecord, CommandError> {
    delete_skill_with_state(state.inner(), skill_id)
}

#[tauri::command]
pub fn add_local_project(
    state: State<'_, AppState>,
    path: String,
) -> Result<Project, CommandError> {
    state
        .library
        .lock()
        .map_err(|_| state_lock_error())?
        .add_local_project(path)
        .map_err(map_app_error)
}

#[tauri::command]
pub fn add_git_project(state: State<'_, AppState>, url: String) -> Result<Project, CommandError> {
    state
        .library
        .lock()
        .map_err(|_| state_lock_error())?
        .add_git_project(&url)
        .map_err(map_app_error)
}

#[tauri::command]
pub fn pull_git_project(
    state: State<'_, AppState>,
    project_id: String,
) -> Result<Project, CommandError> {
    state
        .library
        .lock()
        .map_err(|_| state_lock_error())?
        .pull_git_project(&project_id)
        .map_err(map_app_error)
}

#[tauri::command]
pub fn remove_project(state: State<'_, AppState>, project_id: String) -> Result<(), CommandError> {
    state
        .library
        .lock()
        .map_err(|_| state_lock_error())?
        .remove_project(&project_id)
        .map_err(map_app_error)
}

#[tauri::command]
pub fn list_projects(state: State<'_, AppState>) -> Result<Vec<Project>, CommandError> {
    state
        .library
        .lock()
        .map_err(|_| state_lock_error())?
        .list_projects()
        .map_err(map_app_error)
}

#[tauri::command]
pub fn list_library_skills(
    state: State<'_, AppState>,
) -> Result<Vec<LibrarySkillSummary>, CommandError> {
    state
        .library
        .lock()
        .map_err(|_| state_lock_error())?
        .list_library_skills()
        .map_err(map_app_error)
}

#[tauri::command]
pub fn get_library_skill_detail(
    state: State<'_, AppState>,
    id: String,
) -> Result<LibrarySkillDetail, CommandError> {
    state
        .library
        .lock()
        .map_err(|_| state_lock_error())?
        .get_library_skill_detail(&id)
        .map_err(map_app_error)
}

#[tauri::command]
pub fn list_library_skill_tree(
    state: State<'_, AppState>,
    id: String,
) -> Result<Vec<FileNode>, CommandError> {
    state
        .library
        .lock()
        .map_err(|_| state_lock_error())?
        .list_library_skill_tree(&id)
        .map_err(map_app_error)
}

#[tauri::command]
pub fn read_library_skill_file(
    state: State<'_, AppState>,
    id: String,
    relative_path: String,
) -> Result<FileContent, CommandError> {
    state
        .library
        .lock()
        .map_err(|_| state_lock_error())?
        .read_library_skill_file(&id, &relative_path)
        .map_err(map_app_error)
}

#[tauri::command]
pub fn install_skill(
    state: State<'_, AppState>,
    library_skill_id: String,
    provider: Provider,
) -> Result<SkillInstallation, CommandError> {
    state
        .library
        .lock()
        .map_err(|_| state_lock_error())?
        .install_skill(&library_skill_id, provider)
        .map_err(map_app_error)
}

#[tauri::command]
pub fn uninstall_skill(
    state: State<'_, AppState>,
    library_skill_id: String,
    provider: Provider,
) -> Result<(), CommandError> {
    state
        .library
        .lock()
        .map_err(|_| state_lock_error())?
        .uninstall_skill(&library_skill_id, provider)
        .map_err(map_app_error)
}

#[tauri::command]
pub fn list_installations(
    state: State<'_, AppState>,
) -> Result<Vec<SkillInstallation>, CommandError> {
    state
        .library
        .lock()
        .map_err(|_| state_lock_error())?
        .list_installations()
        .map_err(map_app_error)
}

#[tauri::command]
pub fn list_tags(state: State<'_, AppState>) -> Result<Vec<Tag>, CommandError> {
    state
        .library
        .lock()
        .map_err(|_| state_lock_error())?
        .list_tags()
        .map_err(map_app_error)
}

#[tauri::command]
pub fn create_tag(
    state: State<'_, AppState>,
    name: String,
    color: Option<String>,
) -> Result<Tag, CommandError> {
    state
        .library
        .lock()
        .map_err(|_| state_lock_error())?
        .create_tag(name, color)
        .map_err(map_app_error)
}

#[tauri::command]
pub fn rename_tag(
    state: State<'_, AppState>,
    id: String,
    name: String,
) -> Result<Tag, CommandError> {
    state
        .library
        .lock()
        .map_err(|_| state_lock_error())?
        .rename_tag(&id, name)
        .map_err(map_app_error)
}

#[tauri::command]
pub fn delete_tag(state: State<'_, AppState>, id: String) -> Result<(), CommandError> {
    state
        .library
        .lock()
        .map_err(|_| state_lock_error())?
        .delete_tag(&id)
        .map_err(map_app_error)
}

#[tauri::command]
pub fn set_skill_tags(
    state: State<'_, AppState>,
    skill_id: String,
    tag_ids: Vec<String>,
) -> Result<LibrarySkillSummary, CommandError> {
    state
        .library
        .lock()
        .map_err(|_| state_lock_error())?
        .set_skill_tags(&skill_id, tag_ids)
        .map_err(map_app_error)
}

#[tauri::command]
pub fn list_groups(state: State<'_, AppState>) -> Result<Vec<SkillGroup>, CommandError> {
    state
        .library
        .lock()
        .map_err(|_| state_lock_error())?
        .list_groups()
        .map_err(map_app_error)
}

#[tauri::command]
pub fn create_group(
    state: State<'_, AppState>,
    name: String,
    order: i32,
) -> Result<SkillGroup, CommandError> {
    state
        .library
        .lock()
        .map_err(|_| state_lock_error())?
        .create_group(name, order)
        .map_err(map_app_error)
}

#[tauri::command]
pub fn rename_group(
    state: State<'_, AppState>,
    id: String,
    name: String,
) -> Result<SkillGroup, CommandError> {
    state
        .library
        .lock()
        .map_err(|_| state_lock_error())?
        .rename_group(&id, name)
        .map_err(map_app_error)
}

#[tauri::command]
pub fn update_group_order(
    state: State<'_, AppState>,
    id: String,
    order: i32,
) -> Result<SkillGroup, CommandError> {
    state
        .library
        .lock()
        .map_err(|_| state_lock_error())?
        .update_group_order(&id, order)
        .map_err(map_app_error)
}

#[tauri::command]
pub fn delete_group(state: State<'_, AppState>, id: String) -> Result<(), CommandError> {
    state
        .library
        .lock()
        .map_err(|_| state_lock_error())?
        .delete_group(&id)
        .map_err(map_app_error)
}

#[tauri::command]
pub fn set_skill_group(
    state: State<'_, AppState>,
    skill_id: String,
    group_id: Option<String>,
) -> Result<LibrarySkillSummary, CommandError> {
    state
        .library
        .lock()
        .map_err(|_| state_lock_error())?
        .set_skill_group(&skill_id, group_id)
        .map_err(map_app_error)
}

#[cfg(test)]
mod tests {
    use std::fs;
    use std::sync::Arc;

    use tempfile::{tempdir, TempDir};

    use super::{
        create_backup_with_state, delete_skill_with_state, get_skill_detail_with_state,
        list_skill_tree_with_state, map_app_error, pause_skill_with_state,
        read_skill_file_with_state, scan_skills_with_state, AppState,
    };
    use crate::backup_repository::BackupRepository;
    use crate::error::AppError;
    use crate::library_repository::LibraryRepository;
    use crate::model::{BackupReason, SkillStatus};
    use crate::paths::AppPaths;
    use crate::skill_repository::SkillRepository;

    fn state_with_skill(name: &str) -> (TempDir, AppState) {
        let base = tempdir().unwrap();
        let paths = AppPaths::for_test(base.path());
        let skill_dir = paths.skill_roots[0].path.join(name);
        fs::create_dir_all(&skill_dir).unwrap();
        fs::write(
            skill_dir.join("SKILL.md"),
            format!("---\nname: {name}\ndescription: 测试 Skill\n---\n正文"),
        )
        .unwrap();
        let state = AppState {
            skills: SkillRepository::new(paths.clone()).into(),
            backups: BackupRepository::new(paths.clone()).into(),
            library: LibraryRepository::new(paths).into(),
        };
        (base, state)
    }

    #[test]
    fn maps_every_app_error_to_stable_code_and_chinese_message() {
        let cases = [
            (
                AppError::PathOutsideManagedRoots {
                    path: "/tmp/outside".into(),
                },
                "PATH_OUTSIDE_MANAGED_ROOTS",
                "路径不在允许的管理目录内：/tmp/outside",
            ),
            (
                AppError::TargetConflict {
                    path: "/tmp/target".into(),
                },
                "TARGET_CONFLICT",
                "目标位置已存在：/tmp/target",
            ),
            (
                AppError::SkillNotFound {
                    id: "missing".into(),
                },
                "SKILL_NOT_FOUND",
                "未找到 Skill：missing",
            ),
            (
                AppError::SkillAlreadyPaused {
                    id: "paused".into(),
                },
                "SKILL_ALREADY_PAUSED",
                "Skill 已暂停：paused",
            ),
            (
                AppError::PauseIndex {
                    message: "损坏".into(),
                },
                "PAUSE_INDEX",
                "暂停索引操作失败：损坏",
            ),
            (
                AppError::MoveRollback {
                    message: "失败".into(),
                },
                "MOVE_ROLLBACK",
                "文件移动失败且回滚失败：失败",
            ),
            (
                AppError::Io {
                    message: "磁盘错误".into(),
                },
                "IO",
                "文件操作失败：磁盘错误",
            ),
            (
                AppError::BackupVerificationFailed {
                    id: "backup".into(),
                },
                "BACKUP_VERIFICATION_FAILED",
                "备份校验失败：backup",
            ),
            (
                AppError::BackupNotFound {
                    id: "backup".into(),
                },
                "BACKUP_NOT_FOUND",
                "未找到备份：backup",
            ),
            (
                AppError::BackupIndex {
                    message: "损坏".into(),
                },
                "BACKUP_INDEX",
                "备份索引操作失败：损坏",
            ),
            (
                AppError::RollbackFailed {
                    original_error: "原始失败".into(),
                    rollback_error: "回滚失败".into(),
                },
                "ROLLBACK_FAILED",
                "事务失败且回滚失败：原始错误：原始失败；回滚错误：回滚失败",
            ),
        ];

        for (error, expected_code, expected_message) in cases {
            let payload = map_app_error(error);
            assert_eq!(payload.code, expected_code);
            assert_eq!(payload.message, expected_message);
        }

        let conflict = map_app_error(AppError::TargetConflict {
            path: "/tmp/existing".into(),
        });
        assert_eq!(conflict.code, "TARGET_CONFLICT");
        assert!(conflict.message.starts_with("目标位置已存在"));
    }

    #[test]
    fn poisoned_repository_mutex_returns_state_lock_error() {
        let (_base, state) = state_with_skill("poisoned");
        let state = Arc::new(state);
        let thread_state = Arc::clone(&state);
        std::thread::spawn(move || {
            let _guard = thread_state.skills.lock().unwrap();
            panic!("poison mutex");
        })
        .join()
        .unwrap_err();

        let error = scan_skills_with_state(&state).unwrap_err();

        assert_eq!(error.code, "STATE_LOCK_POISONED");
        assert_eq!(error.message, "应用状态锁已损坏");
    }

    #[test]
    fn skill_commands_delegate_scan_detail_and_pause() {
        let (_base, state) = state_with_skill("delegated");

        let skills = scan_skills_with_state(&state).unwrap();
        assert_eq!(skills.skills.len(), 1);
        let id = skills.skills[0].id.clone();

        let detail = get_skill_detail_with_state(&state, id.clone()).unwrap();
        assert_eq!(detail.name, "delegated");

        let paused = pause_skill_with_state(&state, id).unwrap();
        assert_eq!(paused.status, SkillStatus::Paused);
    }

    #[test]
    fn file_commands_delegate_tree_and_preview() {
        let (_base, state) = state_with_skill("files");
        let id = scan_skills_with_state(&state).unwrap().skills[0].id.clone();

        let tree = list_skill_tree_with_state(&state, id.clone()).unwrap();
        let preview = read_skill_file_with_state(&state, id, "SKILL.md".into()).unwrap();

        assert_eq!(tree.len(), 1);
        assert_eq!(tree[0].relative_path, "SKILL.md");
        assert_eq!(preview.media_type, "markdown");
        assert!(preview.content.unwrap().contains("测试 Skill"));
    }

    #[test]
    fn backup_commands_delegate_manual_backup_and_delete() {
        let (_base, state) = state_with_skill("protected");
        let id = scan_skills_with_state(&state).unwrap().skills[0].id.clone();

        let manual = create_backup_with_state(&state, id.clone()).unwrap();
        assert_eq!(manual.reason, BackupReason::Manual);

        let before_delete = delete_skill_with_state(&state, id).unwrap();
        assert_eq!(before_delete.reason, BackupReason::BeforeDelete);
    }

    #[test]
    fn repository_errors_are_returned_as_command_errors() {
        let base = tempdir().unwrap();
        let paths = AppPaths::for_test(base.path());
        let state = AppState {
            skills: SkillRepository::new(paths.clone()).into(),
            backups: BackupRepository::new(paths.clone()).into(),
            library: LibraryRepository::new(paths).into(),
        };

        let error = get_skill_detail_with_state(&state, "missing".into()).unwrap_err();

        assert_eq!(error.code, "SKILL_NOT_FOUND");
        assert_eq!(error.message, "未找到 Skill：missing");
    }
}
