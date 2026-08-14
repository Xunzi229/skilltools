use std::path::PathBuf;
use std::sync::Mutex;

use serde::Serialize;
use tauri::{AppHandle, Manager, State};

use crate::backup_repository::BackupRepository;
use crate::batch;
use crate::error::AppError;
use crate::external_open::{self, ExternalEditor};
use crate::group_suggest::{self, GroupSuggestion};
use crate::library_repository::LibraryRepository;
use crate::model::{
    BackupReason, BackupRecord, BatchResult, FileContent, FileNode, InstallHealthReport,
    InstallOverview, InstallPreset, LibrarySkillDetail, LibrarySkillSummary, MigrateResult,
    Project, ProjectPullResult, Provider, ScanResult, SkillDetail, SkillGroup, SkillInstallation,
    Tag,
};
use crate::paths::AppPaths;
use crate::settings::{self, AppPathsInfo, AppSettings};
use crate::skill_files::{
    list_skill_tree as build_skill_tree, read_skill_file as load_skill_file,
    resolve_skill_file_path, write_skill_file as save_skill_file,
};
use crate::skill_metadata::{self, FrontmatterValidation};
use crate::skill_repository::SkillRepository;
use crate::translate::{self, TranslatePreview, TranslateSkillSource};

pub struct AppState {
    pub skills: Mutex<SkillRepository>,
    pub backups: Mutex<BackupRepository>,
    pub library: Mutex<LibraryRepository>,
    pub home_dir: PathBuf,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CommandError {
    pub code: &'static str,
    pub message: String,
}

impl std::fmt::Display for CommandError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.message)
    }
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
        AppError::CrossDevice { .. } => "CROSS_DEVICE",
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
        AppError::Settings { .. } => "SETTINGS",
        AppError::Zip { .. } => "ZIP",
        AppError::Translate { .. } => "TRANSLATE",
    };
    CommandError {
        code,
        message: error.to_string(),
    }
}

fn apply_paths(state: &AppState, paths: AppPaths) -> Result<(), CommandError> {
    state
        .skills
        .lock()
        .map_err(|_| state_lock_error())?
        .set_paths(paths.clone());
    state
        .backups
        .lock()
        .map_err(|_| state_lock_error())?
        .set_paths(paths.clone());
    state
        .library
        .lock()
        .map_err(|_| state_lock_error())?
        .set_paths(paths);
    Ok(())
}

fn current_paths(state: &AppState) -> Result<AppPaths, CommandError> {
    Ok(state
        .skills
        .lock()
        .map_err(|_| state_lock_error())?
        .paths()
        .clone())
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
pub fn list_external_editors() -> Vec<ExternalEditor> {
    external_open::list_external_editors()
}

#[tauri::command]
pub fn open_skill_file_external(
    state: State<'_, AppState>,
    skill_id: String,
    relative_path: String,
    editor_id: String,
) -> Result<(), CommandError> {
    let detail = state
        .skills
        .lock()
        .map_err(|_| state_lock_error())?
        .detail(&skill_id)
        .map_err(map_app_error)?;
    let root = detail.resolved_path.unwrap_or(detail.current_path);
    let path = resolve_skill_file_path(&root, &relative_path).map_err(map_app_error)?;
    external_open::open_path_with(&path, &editor_id).map_err(map_app_error)
}

#[tauri::command]
pub fn open_library_skill_file_external(
    state: State<'_, AppState>,
    id: String,
    relative_path: String,
    editor_id: String,
) -> Result<(), CommandError> {
    let root = state
        .library
        .lock()
        .map_err(|_| state_lock_error())?
        .get_library_skill_detail(&id)
        .map_err(map_app_error)?
        .summary
        .absolute_path;
    let path = resolve_skill_file_path(&root, &relative_path).map_err(map_app_error)?;
    external_open::open_path_with(&path, &editor_id).map_err(map_app_error)
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
pub async fn add_git_project(app: AppHandle, url: String) -> Result<Project, CommandError> {
    // clone + 扫描放到 blocking 线程，避免占住 async runtime
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<AppState>();
        let result = {
            let library = state.library.lock().map_err(|_| state_lock_error())?;
            library.add_git_project(&url).map_err(map_app_error)
        };
        result
    })
    .await
    .map_err(|error| CommandError {
        code: "TASK_JOIN",
        message: format!("添加 Git 项目任务失败：{error}"),
    })?
}

