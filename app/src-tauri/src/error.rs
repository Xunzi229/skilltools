#[derive(Debug, thiserror::Error)]
pub enum AppError {
    #[error("路径不在允许的管理目录内：{path}")]
    PathOutsideManagedRoots { path: String },
    #[error("目标位置已存在：{path}")]
    TargetConflict { path: String },
    #[error("未找到 Skill：{id}")]
    SkillNotFound { id: String },
    #[error("Skill 已暂停：{id}")]
    SkillAlreadyPaused { id: String },
    #[error("暂停索引操作失败：{message}")]
    PauseIndex { message: String },
    #[error("文件移动失败且回滚失败：{message}")]
    MoveRollback { message: String },
    #[error("文件操作失败：{message}")]
    Io { message: String },
    /// 跨设备/跨卷（Unix EXDEV / Windows ERROR_NOT_SAME_DEVICE），调用方可改走 copy。
    #[error("跨设备操作：{message}")]
    CrossDevice { message: String },
    #[error("备份校验失败：{id}")]
    BackupVerificationFailed { id: String },
    #[error("未找到备份：{id}")]
    BackupNotFound { id: String },
    #[error("备份索引操作失败：{message}")]
    BackupIndex { message: String },
    #[error("库索引操作失败：{message}")]
    LibraryIndex { message: String },
    #[error("项目路径无效或不可读：{path}")]
    InvalidProjectPath { path: String },
    #[error("Git 地址不受支持：{url}")]
    InvalidGitUrl { url: String },
    #[error("未找到 git 可执行文件")]
    GitNotFound,
    #[error("Git 操作失败：{message}")]
    GitOperation { message: String },
    #[error("未找到项目：{id}")]
    ProjectNotFound { id: String },
    #[error("项目已存在：{value}")]
    ProjectAlreadyExists { value: String },
    #[error("未找到库 Skill：{id}")]
    LibrarySkillNotFound { id: String },
    #[error("{kind}名称已存在：{name}")]
    TaxonomyNameConflict { kind: &'static str, name: String },
    #[error("未找到标签：{id}")]
    TagNotFound { id: String },
    #[error("未找到分组：{id}")]
    GroupNotFound { id: String },
    #[error("事务失败且回滚失败：原始错误：{original_error}；回滚错误：{rollback_error}")]
    RollbackFailed {
        original_error: String,
        rollback_error: String,
    },
    #[error("设置操作失败：{message}")]
    Settings { message: String },
    #[error("ZIP 操作失败：{message}")]
    Zip { message: String },
    #[error("翻译预览失败：{message}")]
    Translate { message: String },
}

impl From<std::io::Error> for AppError {
    fn from(error: std::io::Error) -> Self {
        if is_cross_device_io_error(&error) {
            return Self::CrossDevice {
                message: error.to_string(),
            };
        }
        Self::Io {
            message: error.to_string(),
        }
    }
}

pub(crate) fn is_cross_device_io_error(error: &std::io::Error) -> bool {
    #[cfg(unix)]
    {
        error.raw_os_error() == Some(libc::EXDEV)
    }
    #[cfg(windows)]
    {
        // ERROR_NOT_SAME_DEVICE
        error.raw_os_error() == Some(17)
    }
    #[cfg(not(any(unix, windows)))]
    {
        let _ = error;
        false
    }
}

#[cfg(test)]
mod tests {
    use super::AppError;

    #[test]
    fn io_error_maps_to_app_io_error() {
        let error = std::io::Error::other("disk unavailable");

        let app_error = AppError::from(error);

        assert_eq!(app_error.to_string(), "文件操作失败：disk unavailable");
    }

    #[cfg(unix)]
    #[test]
    fn exdev_maps_to_cross_device() {
        let error = std::io::Error::from_raw_os_error(libc::EXDEV);
        let app_error = AppError::from(error);
        assert!(matches!(app_error, AppError::CrossDevice { .. }));
    }

    #[cfg(windows)]
    #[test]
    fn not_same_device_maps_to_cross_device() {
        let error = std::io::Error::from_raw_os_error(17);
        let app_error = AppError::from(error);
        assert!(matches!(app_error, AppError::CrossDevice { .. }));
    }
}
