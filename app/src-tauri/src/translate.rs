use std::path::Path;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use serde_json::json;

use crate::error::AppError;
use crate::settings::TranslateSettings;
use crate::skill_files::read_skill_file_at;

/// Soft cap so a single request does not blow past common model context limits.
const MAX_SOURCE_CHARS: usize = 80_000;
const HTTP_TIMEOUT_SECS: u64 = 120;
const ERROR_BODY_SNIPPET_CHARS: usize = 400;

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

/// Build OpenAI-compatible chat completions URL from a configured base URL.
///
/// Accepts `https://host/v1`, `https://host`, or a full `.../chat/completions` URL.
pub fn chat_completions_url(base_url: &str) -> String {
    let trimmed = base_url.trim();
    if trimmed.is_empty() {
        return String::new();
    }

    // Keep scheme:// intact while collapsing accidental duplicate slashes in the path.
    let (scheme, rest) = match trimmed.split_once("://") {
        Some((scheme, rest)) => (Some(scheme), rest),
        None => (None, trimmed),
    };
    let collapsed = {
        let mut out = String::with_capacity(rest.len());
        let mut prev_slash = false;
        for ch in rest.chars() {
            if ch == '/' {
                if prev_slash {
                    continue;
                }
                prev_slash = true;
            } else {
                prev_slash = false;
            }
            out.push(ch);
        }
        out
    };
    let normalized = match scheme {
        Some(scheme) => format!("{scheme}://{collapsed}"),
        None => collapsed,
    };
    let base = normalized.trim_end_matches('/');

    if base.ends_with("/chat/completions") {
        return base.to_string();
    }

    // OpenAI-compatible APIs expect `/v1/chat/completions`.
    if base.ends_with("/v1") {
        format!("{base}/chat/completions")
    } else {
        format!("{base}/v1/chat/completions")
    }
}