#[tauri::command]
pub fn pull_git_project(
    state: State<'_, AppState>,
    project_id: String,
) -> Result<ProjectPullResult, CommandError> {
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
pub fn get_install_overview(state: State<'_, AppState>) -> Result<InstallOverview, CommandError> {
    let skills = state
        .skills
        .lock()
        .map_err(|_| state_lock_error())?
        .scan()
        .map_err(map_app_error)?;
    state
        .library
        .lock()
        .map_err(|_| state_lock_error())?
        .get_install_overview(&skills)
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
    color: Option<String>,
) -> Result<SkillGroup, CommandError> {
    state
        .library
        .lock()
        .map_err(|_| state_lock_error())?
        .create_group(name, color)
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
pub fn update_group(
    state: State<'_, AppState>,
    id: String,
    name: String,
    color: Option<String>,
) -> Result<SkillGroup, CommandError> {
    state
        .library
        .lock()
        .map_err(|_| state_lock_error())?
        .update_group(&id, name, color)
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

#[tauri::command]
pub fn update_tag(
    state: State<'_, AppState>,
    id: String,
    name: String,
    color: Option<String>,
) -> Result<Tag, CommandError> {
    state
        .library
        .lock()
        .map_err(|_| state_lock_error())?
        .update_tag(&id, name, color)
        .map_err(map_app_error)
}

#[tauri::command]
pub fn delete_backup(state: State<'_, AppState>, backup_id: String) -> Result<(), CommandError> {
    state
        .backups
        .lock()
        .map_err(|_| state_lock_error())?
        .delete_backup(&backup_id)
        .map_err(map_app_error)
}

#[tauri::command]
pub fn write_skill_file(
    state: State<'_, AppState>,
    skill_id: String,
    relative_path: String,
    content: String,
) -> Result<(), CommandError> {
    let repository = state.skills.lock().map_err(|_| state_lock_error())?;
    save_skill_file(&repository, &skill_id, &relative_path, &content).map_err(map_app_error)
}

#[tauri::command]
pub fn write_library_skill_file(
    state: State<'_, AppState>,
    id: String,
    relative_path: String,
    content: String,
) -> Result<(), CommandError> {
    state
        .library
        .lock()
        .map_err(|_| state_lock_error())?
        .write_library_skill_file(&id, &relative_path, &content)
        .map_err(map_app_error)
}

#[tauri::command]
pub fn get_settings(state: State<'_, AppState>) -> Result<AppSettings, CommandError> {
    let paths = current_paths(state.inner())?;
    settings::load_settings(&paths.app_data_dir).map_err(map_app_error)
}

#[tauri::command]
pub fn list_system_fonts() -> Result<Vec<String>, CommandError> {
    crate::system_fonts::list_system_font_families().map_err(map_app_error)
}

#[tauri::command]
pub fn save_settings(
    state: State<'_, AppState>,
    next: AppSettings,
) -> Result<AppSettings, CommandError> {
    let paths = current_paths(state.inner())?;
    settings::save_settings(&paths.app_data_dir, &next).map_err(map_app_error)?;
    let rebuilt = AppPaths::discover_with_overrides(
        paths.app_data_dir.clone(),
        state.home_dir.clone(),
        &next.skill_root_overrides,
    );
    apply_paths(state.inner(), rebuilt)?;
    Ok(next)
}

#[tauri::command]
pub fn get_app_paths(state: State<'_, AppState>) -> Result<AppPathsInfo, CommandError> {
    let paths = current_paths(state.inner())?;
    Ok(AppPathsInfo {
        app_data_dir: paths.app_data_dir.clone(),
        disabled_dir: paths.disabled_dir.clone(),
        backups_dir: paths.backups_dir.clone(),
        library_dir: paths.library_dir.clone(),
        cursor_skills: paths
            .provider_root(Provider::Cursor)
            .map_err(map_app_error)?
            .to_path_buf(),
        claude_skills: paths
            .provider_root(Provider::Claude)
            .map_err(map_app_error)?
            .to_path_buf(),
        codex_skills: paths
            .provider_root(Provider::Codex)
            .map_err(map_app_error)?
            .to_path_buf(),
        default_cursor_skills: AppPaths::default_provider_root(&state.home_dir, Provider::Cursor),
        default_claude_skills: AppPaths::default_provider_root(&state.home_dir, Provider::Claude),
        default_codex_skills: AppPaths::default_provider_root(&state.home_dir, Provider::Codex),
    })
}

/// Read-only translation preview. Never writes or modifies skill files.
/// HTTP 翻译是阻塞 I/O，必须放到 blocking 线程，避免卡住 UI。
#[tauri::command]
pub async fn preview_translate_skill(
    app: AppHandle,
    source: TranslateSkillSource,
    skill_id: String,
    relative_path: String,
) -> Result<TranslatePreview, CommandError> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<AppState>();
        let paths = current_paths(state.inner())?;
        let settings = settings::load_settings(&paths.app_data_dir).map_err(map_app_error)?;
        let skill_root = match source {
            TranslateSkillSource::Provider => {
                // detail() 已对 current_path 做过 assert_skill_access；外链 Skill 的
                // resolved_path 可能在白名单外（指向库/外部项目），与 update_skill_metadata 一致不再二次设卡。
                let detail = state
                    .skills
                    .lock()
                    .map_err(|_| state_lock_error())?
                    .detail(&skill_id)
                    .map_err(map_app_error)?;
                detail.resolved_path.unwrap_or(detail.current_path)
            }
            TranslateSkillSource::Library => {
                let detail = state
                    .library
                    .lock()
                    .map_err(|_| state_lock_error())?
                    .get_library_skill_detail(&skill_id)
                    .map_err(map_app_error)?;
                // 库 Skill 可能位于已登记的外部本地项目路径（不在 library_dir 内），
                // 与 read_library_skill_file 一致：以索引登记为准，只读预览。
                detail.summary.absolute_path
            }
        };
        let collected = translate::collect_translate_source(&skill_root, &relative_path)
            .map_err(map_app_error)?;
        translate::preview_translate_prefer_google(
            &paths.app_data_dir,
            &settings.translate,
            &collected,
            translate::translate_with_google_public,
            translate::translate_with_openai_compatible,
        )
        .map_err(map_app_error)
    })
    .await
    .map_err(|error| CommandError {
        code: "TASK_JOIN",
        message: format!("翻译任务失败：{error}"),
    })?
}

