mod batch;
pub mod backup_repository;
pub mod commands;
pub mod error;
mod external_open;
mod fs_ops;
pub mod git_ops;
mod json_store;
pub mod library_repository;
pub mod model;
pub mod paths;
pub mod settings;
pub mod skill_files;
pub mod skill_repository;
mod transaction_lock;
mod zip_ops;

use backup_repository::BackupRepository;
use commands::AppState;
use library_repository::LibraryRepository;
use paths::AppPaths;
use skill_repository::SkillRepository;
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .setup(|app| {
            let app_data_dir = app.path().app_data_dir()?;
            let home_dir = app.path().home_dir()?;
            let paths = AppPaths::discover(app_data_dir, home_dir.clone());
            let settings = settings::load_settings(&paths.app_data_dir).unwrap_or_default();
            if let Err(error) = BackupRepository::new(paths.clone()).cleanup_backups(
                settings.backup_retention_days,
                settings.backup_max_count,
            ) {
                eprintln!("启动时清理备份失败：{error}");
            }
            let managed = app.manage(AppState {
                skills: SkillRepository::new(paths.clone()).into(),
                backups: BackupRepository::new(paths.clone()).into(),
                library: LibraryRepository::new(paths).into(),
                home_dir,
            });
            if !managed {
                return Err(std::io::Error::other("应用状态初始化失败").into());
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::scan_skills,
            commands::get_skill_detail,
            commands::list_skill_tree,
            commands::read_skill_file,
            commands::write_skill_file,
            commands::list_external_editors,
            commands::open_skill_file_external,
            commands::open_library_skill_file_external,
            commands::pause_skill,
            commands::resume_skill,
            commands::create_backup,
            commands::list_backups,
            commands::restore_backup,
            commands::delete_backup,
            commands::cleanup_backups,
            commands::delete_skill,
            commands::add_local_project,
            commands::add_git_project,
            commands::pull_git_project,
            commands::remove_project,
            commands::list_projects,
            commands::list_library_skills,
            commands::get_library_skill_detail,
            commands::list_library_skill_tree,
            commands::read_library_skill_file,
            commands::write_library_skill_file,
            commands::install_skill,
            commands::uninstall_skill,
            commands::list_installations,
            commands::scan_install_health,
            commands::repair_installations,
            commands::migrate_provider_skill,
            commands::list_tags,
            commands::create_tag,
            commands::rename_tag,
            commands::update_tag,
            commands::delete_tag,
            commands::set_skill_tags,
            commands::list_groups,
            commands::create_group,
            commands::rename_group,
            commands::update_group_order,
            commands::delete_group,
            commands::set_skill_group,
            commands::get_settings,
            commands::save_settings,
            commands::get_app_paths,
            commands::reveal_path,
            commands::export_library_skill_zip,
            commands::export_project_zip,
            commands::import_skill_zip,
            commands::batch_pause_skills,
            commands::batch_resume_skills,
            commands::batch_backup_skills,
            commands::batch_delete_skills,
            commands::batch_install_skills,
            commands::batch_uninstall_skills,
            commands::batch_set_skill_group,
            commands::batch_add_skill_tags,
            commands::batch_migrate_provider_skills,
        ])
        .run(tauri::generate_context!())
        .unwrap_or_else(|error| eprintln!("应用运行失败：{error}"));
}
