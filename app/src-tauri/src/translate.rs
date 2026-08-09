use std::path::Path;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use serde_json::json;

use crate::error::AppError;
use crate::model::{FileNode, FileNodeKind};
use crate::settings::TranslateSettings;
use crate::skill_files::{list_skill_tree_at, read_skill_file_at};

/// Soft cap so a single request does not blow past common model context limits.
const MAX_SOURCE_CHARS: usize = 80_000;
const MAX_FILES: usize = 6;
const HTTP_TIMEOUT_SECS: u64 = 120;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum TranslateSkillSource {
    Provider,
    Library,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TranslatePreview {
    pub markdown: String,
    pub source_files: Vec<String>,
    pub truncated: bool,
    pub target_lang: String,
    pub model: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CollectedSource {
    pub prompt_body: String,
    pub source_files: Vec<String>,
    pub truncated: bool,
}

pub fn chat_completions_url(base_url: &str) -> String {
    let base = base_url.trim().trim_end_matches('/');
    format!("{base}/chat/completions")
}

fn file_name_of(relative_path: &str) -> &str {
    relative_path
        .rsplit(['/', '\\'])
        .next()
        .unwrap_or(relative_path)
}

fn is_readme_markdown(relative_path: &str) -> bool {
    let name = file_name_of(relative_path).to_ascii_lowercase();
    name.starts_with("readme") && (name.ends_with(".md") || name.ends_with(".markdown"))
}

fn flatten_file_paths(nodes: &[FileNode], out: &mut Vec<String>) {
    for node in nodes {
        match node.kind {
            FileNodeKind::File => out.push(node.relative_path.clone()),
            FileNodeKind::Directory => flatten_file_paths(&node.children, out),
        }
    }
}

/// Collect SKILL.md (+ root/near-root README*.md). Read-only; never writes.
pub fn collect_translate_source(skill_root: &Path) -> Result<CollectedSource, AppError> {
    let tree = list_skill_tree_at(skill_root)?;
    let mut all_paths = Vec::new();
    flatten_file_paths(&tree, &mut all_paths);

    let mut selected = Vec::new();
    if all_paths.iter().any(|p| p == "SKILL.md") {
        selected.push("SKILL.md".to_string());
    } else {
        return Err(AppError::Translate {
            message: "未找到 SKILL.md，无法翻译".into(),
        });
    }

    let mut readmes: Vec<String> = all_paths
        .into_iter()
        .filter(|path| path != "SKILL.md" && is_readme_markdown(path))
        .collect();
    // Prefer shallower paths, then stable name order.
    readmes.sort_by(|a, b| {
        let depth = |p: &str| p.matches('/').count();
        depth(a)
            .cmp(&depth(b))
            .then_with(|| a.to_ascii_lowercase().cmp(&b.to_ascii_lowercase()))
    });
    for path in readmes {
        if selected.len() >= MAX_FILES {
            break;
        }
        selected.push(path);
    }

    let mut parts = Vec::new();
    let mut used = Vec::new();
    let mut total_chars = 0usize;
    let mut truncated = false;

    for relative_path in &selected {
        let file = read_skill_file_at(skill_root, relative_path)?;
        let Some(content) = file.content else {
            continue;
        };
        let header = format!("<!-- file: {relative_path} -->\n");
        let piece_len = header.len() + content.len();
        if total_chars > 0 && total_chars + piece_len > MAX_SOURCE_CHARS {
            truncated = true;
            break;
        }
        let mut body = content;
        if total_chars + header.len() + body.len() > MAX_SOURCE_CHARS {
            let keep = MAX_SOURCE_CHARS.saturating_sub(total_chars + header.len());
            body.truncate(keep);
            truncated = true;
        }
        total_chars += header.len() + body.len();
        parts.push(format!("{header}{body}"));
        used.push(relative_path.clone());
        if truncated {
            break;
        }
    }

    if used.is_empty() {
        return Err(AppError::Translate {
            message: "没有可翻译的文本内容".into(),
        });
    }

    Ok(CollectedSource {
        prompt_body: parts.join("\n\n"),
        source_files: used,
        truncated,
    })
}

#[derive(Debug, Deserialize)]
struct ChatCompletionResponse {
    choices: Vec<ChatChoice>,
}

#[derive(Debug, Deserialize)]
struct ChatChoice {
    message: ChatMessage,
}

#[derive(Debug, Deserialize)]
struct ChatMessage {
    content: Option<String>,
}

pub fn translate_with_openai_compatible(
    settings: &TranslateSettings,
    source: &CollectedSource,
) -> Result<TranslatePreview, AppError> {
    if !settings.is_configured() {
        return Err(AppError::Translate {
            message: "请先在设置中配置完整的翻译接口（Base URL、API Key、模型、目标语言）".into(),
        });
    }

    let target_lang = settings.target_lang.trim().to_string();
    let model = settings.model.trim().to_string();
    let url = chat_completions_url(&settings.base_url);

    let system = format!(
        "You are a careful documentation translator. Translate the skill documents into {target_lang}. \
         Preserve markdown structure, headings, lists, tables, links, code fences, inline code, \
         YAML/JSON frontmatter keys and values that are identifiers, file paths, URLs, and command names. \
         Only translate natural-language prose. Keep HTML comments like <!-- file: ... --> unchanged. \
         Output only the translated markdown, with no surrounding explanation."
    );

    let mut user = source.prompt_body.clone();
    if source.truncated {
        user.push_str(
            "\n\n<!-- note: source was truncated for length; translate what is provided -->\n",
        );
    }

    let body = json!({
        "model": model,
        "temperature": 0.2,
        "messages": [
            { "role": "system", "content": system },
            { "role": "user", "content": user },
        ],
    });

    let client = reqwest::blocking::Client::builder()
        .timeout(Duration::from_secs(HTTP_TIMEOUT_SECS))
        .build()
        .map_err(|error| AppError::Translate {
            message: format!("创建 HTTP 客户端失败：{error}"),
        })?;

    // Never log api_key. Error messages must not include the Authorization header.
    let response = client
        .post(&url)
        .header("Authorization", format!("Bearer {}", settings.api_key.trim()))
        .header("Content-Type", "application/json")
        .json(&body)
        .send()
        .map_err(|error| AppError::Translate {
            message: format!("请求翻译接口失败：{error}"),
        })?;

    let status = response.status();
    let response_text = response.text().map_err(|error| AppError::Translate {
        message: format!("读取翻译响应失败：{error}"),
    })?;

    if !status.is_success() {
        let snippet = sanitize_api_error_body(&response_text, 400);
        return Err(AppError::Translate {
            message: format!("翻译接口返回 {status}：{snippet}"),
        });
    }

    let parsed: ChatCompletionResponse =
        serde_json::from_str(&response_text).map_err(|error| AppError::Translate {
            message: format!("解析翻译响应失败：{error}"),
        })?;

    let markdown = parsed
        .choices
        .first()
        .and_then(|choice| choice.message.content.as_ref())
        .map(|content| content.trim().to_string())
        .filter(|content| !content.is_empty())
        .ok_or_else(|| AppError::Translate {
            message: "翻译接口未返回有效内容".into(),
        })?;

    Ok(TranslatePreview {
        markdown,
        source_files: source.source_files.clone(),
        truncated: source.truncated,
        target_lang,
        model,
    })
}

fn sanitize_api_error_body(body: &str, max_chars: usize) -> String {
    let mut text = body.replace('\n', " ");
    // Best-effort: strip anything that looks like a bearer token if the server echoed it.
    if let Some(idx) = text.to_ascii_lowercase().find("bearer ") {
        let end = (idx + 40).min(text.len());
        text.replace_range(idx..end, "bearer ***");
    }
    if text.len() > max_chars {
        text.truncate(max_chars);
        text.push('…');
    }
    text
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::tempdir;

    #[test]
    fn builds_chat_completions_url() {
        assert_eq!(
            chat_completions_url("https://api.openai.com/v1/"),
            "https://api.openai.com/v1/chat/completions"
        );
        assert_eq!(
            chat_completions_url(" https://example.com/v1 "),
            "https://example.com/v1/chat/completions"
        );
    }

    #[test]
    fn collects_skill_md_and_readme() {
        let dir = tempdir().unwrap();
        let root = dir.path();
        fs::write(root.join("SKILL.md"), "# Hello\n\nDo something.").unwrap();
        fs::write(root.join("README.md"), "# Readme\n\nMore text.").unwrap();
        fs::write(root.join("notes.txt"), "ignore").unwrap();

        let collected = collect_translate_source(root).unwrap();
        assert_eq!(collected.source_files, vec!["SKILL.md", "README.md"]);
        assert!(collected.prompt_body.contains("<!-- file: SKILL.md -->"));
        assert!(collected.prompt_body.contains("<!-- file: README.md -->"));
        assert!(!collected.truncated);
    }

    #[test]
    fn requires_skill_md() {
        let dir = tempdir().unwrap();
        fs::write(dir.path().join("README.md"), "only readme").unwrap();
        let err = collect_translate_source(dir.path()).unwrap_err();
        assert!(err.to_string().contains("SKILL.md"));
    }

    #[test]
    fn translate_settings_configured() {
        let empty = TranslateSettings::default();
        assert!(!empty.is_configured());
        let ready = TranslateSettings {
            base_url: "https://api.openai.com/v1".into(),
            api_key: "sk-x".into(),
            model: "gpt-4o-mini".into(),
            target_lang: "中文".into(),
        };
        assert!(ready.is_configured());
    }
}