/// AI suggest groups/tags for selected library skills (description-based). Does not write.
#[tauri::command]
pub async fn suggest_skill_groups(
    app: AppHandle,
    skill_ids: Vec<String>,
    allow_new_groups: Option<bool>,
    allow_new_tags: Option<bool>,
) -> Result<Vec<GroupSuggestion>, CommandError> {
    let allow_new_groups = allow_new_groups.unwrap_or(false);
    let allow_new_tags = allow_new_tags.unwrap_or(false);
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<AppState>();
        let paths = current_paths(state.inner())?;
        let settings = settings::load_settings(&paths.app_data_dir).map_err(map_app_error)?;
        let library = state.library.lock().map_err(|_| state_lock_error())?;
        let groups = library.list_groups().map_err(map_app_error)?;
        let tags = library.list_tags().map_err(map_app_error)?;
        let group_names: Vec<String> = groups.into_iter().map(|group| group.name).collect();
        let tag_names: Vec<String> = tags.into_iter().map(|tag| tag.name).collect();
        if group_names.is_empty() && !allow_new_groups {
            return Err(CommandError {
                code: "TRANSLATE",
                message: "请先在侧栏创建至少一个分组，或开启「允许新建分组」".into(),
            });
        }

        let wanted: std::collections::HashSet<&str> =
            skill_ids.iter().map(String::as_str).collect();
        let skills = library
            .list_library_skills()
            .map_err(map_app_error)?
            .into_iter()
            .filter(|skill| wanted.contains(skill.id.as_str()))
            .map(|skill| group_suggest::GroupSuggestSkill {
                id: skill.id,
                name: skill.name,
                description: skill.description,
            })
            .collect::<Vec<_>>();
        drop(library);

        if skills.is_empty() {
            return Err(CommandError {
                code: "TRANSLATE",
                message: "未找到选中的 Skill".into(),
            });
        }

        group_suggest::suggest_groups_with_openai_compatible(
            &settings.translate,
            &skills,
            &group_names,
            &tag_names,
            group_suggest::SuggestOptions {
                allow_new_groups,
                allow_new_tags,
            },
        )
        .map_err(map_app_error)
    })
    .await
    .map_err(|error| CommandError {
        code: "TASK_JOIN",
        message: format!("分组识别任务失败：{error}"),
    })?
}

