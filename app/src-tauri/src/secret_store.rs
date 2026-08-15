//! OS keychain storage for sensitive settings (translate API key, proxy password).
//!
//! Under `cfg(test)` uses an in-memory map so unit tests do not depend on
//! platform credential stores.

use crate::error::AppError;

const SERVICE: &str = "com.skilltools.manager";
const TRANSLATE_API_KEY_ACCOUNT: &str = "translate_api_key";
const PROXY_PASSWORD_ACCOUNT: &str = "proxy_password";

#[cfg(test)]
mod memory {
    use std::collections::HashMap;
    use std::sync::Mutex;

    use super::{AppError, SERVICE};

    static STORE: Mutex<Option<HashMap<(String, String), String>>> = Mutex::new(None);

    fn with_store<R>(f: impl FnOnce(&mut HashMap<(String, String), String>) -> R) -> R {
        let mut guard = STORE.lock().expect("secret store mutex");
        if guard.is_none() {
            *guard = Some(HashMap::new());
        }
        f(guard.as_mut().expect("initialized"))
    }

    pub fn get_secret(account: &str) -> Result<Option<String>, AppError> {
        Ok(with_store(|store| {
            store
                .get(&(SERVICE.to_owned(), account.to_owned()))
                .cloned()
        }))
    }

    pub fn set_secret(account: &str, value: &str) -> Result<(), AppError> {
        let trimmed = value.trim();
        if trimmed.is_empty() {
            return delete_secret(account);
        }
        with_store(|store| {
            store.insert(
                (SERVICE.to_owned(), account.to_owned()),
                trimmed.to_owned(),
            );
        });
        Ok(())
    }

    pub fn delete_secret(account: &str) -> Result<(), AppError> {
        with_store(|store| {
            store.remove(&(SERVICE.to_owned(), account.to_owned()));
        });
        Ok(())
    }

    pub fn clear_for_test() {
        with_store(|store| store.clear());
    }

    pub fn test_lock() -> std::sync::MutexGuard<'static, ()> {
        static LOCK: Mutex<()> = Mutex::new(());
        LOCK.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
    }
}

#[cfg(not(test))]
mod keychain {
    use keyring::Entry;

    use super::{AppError, SERVICE};

    fn map_error(error: keyring::Error) -> AppError {
        AppError::Settings {
            message: format!("系统密钥环操作失败：{error}"),
        }
    }

    fn entry(account: &str) -> Result<Entry, AppError> {
        Entry::new(SERVICE, account).map_err(map_error)
    }

    pub fn get_secret(account: &str) -> Result<Option<String>, AppError> {
        match entry(account)?.get_password() {
            Ok(value) => {
                let trimmed = value.trim().to_owned();
                if trimmed.is_empty() {
                    Ok(None)
                } else {
                    Ok(Some(trimmed))
                }
            }
            Err(keyring::Error::NoEntry) => Ok(None),
            // Linux 无 gnome-keyring / Secret Service 时仍允许打开应用。
            Err(keyring::Error::NoStorageAccess(_)) | Err(keyring::Error::PlatformFailure(_)) => {
                Ok(None)
            }
            Err(error) => Err(map_error(error)),
        }
    }

    fn map_write_error(error: keyring::Error) -> AppError {
        match error {
            keyring::Error::NoStorageAccess(_) | keyring::Error::PlatformFailure(_) => {
                AppError::Settings {
                    message: "当前系统没有可用的密钥环（Linux 需 gnome-keyring / KWallet 等 Secret Service）。翻译 API Key 与代理密码无法安全保存。".into(),
                }
            }
            other => map_error(other),
        }
    }

    pub fn set_secret(account: &str, value: &str) -> Result<(), AppError> {
        let trimmed = value.trim();
        if trimmed.is_empty() {
            return delete_secret(account);
        }
        entry(account)?.set_password(trimmed).map_err(map_write_error)
    }

    pub fn delete_secret(account: &str) -> Result<(), AppError> {
        match entry(account)?.delete_credential() {
            Ok(()) => Ok(()),
            Err(keyring::Error::NoEntry) => Ok(()),
            Err(keyring::Error::NoStorageAccess(_)) | Err(keyring::Error::PlatformFailure(_)) => {
                Ok(())
            }
            Err(error) => Err(map_error(error)),
        }
    }
}

#[cfg(test)]
use memory::{delete_secret, get_secret, set_secret};
#[cfg(not(test))]
use keychain::{delete_secret, get_secret, set_secret};

#[cfg(test)]
pub use memory::{clear_for_test, test_lock};

pub fn get_translate_api_key() -> Result<Option<String>, AppError> {
    get_secret(TRANSLATE_API_KEY_ACCOUNT)
}

pub fn set_translate_api_key(api_key: &str) -> Result<(), AppError> {
    set_secret(TRANSLATE_API_KEY_ACCOUNT, api_key)
}

pub fn delete_translate_api_key() -> Result<(), AppError> {
    delete_secret(TRANSLATE_API_KEY_ACCOUNT)
}

pub fn get_proxy_password() -> Result<Option<String>, AppError> {
    get_secret(PROXY_PASSWORD_ACCOUNT)
}

pub fn set_proxy_password(password: &str) -> Result<(), AppError> {
    set_secret(PROXY_PASSWORD_ACCOUNT, password)
}

pub fn delete_proxy_password() -> Result<(), AppError> {
    delete_secret(PROXY_PASSWORD_ACCOUNT)
}
