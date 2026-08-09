use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::error::AppError;
use crate::json_store::{read_json_value, write_json_value};
use crate::model::Provider;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub enum ThemePreference {
    #[default]
    Light,
    Dark,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct SkillRootOverrides {
    pub cursor: Option<PathBuf>,
    pub claude: Option<PathBuf>,
    pub codex: Option<PathBuf>,
}

impl SkillRootOverrides {
    pub fn for_provider(&self, provider: Provider) -> Option<&PathBuf> {
        match provider {
            Provider::Cursor => self.cursor.as_ref(),
            Provider::Claude => self.claude.as_ref(),
            Provider::Codex => self.codex.as_ref(),
        }
    }

    pub fn set_provider(&mut self, provider: Provider, path: Option<PathBuf>) {
        match provider {
            Provider::Cursor => self.cursor = path,
            Provider::Claude => self.claude = path,
            Provider::Codex => self.codex = path,
        }
    }
}

fn default_backup_retention_days() -> Option<u32> {
    Some(30)
}

fn default_backup_max_count() -> Option<u32> {
    Some(200)
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppSettings {
    pub theme: ThemePreference,
    #[serde(default)]
    pub skill_root_overrides: SkillRootOverrides,
    /// None = never expire by age
    #[serde(default = "default_backup_retention_days")]
    pub backup_retention_days: Option<u32>,
    /// None = no count cap
    #[serde(default = "default_backup_max_count")]
    pub backup_max_count: Option<u32>,
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            theme: ThemePreference::default(),
            skill_root_overrides: SkillRootOverrides::default(),
            backup_retention_days: default_backup_retention_days(),
            backup_max_count: default_backup_max_count(),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppPathsInfo {
    pub app_data_dir: PathBuf,
    pub disabled_dir: PathBuf,
    pub backups_dir: PathBuf,
    pub library_dir: PathBuf,
    pub cursor_skills: PathBuf,
    pub claude_skills: PathBuf,
    pub codex_skills: PathBuf,
    pub default_cursor_skills: PathBuf,
    pub default_claude_skills: PathBuf,
    pub default_codex_skills: PathBuf,
}

pub fn settings_path(app_data_dir: &Path) -> PathBuf {
    app_data_dir.join("settings.json")
}

pub fn load_settings(app_data_dir: &Path) -> Result<AppSettings, AppError> {
    read_json_value(
        &settings_path(app_data_dir),
        AppSettings::default,
        |message| AppError::Settings { message },
    )
}

pub fn save_settings(app_data_dir: &Path, settings: &AppSettings) -> Result<(), AppError> {
    std::fs::create_dir_all(app_data_dir)?;
    write_json_value(&settings_path(app_data_dir), settings, |message| {
        AppError::Settings { message }
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn round_trips_settings() {
        let base = tempdir().unwrap();
        let settings = AppSettings {
            theme: ThemePreference::Dark,
            skill_root_overrides: SkillRootOverrides {
                cursor: Some(base.path().join("custom-cursor")),
                claude: None,
                codex: None,
            },
            backup_retention_days: Some(30),
            backup_max_count: Some(200),
        };
        save_settings(base.path(), &settings).unwrap();
        let loaded = load_settings(base.path()).unwrap();
        assert_eq!(loaded, settings);
    }
}