/// Collect a single selected skill file for translation preview. Read-only; never writes.
pub fn collect_translate_source(
    skill_root: &Path,
    relative_path: &str,
) -> Result<CollectedSource, AppError> {
    let relative_path = relative_path.trim().replace('\\', "/");
    if relative_path.is_empty() {
        return Err(AppError::Translate {
            message: "请先在左侧选择要翻译的文件".into(),
        });
    }

    let file = read_skill_file_at(skill_root, &relative_path)?;
    let Some(content) = file.content else {
        return Err(AppError::Translate {
            message: format!(
                "无法翻译「{relative_path}」：{}",
                file.message.unwrap_or_else(|| "不支持预览的文件".into())
            ),
        });
    };
    if content.trim().is_empty() {
        return Err(AppError::Translate {
            message: format!("「{relative_path}」没有可翻译的文本内容"),
        });
    }

    let header = format!("<!-- file: {relative_path} -->\n");
    let mut truncated = false;
    let mut body = content;
    if header.len() + body.len() > MAX_SOURCE_CHARS {
        let keep = MAX_SOURCE_CHARS.saturating_sub(header.len());
        body.truncate(keep);
        truncated = true;
    }

    Ok(CollectedSource {
        prompt_body: format!("{header}{body}"),
        source_files: vec![relative_path],
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
    #[serde(default)]
    content: Option<MessageContent>,
}

#[derive(Debug, Deserialize)]
#[serde(untagged)]
enum MessageContent {
    Text(String),
    Parts(Vec<ContentPart>),
}

#[derive(Debug, Deserialize)]
struct ContentPart {
    #[serde(default)]
    text: Option<String>,
    #[serde(rename = "type")]
    #[serde(default)]
    kind: Option<String>,
}

impl MessageContent {
    fn into_text(self) -> Option<String> {
        match self {
            MessageContent::Text(text) => {
                let trimmed = text.trim();
                if trimmed.is_empty() {
                    None
                } else {
                    Some(trimmed.to_string())
                }
            }
            MessageContent::Parts(parts) => {
                let mut texts = Vec::new();
                for part in parts {
                    let is_text = part
                        .kind
                        .as_deref()
                        .map(|kind| kind.eq_ignore_ascii_case("text"))
                        .unwrap_or(true);
                    if !is_text {
                        continue;
                    }
                    if let Some(text) = part.text {
                        let trimmed = text.trim();
                        if !trimmed.is_empty() {
                            texts.push(trimmed.to_string());
                        }
                    }
                }
                if texts.is_empty() {
                    None
                } else {
                    Some(texts.join("\n"))
                }
            }
        }
    }
}

/// Parse an OpenAI-compatible chat/completions HTTP response into translated markdown.
///
/// Checks HTTP status before JSON parsing. Distinguishes API envelope parse failures
/// from empty model content. Never includes API keys in error messages.
pub fn parse_translate_api_response(status: u16, response_text: &str) -> Result<String, AppError> {
    if !(200..300).contains(&status) {
        let snippet = sanitize_api_error_body(response_text, ERROR_BODY_SNIPPET_CHARS);
        return Err(AppError::Translate {
            message: format!("翻译接口返回 HTTP {status}：{snippet}"),
        });
    }

    let trimmed = response_text.trim();
    if trimmed.is_empty() {
        return Err(AppError::Translate {
            message: format!(
                "API 响应解析失败：HTTP {status} 返回空响应体（请检查 Base URL 是否指向 OpenAI 兼容的 /v1 接口）"
            ),
        });
    }

    // SSE streams are not supported for this synchronous preview path.
    if trimmed.starts_with("data:") || trimmed.contains("\ndata:") {
        let snippet = sanitize_api_error_body(trimmed, ERROR_BODY_SNIPPET_CHARS);
        return Err(AppError::Translate {
            message: format!(
                "API 响应解析失败：收到 SSE/流式响应，请关闭 stream 或改用非流式 chat/completions。片段：{snippet}"
            ),
        });
    }

    let parsed: ChatCompletionResponse = match serde_json::from_str(trimmed) {
        Ok(value) => value,
        Err(error) => {
            let snippet = sanitize_api_error_body(trimmed, ERROR_BODY_SNIPPET_CHARS);
            // If the body looks like raw markdown/text rather than an API envelope,
            // say so explicitly — this is still an API-shape mismatch, not "empty model content".
            let hint = if looks_like_raw_markdown(trimmed) {
                "响应体像是模型原文/Markdown，而不是 chat/completions JSON。"
            } else if trimmed.starts_with('<') {
                "响应体像是 HTML 错误页。"
            } else {
                "响应体不是有效的 chat/completions JSON。"
            };
            return Err(AppError::Translate {
                message: format!(
                    "API 响应解析失败：{hint}（{error}）。片段：{snippet}"
                ),
            });
        }
    };

    if parsed.choices.is_empty() {
        return Err(AppError::Translate {
            message: "模型返回内容为空：choices 为空".into(),
        });
    }

    parsed
        .choices
        .into_iter()
        .find_map(|choice| choice.message.content.and_then(MessageContent::into_text))
        .ok_or_else(|| AppError::Translate {
            message: "模型返回内容为空：choices[0].message.content 为空".into(),
        })
}

fn looks_like_raw_markdown(text: &str) -> bool {
    let head = text.lines().next().unwrap_or(text).trim();
    head.starts_with('#')
        || head.starts_with("<!--")
        || head.starts_with("```")
        || head.starts_with("- ")
        || head.starts_with("* ")
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
    if url.is_empty() {
        return Err(AppError::Translate {
            message: "请先在设置中配置翻译 Base URL".into(),
        });
    }

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
        "stream": false,
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
            message: format!("请求翻译接口失败（{url}）：{error}"),
        })?;

    let status = response.status().as_u16();
    let response_text = response.text().map_err(|error| AppError::Translate {
        message: format!("读取翻译响应失败：{error}"),
    })?;

    let markdown = parse_translate_api_response(status, &response_text)?;

    Ok(TranslatePreview {
        markdown,
        source_files: source.source_files.clone(),
        truncated: source.truncated,
        target_lang,
        model,
    })
}