#[tauri::command]
pub fn reveal_path(path: String) -> Result<(), CommandError> {
    external_open::reveal_path(std::path::Path::new(&path)).map_err(map_app_error)
}

#[tauri::command]
pub fn export_library_skill_zip(
    state: State<'_, AppState>,
    id: String,
    dest_path: String,
) -> Result<(), CommandError> {
    state
        .library
        .lock()
        .map_err(|_| state_lock_error())?
        .export_library_skill_zip(&id, std::path::Path::new(&dest_path))
        .map_err(map_app_error)
}

#[tauri::command]
pub fn export_project_zip(
    state: State<'_, AppState>,
    project_id: String,
    dest_path: String,
) -> Result<(), CommandError> {
    state
        .library
        .lock()
        .map_err(|_| state_lock_error())?
        .export_project_zip(&project_id, std::path::Path::new(&dest_path))
        .map_err(map_app_error)
}

#[tauri::command]
pub fn import_skill_zip(
    state: State<'_, AppState>,
    zip_path: String,
) -> Result<Project, CommandError> {
    state
        .library
        .lock()
        .map_err(|_| state_lock_error())?
        .import_skill_zip(std::path::Path::new(&zip_path))
        .map_err(map_app_error)
}

#[tauri::command]
pub fn scan_install_health(
    state: State<'_, AppState>,
) -> Result<InstallHealthReport, CommandError> {
    state
        .library
        .lock()
        .map_err(|_| state_lock_error())?
        .scan_install_health()
        .map_err(map_app_error)
}

#[tauri::command]
pub fn repair_installations(
    state: State<'_, AppState>,
) -> Result<InstallHealthReport, CommandError> {
    state
        .library
        .lock()
        .map_err(|_| state_lock_error())?
        .repair_installations()
        .map_err(map_app_error)
}

#[tauri::command]
pub fn create_library_skill(
    state: State<'_, AppState>,
    name: String,
    description: String,
    project_id: Option<String>,
) -> Result<LibrarySkillSummary, CommandError> {
    state
        .library
        .lock()
        .map_err(|_| state_lock_error())?
        .create_library_skill(name, description, project_id)
        .map_err(map_app_error)
}

#[tauri::command]
pub fn rename_library_skill(
    state: State<'_, AppState>,
    skill_id: String,
    new_name: String,
) -> Result<LibrarySkillSummary, CommandError> {
    state
        .library
        .lock()
        .map_err(|_| state_lock_error())?
        .rename_library_skill(&skill_id, new_name)
        .map_err(map_app_error)
}

#[tauri::command]
pub fn delete_library_skill(
    state: State<'_, AppState>,
    skill_id: String,
) -> Result<(), CommandError> {
    state
        .library
        .lock()
        .map_err(|_| state_lock_error())?
        .delete_library_skill(&skill_id)
        .map_err(map_app_error)
}

#[tauri::command]
pub fn migrate_provider_skill(
    state: State<'_, AppState>,
    skill_id: String,
    replace_with_link: bool,
) -> Result<MigrateResult, CommandError> {
    let detail = state
        .skills
        .lock()
        .map_err(|_| state_lock_error())?
        .detail(&skill_id)
        .and_then(batch::require_active_for_migration)
        .map_err(map_app_error)?;
    state
        .library
        .lock()
        .map_err(|_| state_lock_error())?
        .migrate_provider_skill(
            &detail.name,
            detail.provider,
            &detail.current_path,
            replace_with_link,
        )
        .map_err(map_app_error)
}

