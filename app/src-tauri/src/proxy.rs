use std::env;
use std::ffi::OsString;
use std::process::Command;
use std::sync::{Mutex, OnceLock, RwLock};
use std::time::Duration;

use reqwest::blocking::Client;

use crate::error::AppError;
use crate::settings::ProxySettings;

fn current_lock() -> &'static RwLock<ProxySettings> {
    static CURRENT: OnceLock<RwLock<ProxySettings>> = OnceLock::new();
    CURRENT.get_or_init(|| RwLock::new(ProxySettings::default()))
}

struct EnvSnapshot {
    all_proxy: Option<OsString>,
    http_proxy: Option<OsString>,
    https_proxy: Option<OsString>,
    #[cfg(not(windows))]
    all_proxy_lc: Option<OsString>,
    #[cfg(not(windows))]
    http_proxy_lc: Option<OsString>,
    #[cfg(not(windows))]
    https_proxy_lc: Option<OsString>,
}

static ORIGINAL_ENV: OnceLock<EnvSnapshot> = OnceLock::new();
static APPLY_LOCK: Mutex<()> = Mutex::new(());

fn snapshot_original_env() -> &'static EnvSnapshot {
    ORIGINAL_ENV.get_or_init(|| EnvSnapshot {
        all_proxy: env::var_os("ALL_PROXY"),
        http_proxy: env::var_os("HTTP_PROXY"),
        https_proxy: env::var_os("HTTPS_PROXY"),
        #[cfg(not(windows))]
        all_proxy_lc: env::var_os("all_proxy"),
        #[cfg(not(windows))]
        http_proxy_lc: env::var_os("http_proxy"),
        #[cfg(not(windows))]
        https_proxy_lc: env::var_os("https_proxy"),
    })
}

fn set_var(key: &str, value: &str) {
    // Applied only during app startup / settings save.
    #[allow(unused_unsafe)]
    unsafe {
        env::set_var(key, value);
    }
}

fn remove_var(key: &str) {
    #[allow(unused_unsafe)]
    unsafe {
        env::remove_var(key);
    }
}

fn restore_var(key: &str, value: Option<&OsString>) {
    match value {
        Some(value) => {
            #[allow(unused_unsafe)]
            unsafe {
                env::set_var(key, value);
            }
        }
        None => remove_var(key),
    }
}

fn apply_process_env(url: Option<&str>) {
    let _guard = APPLY_LOCK.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
    let original = snapshot_original_env();
    if let Some(url) = url {
        set_var("ALL_PROXY", url);
        set_var("HTTP_PROXY", url);
        set_var("HTTPS_PROXY", url);
        #[cfg(not(windows))]
        {
            set_var("all_proxy", url);
            set_var("http_proxy", url);
            set_var("https_proxy", url);
        }
        return;
    }
    restore_var("ALL_PROXY", original.all_proxy.as_ref());
    restore_var("HTTP_PROXY", original.http_proxy.as_ref());
    restore_var("HTTPS_PROXY", original.https_proxy.as_ref());
    #[cfg(not(windows))]
    {
        restore_var("all_proxy", original.all_proxy_lc.as_ref());
        restore_var("http_proxy", original.http_proxy_lc.as_ref());
        restore_var("https_proxy", original.https_proxy_lc.as_ref());
    }
}

/// Persist the current proxy into process env (updater) and in-memory state (reqwest/git).
pub fn apply_runtime(settings: &ProxySettings) {
    if let Ok(mut guard) = current_lock().write() {
        *guard = settings.clone();
    }
    apply_process_env(settings.env_url().as_deref());
}

fn current_settings() -> ProxySettings {
    current_lock()
        .read()
        .map(|guard| guard.clone())
        .unwrap_or_default()
}

pub fn apply_to_command(command: &mut Command) {
    if let Some(url) = current_settings().env_url() {
        command.env("ALL_PROXY", &url);
        command.env("HTTP_PROXY", &url);
        command.env("HTTPS_PROXY", &url);
        #[cfg(not(windows))]
        {
            command.env("all_proxy", &url);
            command.env("http_proxy", &url);
            command.env("https_proxy", &url);
        }
    }
}

pub fn blocking_client(timeout: Duration) -> Result<Client, AppError> {
    let mut builder = Client::builder().timeout(timeout);
    let proxy = current_settings();
    if let Some(url) = proxy.base_url() {
        let mut reqwest_proxy = reqwest::Proxy::all(&url).map_err(|error| AppError::Settings {
            message: format!("代理地址无效：{error}"),
        })?;
        if proxy.auth_enabled && !proxy.username.trim().is_empty() {
            reqwest_proxy = reqwest_proxy.basic_auth(proxy.username.trim(), proxy.password.as_str());
        }
        builder = builder.proxy(reqwest_proxy);
    }
    builder.build().map_err(|error| AppError::Settings {
        message: format!("创建 HTTP 客户端失败：{error}"),
    })
}