fn sanitize_api_error_body(body: &str, max_chars: usize) -> String {
    let mut text = body.replace('\n', " ").replace('\r', " ");
    // Best-effort: strip anything that looks like a bearer token if the server echoed it.
    let lower = text.to_ascii_lowercase();
    if let Some(idx) = lower.find("bearer ") {
        let end = (idx + 40).min(text.len());
        text.replace_range(idx..end, "bearer ***");
    }
    // Avoid leaking sk- styled keys if echoed in error pages.
    if let Some(idx) = text.find("sk-") {
        let end = (idx + 12).min(text.len());
        text.replace_range(idx..end, "sk-***");
    }
    let trimmed = text.trim();
    if trimmed.is_empty() {
        return "(空响应体)".into();
    }
    let mut out = trimmed.to_string();
    if out.len() > max_chars {
        out.truncate(max_chars);
        out.push('…');
    }
    out
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
        // Missing /v1 should be added.
        assert_eq!(
            chat_completions_url("https://api.openai.com"),
            "https://api.openai.com/v1/chat/completions"
        );
        // Full endpoint accepted as-is.
        assert_eq!(
            chat_completions_url("https://proxy.example/v1/chat/completions"),
            "https://proxy.example/v1/chat/completions"
        );
        // Avoid accidental // in path.
        assert_eq!(
            chat_completions_url("https://api.openai.com//v1/"),
            "https://api.openai.com/v1/chat/completions"
        );
    }

    #[test]
    fn collects_selected_file() {
        let dir = tempdir().unwrap();
        let root = dir.path();
        fs::create_dir_all(root.join("references")).unwrap();
        fs::write(root.join("SKILL.md"), "# Hello\n\nDo something.").unwrap();
        fs::write(
            root.join("references/thresholds.md"),
            "# Thresholds\n\nMore text.",
        )
        .unwrap();

        let collected = collect_translate_source(root, "references/thresholds.md").unwrap();
        assert_eq!(
            collected.source_files,
            vec!["references/thresholds.md".to_string()]
        );
        assert!(collected.prompt_body.contains("<!-- file: references/thresholds.md -->"));
        assert!(collected.prompt_body.contains("# Thresholds"));
        assert!(!collected.prompt_body.contains("# Hello"));
        assert!(!collected.truncated);
    }

    #[test]
    fn requires_selected_file() {
        let dir = tempdir().unwrap();
        fs::write(dir.path().join("SKILL.md"), "# Skill").unwrap();
        let err = collect_translate_source(dir.path(), "   ").unwrap_err();
        assert!(err.to_string().contains("选择"));
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

    #[test]
    fn parses_normal_chat_completions() {
        let body = r##"{
            "choices": [
                {
                    "message": {
                        "role": "assistant",
                        "content": "# 你好\n\n说明文字"
                    }
                }
            ]
        }"##;
        let markdown = parse_translate_api_response(200, body).unwrap();
        assert_eq!(markdown, "# 你好\n\n说明文字");
    }

    #[test]
    fn parses_array_message_content() {
        let body = serde_json::json!({
            "choices": [{
                "message": {
                    "content": [
                        {"type": "text", "text": "第一段"},
                        {"type": "text", "text": "第二段"}
                    ]
                }
            }]
        })
        .to_string();
        let markdown = parse_translate_api_response(200, &body).unwrap();
        assert_eq!(markdown, "第一段\n第二段");
    }

    #[test]
    fn rejects_non_json_success_body() {
        let err = parse_translate_api_response(200, "").unwrap_err();
        let msg = err.to_string();
        assert!(msg.contains("API 响应解析失败"), "{msg}");
        assert!(msg.contains("空响应体"), "{msg}");

        let err = parse_translate_api_response(200, "not-json-at-all").unwrap_err();
        let msg = err.to_string();
        assert!(msg.contains("API 响应解析失败"), "{msg}");
        assert!(msg.contains("not-json-at-all"), "{msg}");
        assert!(!msg.contains("sk-"), "{msg}");
    }

    #[test]
    fn rejects_401_html_without_json_parse_first() {
        let html = "<html><body>Unauthorized</body></html>";
        let err = parse_translate_api_response(401, html).unwrap_err();
        let msg = err.to_string();
        assert!(msg.contains("HTTP 401"), "{msg}");
        assert!(msg.contains("Unauthorized"), "{msg}");
        assert!(!msg.contains("expected value"), "{msg}");
    }

    #[test]
    fn distinguishes_empty_model_content() {
        let body = r#"{"choices":[{"message":{"content":"   "}}]}"#;
        let err = parse_translate_api_response(200, body).unwrap_err();
        let msg = err.to_string();
        assert!(msg.contains("模型返回内容为空"), "{msg}");
        assert!(!msg.contains("API 响应解析失败"), "{msg}");
    }

    #[test]
    fn sanitize_strips_bearer_and_sk_prefix() {
        let raw = "auth failed bearer sk-abcdefghijklmnopqrstuvwxyz remaining";
        let cleaned = sanitize_api_error_body(raw, 400);
        assert!(!cleaned.contains("sk-abcdefgh"), "{cleaned}");
        assert!(cleaned.contains("bearer ***") || cleaned.contains("sk-***"), "{cleaned}");
    }
}