#[tauri::command]
pub fn cleanup_backups(state: State<'_, AppState>) -> Result<usize, CommandError> {
    let paths = current_paths(state.inner())?;
    let settings = settings::load_settings(&paths.app_data_dir).map_err(map_app_error)?;
    state
        .backups
        .lock()
        .map_err(|_| state_lock_error())?
        .cleanup_backups(settings.backup_retention_days, settings.backup_max_count)
        .map_err(map_app_error)
}

#[tauri::command]
pub fn batch_pause_skills(
    state: State<'_, AppState>,
    skill_ids: Vec<String>,
) -> Result<BatchResult, CommandError> {
    Ok(batch::run_ids(skill_ids, |id| {
        pause_skill_with_state(state.inner(), id.to_owned()).map(|_| ())
    }))
}

#[tauri::command]
pub fn batch_resume_skills(
    state: State<'_, AppState>,
    skill_ids: Vec<String>,
) -> Result<BatchResult, CommandError> {
    Ok(batch::run_ids(skill_ids, |id| {
        resume_skill_with_state(state.inner(), id.to_owned()).map(|_| ())
    }))
}

#[tauri::command]
pub fn batch_backup_skills(
    state: State<'_, AppState>,
    skill_ids: Vec<String>,
) -> Result<BatchResult, CommandError> {
    Ok(batch::run_ids(skill_ids, |id| {
        create_backup_with_state(state.inner(), id.to_owned()).map(|_| ())
    }))
}

#[tauri::command]
pub fn batch_delete_skills(
    state: State<'_, AppState>,
    skill_ids: Vec<String>,
) -> Result<BatchResult, CommandError> {
    Ok(batch::run_ids(skill_ids, |id| {
        delete_skill_with_state(state.inner(), id.to_owned()).map(|_| ())
    }))
}

#[tauri::command]
pub fn batch_install_skills(
    state: State<'_, AppState>,
    skill_ids: Vec<String>,
    provider: Provider,
) -> Result<BatchResult, CommandError> {
    let library = state.library.lock().map_err(|_| state_lock_error())?;
    Ok(batch::batch_install_skills(&library, skill_ids, provider))
}

#[tauri::command]
pub fn batch_uninstall_skills(
    state: State<'_, AppState>,
    skill_ids: Vec<String>,
    provider: Provider,
) -> Result<BatchResult, CommandError> {
    let library = state.library.lock().map_err(|_| state_lock_error())?;
    Ok(batch::batch_uninstall_skills(&library, skill_ids, provider))
}

#[tauri::command]
pub fn batch_set_skill_group(
    state: State<'_, AppState>,
    skill_ids: Vec<String>,
    group_id: Option<String>,
) -> Result<BatchResult, CommandError> {
    let library = state.library.lock().map_err(|_| state_lock_error())?;
    Ok(batch::batch_set_skill_group(&library, skill_ids, group_id))
}

#[tauri::command]
pub fn batch_add_skill_tags(
    state: State<'_, AppState>,
    skill_ids: Vec<String>,
    tag_id: String,
) -> Result<BatchResult, CommandError> {
    let library = state.library.lock().map_err(|_| state_lock_error())?;
    Ok(batch::batch_add_skill_tags(&library, skill_ids, tag_id))
}

#[tauri::command]
pub fn batch_remove_skill_tags(
    state: State<'_, AppState>,
    skill_ids: Vec<String>,
    tag_id: String,
) -> Result<BatchResult, CommandError> {
    let library = state.library.lock().map_err(|_| state_lock_error())?;
    Ok(batch::batch_remove_skill_tags(&library, skill_ids, tag_id))
}

#[tauri::command]
pub fn batch_set_skill_tags(
    state: State<'_, AppState>,
    skill_ids: Vec<String>,
    tag_ids: Vec<String>,
) -> Result<BatchResult, CommandError> {
    let library = state.library.lock().map_err(|_| state_lock_error())?;
    Ok(batch::batch_set_skill_tags(&library, skill_ids, tag_ids))
}

