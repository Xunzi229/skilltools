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

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub enum ProxyType {
    Http,
    Https,
    #[default]
    Socks5,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProxySettings {
    /// Custom proxy master switch. Off = auto-detect system/env proxy.
    #[serde(default)]
    pub enabled: bool,
    #[serde(default)]
    pub proxy_type: ProxyType,
    #[serde(default)]
    pub host: String,
    #[serde(default)]
    pub port: u16,
    #[serde(default)]
    pub auth_enabled: bool,
    #[serde(default)]
    pub username: String,
    #[serde(default)]
    pub password: String,
}

impl Default for ProxySettings {
    fn default() -> Self {
        Self {
            enabled: false,
            proxy_type: ProxyType::default(),
            host: String::new(),
            port: 0,
            auth_enabled: false,
            username: String::new(),
            password: String::new(),
        }
    }
}

impl ProxySettings {
    pub fn validate(&self) -> Result<(), AppError> {
        if !self.enabled {
            return Ok(());
        }
        if self.host.trim().is_empty() {
            return Err(AppError::Settings {
                message: "请填写代理服务器地址".into(),
            });
        }
        if self.port == 0 {
            return Err(AppError::Settings {
                message: "请填写有效的代理端口（1–65535）".into(),
            });
        }
        if self.auth_enabled && self.username.trim().is_empty() {
            return Err(AppError::Settings {
                message: "已启用代理认证，请填写用户名".into(),
            });
        }
        Ok(())
    }

    fn scheme(&self) -> &'static str {
        match self.proxy_type {
            ProxyType::Http => "http",
            ProxyType::Https => "https",
            // socks5h: resolve DNS through the proxy (typical for local clash/v2ray).
            ProxyType::Socks5 => "socks5h",
        }
    }

    /// `scheme://host:port` without credentials (safe to log).
    pub fn base_url(&self) -> Option<String> {
        if !self.enabled {
            return None;
        }
        let host = self.host.trim();
        if host.is_empty() || self.port == 0 {
            return None;
        }
        Some(format!("{}://{}:{}", self.scheme(), host, self.port))
    }

    /// Env-var URL, including encoded userinfo when auth is on. Do not log.
    pub fn env_url(&self) -> Option<String> {
        let base = self.base_url()?;
        if !self.auth_enabled {
            return Some(base);
        }
        let user = self.username.trim();
        if user.is_empty() {
            return Some(base);
        }
        let scheme = self.scheme();
        let rest = base.strip_prefix(&format!("{scheme}://"))?;
        Some(format!(
            "{scheme}://{}:{}@{rest}",
            encode_userinfo(user),
            encode_userinfo(&self.password)
        ))
    }
}

fn encode_userinfo(value: &str) -> String {
    let mut out = String::new();
    for &byte in value.as_bytes() {
        match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                out.push(byte as char);
            }
            _ => out.push_str(&format!("%{byte:02X}")),
        }
    }
    out
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
    #[serde(default)]
    pub proxy: ProxySettings,
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
            proxy: ProxySettings::default(),
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
    hydrate_proxy_password(&mut settings, app_data_dir)?;
    Ok(settings)
}

