use std::fs::{self, File, OpenOptions};

use fs2::FileExt;

use crate::error::AppError;
use crate::paths::AppPaths;

pub(crate) struct AppTransactionGuard {
    file: File,
}

impl Drop for AppTransactionGuard {
    fn drop(&mut self) {
        let _ = FileExt::unlock(&self.file);
    }
}

pub(crate) fn lock_app_transaction(paths: &AppPaths) -> Result<AppTransactionGuard, AppError> {
    paths.assert_allowed(&paths.app_data_dir)?;
    fs::create_dir_all(&paths.app_data_dir)?;
    let lock_path = paths.app_data_dir.join(".skill-manager.transaction.lock");
    paths.assert_allowed(&lock_path)?;
    let file = OpenOptions::new()
        .read(true)
        .write(true)
        .create(true)
        .truncate(false)
        .open(lock_path)?;
    FileExt::lock_exclusive(&file)?;
    Ok(AppTransactionGuard { file })
}
