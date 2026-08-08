use std::path::Path;
use std::process::{Command, Output};

use chrono::{DateTime, Utc};

use crate::error::AppError;

pub fn validate_git_url(url: &str) -> Result<(), AppError> {
    let valid_scheme = ["https://", "git://", "ssh://"]
        .iter()
        .any(|prefix| url.starts_with(prefix) && url.len() > prefix.len());
    let valid_scp = url
        .strip_prefix("git@")
        .and_then(|rest| rest.split_once(':'))
        .is_some_and(|(host, path)| !host.is_empty() && !path.is_empty());
    if valid_scheme || valid_scp {
        Ok(())
    } else {
        Err(AppError::InvalidGitUrl {
            url: url.to_owned(),
        })
    }
}

/// 从 Git URL 提取展示名：`用户名/项目名`（去掉 `.git`）。
pub fn project_name_from_git_url(url: &str) -> String {
    let path = if let Some(rest) = url.strip_prefix("git@") {
        rest.split_once(':').map(|(_, path)| path).unwrap_or(rest)
    } else {
        let rest = url
            .strip_prefix("https://")
            .or_else(|| url.strip_prefix("git://"))
            .or_else(|| url.strip_prefix("ssh://"))
            .unwrap_or(url);
        rest.find('/')
            .map(|index| &rest[index + 1..])
            .unwrap_or(rest)
    };
    let path = path.trim_matches('/').trim_end_matches(".git");
    let parts: Vec<&str> = path.split('/').filter(|part| !part.is_empty()).collect();
    match parts.as_slice() {
        [.., owner, repo] => format!("{owner}/{repo}"),
        [repo] => (*repo).to_owned(),
        [] => "project".to_owned(),
    }
}

pub(crate) fn clone_repository(url: &str, destination: &Path) -> Result<(), AppError> {
    validate_git_url(url)?;
    run_git(["clone", "--", url], Some(destination))
}

pub(crate) fn pull_fast_forward(repository: &Path) -> Result<(), AppError> {
    run_git(["-C", path_text(repository)?, "pull", "--ff-only"], None)
}

pub(crate) fn latest_commit_time(repository: &Path) -> Result<Option<DateTime<Utc>>, AppError> {
    let path = path_text(repository)?;
    let output = Command::new("git")
        .args(["-C", path, "log", "-1", "--format=%cI"])
        .output()
        .map_err(|error| {
            if error.kind() == std::io::ErrorKind::NotFound {
                AppError::GitNotFound
            } else {
                AppError::GitOperation {
                    message: error.to_string(),
                }
            }
        })?;
    if !output.status.success() {
        return Ok(None);
    }
    let text = String::from_utf8_lossy(&output.stdout).trim().to_owned();
    if text.is_empty() {
        return Ok(None);
    }
    DateTime::parse_from_rfc3339(&text)
        .map(|value| Some(value.with_timezone(&Utc)))
        .map_err(|error| AppError::GitOperation {
            message: format!("无法解析提交时间：{error}"),
        })
}

fn path_text(path: &Path) -> Result<&str, AppError> {
    path.to_str().ok_or_else(|| AppError::GitOperation {
        message: format!("Git 路径不是有效 UTF-8：{}", path.display()),
    })
}

fn run_git<const N: usize>(args: [&str; N], destination: Option<&Path>) -> Result<(), AppError> {
    let mut command = Command::new("git");
    command.args(args);
    if let Some(destination) = destination {
        command.arg(destination);
    }
    let output = command.output().map_err(|error| {
        if error.kind() == std::io::ErrorKind::NotFound {
            AppError::GitNotFound
        } else {
            AppError::GitOperation {
                message: error.to_string(),
            }
        }
    })?;
    ensure_success(output)
}

fn ensure_success(output: Output) -> Result<(), AppError> {
    if output.status.success() {
        return Ok(());
    }
    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_owned();
    Err(AppError::GitOperation {
        message: if stderr.is_empty() {
            format!("git 退出码 {}", output.status)
        } else {
            stderr
        },
    })
}

#[cfg(test)]
mod tests {
    use super::{project_name_from_git_url, validate_git_url};

    #[test]
    fn accepts_only_supported_git_url_forms() {
        for url in [
            "https://example.com/repo.git",
            "git://example.com/repo.git",
            "ssh://git@example.com/repo.git",
            "git@example.com:team/repo.git",
        ] {
            assert!(validate_git_url(url).is_ok(), "{url}");
        }
        for url in [
            "http://example.com/repo.git",
            "file:///tmp/repo",
            "/tmp/repo",
            "git@host",
            "https://",
        ] {
            assert!(validate_git_url(url).is_err(), "{url}");
        }
    }

    #[test]
    fn derives_owner_and_repo_display_name() {
        assert_eq!(
            project_name_from_git_url("git@github.com:mattpocock/skills.git"),
            "mattpocock/skills"
        );
        assert_eq!(
            project_name_from_git_url("https://github.com/mattpocock/skills.git"),
            "mattpocock/skills"
        );
        assert_eq!(
            project_name_from_git_url("ssh://git@github.com/team/skills.git"),
            "team/skills"
        );
        assert_eq!(
            project_name_from_git_url("https://example.com/skills.git"),
            "skills"
        );
    }
}