pub fn save_settings(app_data_dir: &Path, settings: &AppSettings) -> Result<(), AppError> {
    std::fs::create_dir_all(app_data_dir)?;
    let mut persisted = settings.clone();
    persist_translate_api_key(&mut persisted)?;
    persist_proxy_password(&mut persisted)?;
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
                strip_secrets_for_disk(&mut persisted);
                write_json_value(&settings_path(app_data_dir), &persisted, |message| {
                    AppError::Settings { message }
                })?;
            }
        }
        (None, false) => {
            secret_store::set_translate_api_key(&legacy)?;
            settings.translate.api_key = legacy;
            let mut persisted = settings.clone();
            strip_secrets_for_disk(&mut persisted);
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

fn strip_secrets_for_disk(settings: &mut AppSettings) {
    settings.translate.api_key.clear();
    settings.proxy.password.clear();
}

fn hydrate_proxy_password(
    settings: &mut AppSettings,
    app_data_dir: &Path,
) -> Result<(), AppError> {
    let legacy = settings.proxy.password.trim().to_owned();
    let stored = secret_store::get_proxy_password()?;

    match (stored, legacy.is_empty()) {
        (Some(password), _) => {
            settings.proxy.password = password;
            if !legacy.is_empty() {
                let mut persisted = settings.clone();
                strip_secrets_for_disk(&mut persisted);
                write_json_value(&settings_path(app_data_dir), &persisted, |message| {
                    AppError::Settings { message }
                })?;
            }
        }
        (None, false) => {
            secret_store::set_proxy_password(&legacy)?;
            settings.proxy.password = legacy;
            let mut persisted = settings.clone();
            strip_secrets_for_disk(&mut persisted);
            write_json_value(&settings_path(app_data_dir), &persisted, |message| {
                AppError::Settings { message }
            })?;
        }
        (None, true) => {
            settings.proxy.password.clear();
        }
    }
    Ok(())
}

fn persist_proxy_password(settings: &mut AppSettings) -> Result<(), AppError> {
    let password = settings.proxy.password.trim().to_owned();
    if password.is_empty() {
        secret_store::delete_proxy_password()?;
    } else {
        secret_store::set_proxy_password(&password)?;
    }
    settings.proxy.password.clear();
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
            proxy: ProxySettings {
                enabled: true,
                proxy_type: ProxyType::Socks5,
                host: "127.0.0.1".into(),
                port: 11080,
                auth_enabled: true,
                username: "alice".into(),
                password: "p@ss".into(),
            },
        };
        save_settings(base.path(), &settings).unwrap();
        let on_disk = std::fs::read_to_string(settings_path(base.path())).unwrap();
        assert!(
            !on_disk.contains("sk-test"),
            "api key must not be persisted in settings.json: {on_disk}"
        );
        assert!(
            !on_disk.contains("p@ss"),
            "proxy password must not be persisted in settings.json: {on_disk}"
        );
        let loaded = load_settings(base.path()).unwrap();
        assert_eq!(loaded, settings);
        assert_eq!(loaded.translate.api_key, "sk-test");
        assert_eq!(loaded.proxy.password, "p@ss");
    }

    #[test]
    fn proxy_env_url_encodes_userinfo_and_uses_socks5h() {
        let proxy = ProxySettings {
            enabled: true,
            proxy_type: ProxyType::Socks5,
            host: "127.0.0.1".into(),
            port: 11080,
            auth_enabled: true,
            username: "u:sr".into(),
            password: "p@ss".into(),
        };
        assert_eq!(proxy.base_url().as_deref(), Some("socks5h://127.0.0.1:11080"));
        assert_eq!(
            proxy.env_url().as_deref(),
            Some("socks5h://u%3Asr:p%40ss@127.0.0.1:11080")
        );
    }

    #[test]
    fn disabled_proxy_has_no_url() {
        let mut proxy = ProxySettings {
            enabled: false,
            proxy_type: ProxyType::Http,
            host: "127.0.0.1".into(),
            port: 8080,
            auth_enabled: false,
            username: String::new(),
            password: String::new(),
        };
        assert_eq!(proxy.base_url(), None);
        proxy.enabled = true;
        assert_eq!(proxy.base_url().as_deref(), Some("http://127.0.0.1:8080"));
    }

    #[test]
    fn rejects_enabled_proxy_without_host() {
        let proxy = ProxySettings {
            enabled: true,
            ..ProxySettings::default()
        };
        assert!(proxy.validate().is_err());
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

    #[test]
    fn migrates_legacy_plaintext_proxy_password_into_secret_store() {
        let _guard = crate::secret_store::test_lock();
        crate::secret_store::clear_for_test();
        let base = tempdir().unwrap();
        let mut legacy = AppSettings::default();
        legacy.proxy.password = "proxy-secret".into();
        write_json_value(&settings_path(base.path()), &legacy, |message| {
            AppError::Settings { message }
        })
        .unwrap();

        let loaded = load_settings(base.path()).unwrap();
        assert_eq!(loaded.proxy.password, "proxy-secret");
        let on_disk = std::fs::read_to_string(settings_path(base.path())).unwrap();
        assert!(!on_disk.contains("proxy-secret"));
        assert_eq!(
            crate::secret_store::get_proxy_password().unwrap().as_deref(),
            Some("proxy-secret")
        );
    }

    #[test]
    fn missing_proxy_field_uses_default() {
        let _guard = crate::secret_store::test_lock();
        crate::secret_store::clear_for_test();
        let base = tempdir().unwrap();
        std::fs::write(settings_path(base.path()), r#"{"theme":"dark"}"#).unwrap();
        let loaded = load_settings(base.path()).unwrap();
        assert_eq!(loaded.theme, ThemePreference::Dark);
        assert_eq!(loaded.proxy, ProxySettings::default());
    }
}
