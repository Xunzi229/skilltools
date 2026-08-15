use std::fs;
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
    source_repo_from_git_url(url).unwrap_or_else(|| {
        let path = git_url_path(url);
        let parts: Vec<&str> = path.split('/').filter(|part| !part.is_empty()).collect();
        match parts.as_slice() {
            [repo] => (*repo).to_owned(),
            [] => "project".to_owned(),
            _ => path.to_owned(),
        }
    })
}

/// 解析 `owner/repo`；无法得到「用户名+仓库名」时返回 None（不伪造）。
pub fn source_repo_from_git_url(url: &str) -> Option<String> {
    let path = git_url_path(url);
    let parts: Vec<&str> = path.split('/').filter(|part| !part.is_empty()).collect();
    match parts.as_slice() {
        [.., owner, repo] if !owner.is_empty() && !repo.is_empty() => {
            Some(format!("{owner}/{repo}"))
        }
        _ => None,
    }
}

/// 将 git remote URL 转为可在浏览器打开的 https 链接；无法转换时返回 None。
pub fn browse_url_from_git_url(url: &str) -> Option<String> {
    let url = url.trim();
    if url.is_empty() {
        return None;
    }
    if let Some(rest) = url.strip_prefix("https://").or_else(|| url.strip_prefix("http://")) {
        let host_path = rest.trim_matches('/').trim_end_matches(".git");
        if host_path.is_empty() || !host_path.contains('/') {
            return None;
        }
        return Some(format!("https://{host_path}"));
    }
    if let Some(rest) = url.strip_prefix("git@") {
        let (host, path) = rest.split_once(':')?;
        let path = path.trim_matches('/').trim_end_matches(".git");
        if host.is_empty() || path.is_empty() {
            return None;
        }
        return Some(format!("https://{host}/{path}"));
    }
    if let Some(rest) = url
        .strip_prefix("ssh://")
        .or_else(|| url.strip_prefix("git://"))
    {
        let rest = rest.strip_prefix("git@").unwrap_or(rest);
        let host_path = rest.trim_matches('/').trim_end_matches(".git");
        if host_path.is_empty() || !host_path.contains('/') {
            return None;
        }
        return Some(format!("https://{host_path}"));
    }
    None
}

/// 从仓库目录 `.git/config` 读取 `remote "origin"` 的 url（不伪造；失败则 None）。
pub fn read_origin_url(repository: &Path) -> Option<String> {
    let git_dir = repository.join(".git");
    let config_path = if git_dir.is_file() {
        let content = fs::read_to_string(&git_dir).ok()?;
        let gitdir = content
            .lines()
            .find_map(|line| line.strip_prefix("gitdir:").map(str::trim))?;
        let resolved = if Path::new(gitdir).is_absolute() {
            Path::new(gitdir).to_path_buf()
        } else {
            repository.join(gitdir)
        };
        resolved.join("config")
    } else if git_dir.is_dir() {
        git_dir.join("config")
    } else {
        return None;
    };
    let content = fs::read_to_string(config_path).ok()?;
    let mut in_origin = false;
    for line in content.lines() {
        let trimmed = line.trim();
        if trimmed.starts_with('[') {
            in_origin = trimmed.eq_ignore_ascii_case(r#"[remote "origin"]"#);
            continue;
        }
        if !in_origin {
            continue;
        }
        if let Some(value) = trimmed
            .strip_prefix("url")
            .map(str::trim_start)
            .and_then(|rest| rest.strip_prefix('='))
            .map(str::trim)
        {
            if !value.is_empty() {
                return Some(value.to_owned());
            }
        }
    }
    None
}

fn git_url_path(url: &str) -> String {
    let url = url.trim();
    let path = if let Some(rest) = url.strip_prefix("git@") {
        rest.split_once(':').map(|(_, path)| path).unwrap_or(rest)
    } else {
        let rest = url
            .strip_prefix("https://")
            .or_else(|| url.strip_prefix("http://"))
            .or_else(|| url.strip_prefix("git://"))
            .or_else(|| url.strip_prefix("ssh://"))
            .unwrap_or(url);
        let rest = rest.strip_prefix("git@").unwrap_or(rest);
        rest.find('/')
            .map(|index| &rest[index + 1..])
            .unwrap_or(rest)
    };
    path.trim_matches('/').trim_end_matches(".git").to_owned()
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
    let output = git_command()
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

fn git_command() -> Command {
    let mut command = Command::new("git");
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        command.creation_flags(CREATE_NO_WINDOW);
    }
    crate::proxy::apply_to_command(&mut command);
    command
}

fn run_git<const N: usize>(args: [&str; N], destination: Option<&Path>) -> Result<(), AppError> {
    let mut command = git_command();
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
    use super::{
        browse_url_from_git_url, project_name_from_git_url, read_origin_url,
        source_repo_from_git_url, validate_git_url,
    };

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

    #[test]
    fn source_repo_requires_owner_and_repo() {
        assert_eq!(
            source_repo_from_git_url("https://github.com/owner/repo.git").as_deref(),
            Some("owner/repo")
        );
        assert_eq!(
            source_repo_from_git_url("git@github.com:owner/repo.git").as_deref(),
            Some("owner/repo")
        );
        assert_eq!(source_repo_from_git_url("https://example.com/skills.git"), None);
    }

    #[test]
    fn browse_url_normalizes_common_remotes() {
        assert_eq!(
            browse_url_from_git_url("https://github.com/owner/repo.git").as_deref(),
            Some("https://github.com/owner/repo")
        );
        assert_eq!(
            browse_url_from_git_url("git@github.com:owner/repo.git").as_deref(),
            Some("https://github.com/owner/repo")
        );
        assert_eq!(
            browse_url_from_git_url("ssh://git@github.com/owner/repo.git").as_deref(),
            Some("https://github.com/owner/repo")
        );
    }

    #[test]
    fn reads_origin_url_from_git_config() {
        let root = tempfile::tempdir().unwrap();
        let git = root.path().join(".git");
        std::fs::create_dir_all(&git).unwrap();
        std::fs::write(
            git.join("config"),
            r#"[core]
	repositoryformatversion = 0
[remote "origin"]
	url = git@github.com:acme/ask-matt.git
	fetch = +refs/heads/*:refs/remotes/origin/*
"#,
        )
        .unwrap();
        assert_eq!(
            read_origin_url(root.path()).as_deref(),
            Some("git@github.com:acme/ask-matt.git")
        );
    }
}