#[tauri::command]
pub fn batch_migrate_provider_skills(
    state: State<'_, AppState>,
    skill_ids: Vec<String>,
    replace_with_link: bool,
) -> Result<BatchResult, CommandError> {
    let skills = state.skills.lock().map_err(|_| state_lock_error())?;
    let library = state.library.lock().map_err(|_| state_lock_error())?;
    Ok(batch::batch_migrate_provider_skills(
        &skills,
        &library,
        skill_ids,
        replace_with_link,
    ))
}

#[tauri::command]
pub fn list_install_presets(
    state: State<'_, AppState>,
) -> Result<Vec<InstallPreset>, CommandError> {
    let paths = current_paths(state.inner())?;
    crate::install_presets::list_presets(&paths.app_data_dir).map_err(map_app_error)
}

#[tauri::command]
pub fn save_install_preset(
    state: State<'_, AppState>,
    id: Option<String>,
    name: String,
    skill_ids: Vec<String>,
    providers: Vec<Provider>,
) -> Result<InstallPreset, CommandError> {
    let paths = current_paths(state.inner())?;
    crate::install_presets::save_preset(&paths.app_data_dir, id, name, skill_ids, providers)
        .map_err(map_app_error)
}

#[tauri::command]
pub fn delete_install_preset(state: State<'_, AppState>, id: String) -> Result<(), CommandError> {
    let paths = current_paths(state.inner())?;
    crate::install_presets::delete_preset(&paths.app_data_dir, &id).map_err(map_app_error)
}

#[tauri::command]
pub fn apply_install_preset(
    state: State<'_, AppState>,
    id: String,
) -> Result<BatchResult, CommandError> {
    let paths = current_paths(state.inner())?;
    let presets =
        crate::install_presets::list_presets(&paths.app_data_dir).map_err(map_app_error)?;
    let preset = presets
        .into_iter()
        .find(|preset| preset.id == id)
        .ok_or_else(|| CommandError {
            code: "SETTINGS",
            message: format!("预设不存在：{id}"),
        })?;
    let library = state.library.lock().map_err(|_| state_lock_error())?;
    Ok(batch::apply_install_preset(
        &library,
        preset.skill_ids,
        preset.providers,
    ))
}

#[tauri::command]
pub fn validate_skill_frontmatter(content: String) -> FrontmatterValidation {
    skill_metadata::validate_skill_frontmatter(&content)
}

#[tauri::command]
pub fn update_skill_metadata(
    state: State<'_, AppState>,
    skill_id: String,
    fields: std::collections::HashMap<String, String>,
) -> Result<FrontmatterValidation, CommandError> {
    let detail = state
        .skills
        .lock()
        .map_err(|_| state_lock_error())?
        .detail(&skill_id)
        .map_err(map_app_error)?;
    let path = detail.resolved_path.unwrap_or(detail.current_path);
    skill_metadata::write_skill_metadata(&path, &fields).map_err(map_app_error)
}

#[tauri::command]
pub fn update_library_skill_metadata(
    state: State<'_, AppState>,
    library_skill_id: String,
    fields: std::collections::HashMap<String, String>,
) -> Result<FrontmatterValidation, CommandError> {
    let detail = state
        .library
        .lock()
        .map_err(|_| state_lock_error())?
        .get_library_skill_detail(&library_skill_id)
        .map_err(map_app_error)?;
    skill_metadata::write_skill_metadata(&detail.summary.absolute_path, &fields)
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
        let home_dir = base.path().to_path_buf();
        let state = AppState {
            skills: SkillRepository::new(paths.clone()).into(),
            backups: BackupRepository::new(paths.clone()).into(),
            library: LibraryRepository::new(paths).into(),
            home_dir,
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
            home_dir: base.path().to_path_buf(),
        };

        let error = get_skill_detail_with_state(&state, "missing".into()).unwrap_err();

        assert_eq!(error.code, "SKILL_NOT_FOUND");
        assert_eq!(error.message, "未找到 Skill：missing");
    }
}
