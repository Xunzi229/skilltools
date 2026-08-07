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
    #[error("备份校验失败：{id}")]
    BackupVerificationFailed { id: String },
    #[error("未找到备份：{id}")]
    BackupNotFound { id: String },
    #[error("备份索引操作失败：{message}")]
    BackupIndex { message: String },
    #[error("事务失败且回滚失败：原始错误：{original_error}；回滚错误：{rollback_error}")]
    RollbackFailed {
        original_error: String,
        rollback_error: String,
    },
}

impl From<std::io::Error> for AppError {
    fn from(error: std::io::Error) -> Self {
        Self::Io {
            message: error.to_string(),
        }
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
}
