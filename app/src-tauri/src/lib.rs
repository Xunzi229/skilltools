pub mod backup_repository;
pub mod commands;
pub mod error;
mod fs_ops;
mod json_store;
pub mod model;
pub mod paths;
pub mod skill_files;
pub mod skill_repository;
mod transaction_lock;

use backup_repository::BackupRepository;
use commands::AppState;
use paths::AppPaths;
use skill_repository::SkillRepository;
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            let app_data_dir = app.path().app_data_dir()?;
            let home_dir = app.path().home_dir()?;
            let paths = AppPaths::discover(app_data_dir, home_dir);
            let managed = app.manage(AppState {
                skills: SkillRepository::new(paths.clone()).into(),
                backups: BackupRepository::new(paths).into(),
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
            commands::pause_skill,
            commands::resume_skill,
            commands::create_backup,
            commands::list_backups,
            commands::restore_backup,
            commands::delete_skill,
        ])
        .run(tauri::generate_context!())
        .unwrap_or_else(|error| eprintln!("应用运行失败：{error}"));
}
