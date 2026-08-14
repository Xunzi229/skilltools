use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::error::AppError;
use crate::json_store::{read_json_value, write_json_value};
use crate::model::Provider;
use crate::secret_store;

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

fn default_preview_font_family() -> String {
    "Microsoft YaHei".to_string()
}

fn default_preview_font_size() -> u32 {
    14
}

/// Translation settings. Target language is used by Google public translate;
/// Base URL / API Key / model are the OpenAI-compatible fallback (and smart grouping).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct TranslateSettings {
    /// e.g. https://api.openai.com/v1
    #[serde(default)]
    pub base_url: String,
    #[serde(default)]
    pub api_key: String,
    #[serde(default)]
    pub model: String,
    /// e.g. 中文 / English / 日本語
    #[serde(default)]
    pub target_lang: String,
}

impl TranslateSettings {
    pub fn is_configured(&self) -> bool {
        !self.base_url.trim().is_empty()
            && !self.api_key.trim().is_empty()
            && !self.model.trim().is_empty()
            && !self.target_lang.trim().is_empty()
    }
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
    /// Preview font family name, e.g. "Microsoft YaHei"
    #[serde(default = "default_preview_font_family")]
    pub preview_font_family: String,
    #[serde(default = "default_preview_font_size")]
    pub preview_font_size: u32,
    #[serde(default)]
    pub translate: TranslateSettings,
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            theme: ThemePreference::default(),
            skill_root_overrides: SkillRootOverrides::default(),
            backup_retention_days: default_backup_retention_days(),
            backup_max_count: default_backup_max_count(),
            preview_font_family: default_preview_font_family(),
            preview_font_size: default_preview_font_size(),
            translate: TranslateSettings::default(),
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
    let mut settings = read_json_value(
        &settings_path(app_data_dir),
        AppSettings::default,
        |message| AppError::Settings { message },
    )?;
    hydrate_translate_api_key(&mut settings, app_data_dir)?;
    Ok(settings)
}

pub fn save_settings(app_data_dir: &Path, settings: &AppSettings) -> Result<(), AppError> {
    std::fs::create_dir_all(app_data_dir)?;
    let mut persisted = settings.clone();
    persist_translate_api_key(&mut persisted)?;
    write_json_value(&settings_path(app_data_dir), &persisted, |message| {
        AppError::Settings { message }
    })
}

/// Load API key from OS keychain into the in-memory settings object.
/// Migrates any legacy plaintext key still present in settings.json.
fn hydrate_translate_api_key(
    settings: &mut AppSettings,
    app_data_dir: &Path,
) -> Result<(), AppError> {
    let legacy = settings.translate.api_key.trim().to_owned();
    let stored = secret_store::get_translate_api_key()?;

    match (stored, legacy.is_empty()) {
        (Some(key), _) => {
            settings.translate.api_key = key;
            if !legacy.is_empty() {
                // Remove plaintext copy from disk once keychain has the secret.
                let mut persisted = settings.clone();
                persisted.translate.api_key.clear();
                write_json_value(&settings_path(app_data_dir), &persisted, |message| {
                    AppError::Settings { message }
                })?;
            }
        }
        (None, false) => {
            secret_store::set_translate_api_key(&legacy)?;
            settings.translate.api_key = legacy;
            let mut persisted = settings.clone();
            persisted.translate.api_key.clear();
            write_json_value(&settings_path(app_data_dir), &persisted, |message| {
                AppError::Settings { message }
            })?;
        }
        (None, true) => {
            settings.translate.api_key.clear();
        }
    }
    Ok(())
}

fn persist_translate_api_key(settings: &mut AppSettings) -> Result<(), AppError> {
    let key = settings.translate.api_key.trim().to_owned();
    if key.is_empty() {
        secret_store::delete_translate_api_key()?;
    } else {
        secret_store::set_translate_api_key(&key)?;
    }
    // Never write the raw API key into settings.json.
    settings.translate.api_key.clear();
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn round_trips_settings() {
        let _guard = crate::secret_store::test_lock();
        crate::secret_store::clear_for_test();
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
            preview_font_family: "Consolas".into(),
            preview_font_size: 16,
            translate: TranslateSettings {
                base_url: "https://api.openai.com/v1".into(),
                api_key: "sk-test".into(),
                model: "gpt-4o-mini".into(),
                target_lang: "中文".into(),
            },
        };
        save_settings(base.path(), &settings).unwrap();
        let on_disk = std::fs::read_to_string(settings_path(base.path())).unwrap();
        assert!(
            !on_disk.contains("sk-test"),
            "api key must not be persisted in settings.json: {on_disk}"
        );
        let loaded = load_settings(base.path()).unwrap();
        assert_eq!(loaded, settings);
        assert_eq!(loaded.translate.api_key, "sk-test");
    }

    #[test]
    fn migrates_legacy_plaintext_api_key_into_secret_store() {
        let _guard = crate::secret_store::test_lock();
        crate::secret_store::clear_for_test();
        let base = tempdir().unwrap();
        let mut legacy = AppSettings::default();
        legacy.translate.api_key = "sk-legacy".into();
        // Simulate old installs that wrote the key into JSON.
        write_json_value(&settings_path(base.path()), &legacy, |message| {
            AppError::Settings { message }
        })
        .unwrap();

        let loaded = load_settings(base.path()).unwrap();
        assert_eq!(loaded.translate.api_key, "sk-legacy");
        let on_disk = std::fs::read_to_string(settings_path(base.path())).unwrap();
        assert!(!on_disk.contains("sk-legacy"));
        assert_eq!(
            crate::secret_store::get_translate_api_key().unwrap().as_deref(),
            Some("sk-legacy")
        );
    }
}
