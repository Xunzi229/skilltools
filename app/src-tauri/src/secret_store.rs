//! OS keychain storage for sensitive settings (translate API key).
//!
//! Under `cfg(test)` uses an in-memory map so unit tests do not depend on
//! platform credential stores.

use crate::error::AppError;

const SERVICE: &str = "com.skilltools.manager";
const TRANSLATE_API_KEY_ACCOUNT: &str = "translate_api_key";

#[cfg(test)]
mod memory {
    use std::collections::HashMap;
    use std::sync::Mutex;

    use super::{AppError, SERVICE, TRANSLATE_API_KEY_ACCOUNT};

    static STORE: Mutex<Option<HashMap<(String, String), String>>> = Mutex::new(None);

    fn with_store<R>(f: impl FnOnce(&mut HashMap<(String, String), String>) -> R) -> R {
        let mut guard = STORE.lock().expect("secret store mutex");
        if guard.is_none() {
            *guard = Some(HashMap::new());
        }
        f(guard.as_mut().expect("initialized"))
    }

    pub fn get_translate_api_key() -> Result<Option<String>, AppError> {
        Ok(with_store(|store| {
            store
                .get(&(SERVICE.to_owned(), TRANSLATE_API_KEY_ACCOUNT.to_owned()))
                .cloned()
        }))
    }

    pub fn set_translate_api_key(api_key: &str) -> Result<(), AppError> {
        let trimmed = api_key.trim();
        if trimmed.is_empty() {
            return delete_translate_api_key();
        }
        with_store(|store| {
            store.insert(
                (SERVICE.to_owned(), TRANSLATE_API_KEY_ACCOUNT.to_owned()),
                trimmed.to_owned(),
            );
        });
        Ok(())
    }

    pub fn delete_translate_api_key() -> Result<(), AppError> {
        with_store(|store| {
            store.remove(&(SERVICE.to_owned(), TRANSLATE_API_KEY_ACCOUNT.to_owned()));
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

    use super::{AppError, SERVICE, TRANSLATE_API_KEY_ACCOUNT};

    fn map_error(error: keyring::Error) -> AppError {
        AppError::Settings {
            message: format!("系统密钥环操作失败：{error}"),
        }
    }

    fn entry() -> Result<Entry, AppError> {
        Entry::new(SERVICE, TRANSLATE_API_KEY_ACCOUNT).map_err(map_error)
    }

    pub fn get_translate_api_key() -> Result<Option<String>, AppError> {
        match entry()?.get_password() {
            Ok(value) => {
                let trimmed = value.trim().to_owned();
                if trimmed.is_empty() {
                    Ok(None)
                } else {
                    Ok(Some(trimmed))
                }
            }
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(error) => Err(map_error(error)),
        }
    }

    pub fn set_translate_api_key(api_key: &str) -> Result<(), AppError> {
        let trimmed = api_key.trim();
        if trimmed.is_empty() {
            return delete_translate_api_key();
        }
        entry()?.set_password(trimmed).map_err(map_error)
    }

    pub fn delete_translate_api_key() -> Result<(), AppError> {
        match entry()?.delete_credential() {
            Ok(()) => Ok(()),
            Err(keyring::Error::NoEntry) => Ok(()),
            Err(error) => Err(map_error(error)),
        }
    }
}

#[cfg(test)]
pub use memory::{
    clear_for_test, delete_translate_api_key, get_translate_api_key, set_translate_api_key,
    test_lock,
};
#[cfg(not(test))]
pub use keychain::{delete_translate_api_key, get_translate_api_key, set_translate_api_key};
