use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::time::Duration;

use chrono::Utc;
use serde::{Deserialize, Serialize};
use serde_json::json;
use sha2::{Digest, Sha256};

use crate::error::AppError;
use crate::json_store::{read_json_value, write_json_value};
use crate::settings::TranslateSettings;
use crate::skill_files::read_skill_file_at;

/// Soft cap so a single request does not blow past common model context limits.
const MAX_SOURCE_BYTES: usize = 80_000;
/// Large files are translated in concurrent batches of this size.
const TRANSLATE_CONCURRENCY: usize = 2;
/// Each chunk request is retried once after the first failure.
const TRANSLATE_CHUNK_MAX_ATTEMPTS: usize = 2;
const HTTP_TIMEOUT_SECS: u64 = 120;
const ERROR_BODY_SNIPPET_BYTES: usize = 400;
const TRANSLATE_CACHE_MAX_ENTRIES: usize = 200;
const TRANSLATE_CACHE_FILE: &str = "translate-cache.json";
const DEFAULT_TARGET_LANG: &str = "中文";
const GOOGLE_MODEL_LABEL: &str = "google-translate";
const GOOGLE_TRANSLATE_URL: &str = "https://translate.googleapis.com/translate_a/single";
const GOOGLE_MAX_CHUNK_BYTES: usize = 4_500;
const GOOGLE_HTTP_TIMEOUT_SECS: u64 = 30;
const GOOGLE_USER_AGENT: &str = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

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
    /// True when markdown was loaded from local content-hash cache (no model call).
    #[serde(default)]
    pub from_cache: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CollectedSource {
    /// Raw selected-file content (not prompt-wrapped). Large files are chunked at translate time.
    pub prompt_body: String,
    pub source_files: Vec<String>,
    /// Kept for API compatibility; chunked translation no longer truncates source text.
    pub truncated: bool,
    /// Hex MD5 of raw file content.
    pub content_md5: String,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
struct TranslateCacheStore {
    entries: HashMap<String, TranslateCacheEntry>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct TranslateCacheEntry {
    md5: String,
    target_lang: String,
    relative_path: String,
    translated: String,
    model: String,
    updated_at: String,
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

    let content_md5 = content_md5_hex(&content);
    Ok(CollectedSource {
        prompt_body: content,
        source_files: vec![relative_path],
        truncated: false,
        content_md5,
    })
}

/// Split text into UTF-8 safe slices that prefer ending on a newline.
pub fn split_text_into_byte_chunks(text: &str, max_bytes: usize) -> Vec<String> {
    if max_bytes == 0 {
        return if text.is_empty() {
            Vec::new()
        } else {
            text.chars().map(|ch| ch.to_string()).collect()
        };
    }
    if text.len() <= max_bytes {
        return vec![text.to_string()];
    }

    let mut chunks = Vec::new();
    let mut start = 0usize;
    while start < text.len() {
        let remaining = text.len() - start;
        if remaining <= max_bytes {
            chunks.push(text[start..].to_string());
            break;
        }

        let mut end = start + max_bytes;
        while end > start && !text.is_char_boundary(end) {
            end -= 1;
        }
        if end <= start {
            end = (start + 1..=text.len())
                .find(|index| text.is_char_boundary(*index))
                .unwrap_or(text.len());
        }

        let window = &text[start..end];
        let prefer_from = window.len() / 2;
        if let Some(rel) = window[prefer_from..].rfind('\n') {
            end = start + prefer_from + rel + 1;
        } else if let Some(rel) = window.rfind('\n') {
            end = start + rel + 1;
        }
        if end <= start {
            end = (start + 1..=text.len())
                .find(|index| text.is_char_boundary(*index))
                .unwrap_or(text.len());
        }

        chunks.push(text[start..end].to_string());
        start = end;
    }
    chunks
}

fn chunk_content_budget(relative_path: &str) -> usize {
    let overhead = format!("<!-- file: {relative_path} -->\n<!-- part: 999/999 -->\n").len();
    MAX_SOURCE_BYTES.saturating_sub(overhead).max(1_024)
}

fn build_chunk_prompt(relative_path: &str, part: usize, total: usize, chunk: &str) -> String {
    if total <= 1 {
        format!("<!-- file: {relative_path} -->\n{chunk}")
    } else {
        format!("<!-- file: {relative_path} -->\n<!-- part: {part}/{total} -->\n{chunk}")
    }
}

fn join_translated_chunks(chunks: &[String]) -> String {
    chunks.join("")
}

/// Hex MD5 of file content bytes (UTF-8). Used as cache key material.
pub fn content_md5_hex(content: &str) -> String {
    md5_hex(content.as_bytes())
}

/// Minimal MD5 (RFC 1321) — avoids extra crate; local builds without cargo still keep deps stable.
fn md5_hex(data: &[u8]) -> String {
    let mut state = [0x6745_2301u32, 0xefcd_ab89, 0x98ba_dcfe, 0x1032_5476];
    let bit_len = (data.len() as u64).saturating_mul(8);
    let mut buf = data.to_vec();
    buf.push(0x80);
    while buf.len() % 64 != 56 {
        buf.push(0);
    }
    buf.extend_from_slice(&bit_len.to_le_bytes());

    for chunk in buf.chunks_exact(64) {
        let mut w = [0u32; 16];
        for (i, word) in w.iter_mut().enumerate() {
            let o = i * 4;
            *word = u32::from_le_bytes([chunk[o], chunk[o + 1], chunk[o + 2], chunk[o + 3]]);
        }
        let (mut a, mut b, mut c, mut d) = (state[0], state[1], state[2], state[3]);
        for i in 0..64 {
            let (f, g) = match i {
                0..=15 => ((b & c) | ((!b) & d), i),
                16..=31 => ((d & b) | ((!d) & c), (5 * i + 1) % 16),
                32..=47 => (b ^ c ^ d, (3 * i + 5) % 16),
                _ => (c ^ (b | (!d)), (7 * i) % 16),
            };
            let temp = d;
            d = c;
            c = b;
            let sum = a.wrapping_add(f).wrapping_add(MD5_K[i]).wrapping_add(w[g]);
            b = b.wrapping_add(sum.rotate_left(MD5_S[i]));
            a = temp;
        }
        state[0] = state[0].wrapping_add(a);
        state[1] = state[1].wrapping_add(b);
        state[2] = state[2].wrapping_add(c);
        state[3] = state[3].wrapping_add(d);
    }

    let mut out = String::with_capacity(32);
    for word in state {
        for byte in word.to_le_bytes() {
            out.push_str(&format!("{byte:02x}"));
        }
    }
    out
}

const MD5_S: [u32; 64] = [
    7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9,
    14, 20, 5, 9, 14, 20, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 6, 10, 15,
    21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21,
];

const MD5_K: [u32; 64] = [
    0xd76a_a478,
    0xe8c7_b756,
    0x2420_70db,
    0xc1bd_ceee,
    0xf57c_0faf,
    0x4787_c62a,
    0xa830_4613,
    0xfd46_9501,
    0x6980_98d8,
    0x8b44_f7af,
    0xffff_5bb1,
    0x895c_d7be,
    0x6b90_1122,
    0xfd98_7193,
    0xa679_438e,
    0x49b4_0821,
    0xf61e_2562,
    0xc040_b340,
    0x265e_5a51,
    0xe9b6_c7aa,
    0xd62f_105d,
    0x0244_1453,
    0xd8a1_e681,
    0xe7d3_fbc8,
    0x21e1_cde6,
    0xc337_07d6,
    0xf4d5_0d87,
    0x455a_14ed,
    0xa9e3_e905,
    0xfcef_a3f8,
    0x676f_02d9,
    0x8d2a_4c8a,
    0xfffa_3942,
    0x8771_f681,
    0x6d9d_6122,
    0xfde5_380c,
    0xa4be_ea44,
    0x4bde_cfa9,
    0xf6bb_4b60,
    0xbebf_bc70,
    0x289b_7ec6,
    0xeaa1_27fa,
    0xd4ef_3085,
    0x0488_1d05,
    0xd9d4_d039,
    0xe6db_99e5,
    0x1fa2_7cf8,
    0xc4ac_5665,
    0xf429_2244,
    0x432a_ff97,
    0xab94_23a7,
    0xfc93_a039,
    0x655b_59c3,
    0x8f0c_cc92,
    0xffef_f47d,
    0x8584_5dd1,
    0x6fa8_7e4f,
    0xfe2c_e6e0,
    0xa301_4314,
    0x4e08_11a1,
    0xf753_7e82,
    0xbd3a_f235,
    0x2ad7_d2bb,
    0xeb86_d391,
];

pub fn translate_cache_key(
    md5: &str,
    target_lang: &str,
    relative_path: &str,
    base_url: &str,
    model: &str,
    api_key: &str,
) -> String {
    let lang = target_lang.trim();
    let path = relative_path.trim().replace('\\', "/");
    let base_url = chat_completions_url(base_url);
    let model = model.trim();
    let api_key_sha256 = sha256_hex(api_key.trim().as_bytes());
    let parts = [md5, lang, &path, &base_url, model, &api_key_sha256];
    let mut material = String::from("translate-cache-v2");
    for part in parts {
        material.push(':');
        material.push_str(&part.len().to_string());
        material.push(':');
        material.push_str(part);
    }
    format!("v2:{}", sha256_hex(material.as_bytes()))
}

pub fn google_translate_cache_key(md5: &str, target_lang: &str, relative_path: &str) -> String {
    let lang = target_lang.trim();
    let path = relative_path.trim().replace('\\', "/");
    let parts = [md5, lang, path.as_str()];
    let mut material = String::from("google-public-v1");
    for part in parts {
        material.push(':');
        material.push_str(&part.len().to_string());
        material.push(':');
        material.push_str(part);
    }
    format!("g1:{}", sha256_hex(material.as_bytes()))
}

pub fn effective_target_lang(settings: &TranslateSettings) -> String {
    let trimmed = settings.target_lang.trim();
    if trimmed.is_empty() {
        DEFAULT_TARGET_LANG.to_string()
    } else {
        trimmed.to_string()
    }
}

/// Map UI language names to Google `tl` codes.
pub fn google_lang_code(target_lang: &str) -> String {
    let trimmed = target_lang.trim();
    if trimmed.is_empty() {
        return "zh-CN".into();
    }
    match trimmed.to_lowercase().as_str() {
        "中文" | "简体中文" | "汉语" | "chinese" | "zh" | "zh-cn" | "zh_cn" => {
            "zh-CN".into()
        }
        "繁體中文" | "繁体中文" | "traditional chinese" | "zh-tw" | "zh_tw" => {
            "zh-TW".into()
        }
        "english" | "英文" | "en" => "en".into(),
        "日本語" | "日文" | "japanese" | "ja" => "ja".into(),
        "한국어" | "韩语" | "韓語" | "korean" | "ko" => "ko".into(),
        "français" | "francais" | "french" | "法语" | "法文" | "fr" => "fr".into(),
        "deutsch" | "german" | "德语" | "德文" | "de" => "de".into(),
        "español" | "espanol" | "spanish" | "西班牙语" | "es" => "es".into(),
        other => other.replace('_', "-"),
    }
}

fn sha256_hex(value: &[u8]) -> String {
    Sha256::digest(value)
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect()
}

pub fn translate_cache_path(app_data_dir: &Path) -> PathBuf {
    app_data_dir.join(TRANSLATE_CACHE_FILE)
}

fn load_translate_cache(app_data_dir: &Path) -> Result<TranslateCacheStore, AppError> {
    read_json_value(
        &translate_cache_path(app_data_dir),
        TranslateCacheStore::default,
        |message| AppError::Translate {
            message: format!("读取翻译缓存失败：{message}"),
        },
    )
}

fn save_translate_cache(app_data_dir: &Path, store: &TranslateCacheStore) -> Result<(), AppError> {
    std::fs::create_dir_all(app_data_dir)?;
    write_json_value(&translate_cache_path(app_data_dir), store, |message| {
        AppError::Translate {
            message: format!("写入翻译缓存失败：{message}"),
        }
    })
}

fn evict_oldest_if_needed(store: &mut TranslateCacheStore) {
    while store.entries.len() > TRANSLATE_CACHE_MAX_ENTRIES {
        let oldest_key = store
            .entries
            .iter()
            .min_by(|(_, a), (_, b)| a.updated_at.cmp(&b.updated_at))
            .map(|(key, _)| key.clone());
        if let Some(key) = oldest_key {
            store.entries.remove(&key);
        } else {
            break;
        }
    }
}

fn source_relative_path(source: &CollectedSource) -> String {
    source
        .source_files
        .first()
        .map(|path| path.trim().replace('\\', "/"))
        .unwrap_or_default()
}

fn lookup_cached_preview(
    app_data_dir: &Path,
    key: &str,
    source: &CollectedSource,
    target_lang: &str,
    relative_path: &str,
    model: &str,
) -> Option<TranslatePreview> {
    let store = load_translate_cache(app_data_dir).ok()?;
    let entry = store.entries.get(key)?;
    if entry.md5 == source.content_md5
        && entry.target_lang == target_lang
        && entry.relative_path == relative_path
        && entry.model == model
    {
        Some(TranslatePreview {
            markdown: entry.translated.clone(),
            source_files: source.source_files.clone(),
            truncated: source.truncated,
            target_lang: target_lang.to_string(),
            model: entry.model.clone(),
            from_cache: true,
        })
    } else {
        None
    }
}

fn store_cached_preview(
    app_data_dir: &Path,
    key: String,
    source: &CollectedSource,
    target_lang: &str,
    relative_path: &str,
    model: &str,
    translated: &str,
) {
    let mut store = load_translate_cache(app_data_dir).unwrap_or_default();
    store.entries.insert(
        key,
        TranslateCacheEntry {
            md5: source.content_md5.clone(),
            target_lang: target_lang.to_string(),
            relative_path: relative_path.to_string(),
            translated: translated.to_string(),
            model: model.to_string(),
            updated_at: Utc::now().to_rfc3339(),
        },
    );
    evict_oldest_if_needed(&mut store);
    let _ = save_translate_cache(app_data_dir, &store);
}

fn translate_error_detail(error: &AppError) -> String {
    match error {
        AppError::Translate { message } => message.clone(),
        other => other.to_string(),
    }
}

/// Default: Google public translate. Model is used only when Google fails and is configured.
pub fn preview_translate_prefer_google<G, M>(
    app_data_dir: &Path,
    settings: &TranslateSettings,
    source: &CollectedSource,
    google_fn: G,
    model_fn: M,
) -> Result<TranslatePreview, AppError>
where
    G: FnOnce(&TranslateSettings, &CollectedSource) -> Result<TranslatePreview, AppError>,
    M: FnOnce(&TranslateSettings, &CollectedSource) -> Result<TranslatePreview, AppError>,
{
    let target_lang = effective_target_lang(settings);
    let normalized_path = source_relative_path(source);
    let google_key =
        google_translate_cache_key(&source.content_md5, &target_lang, &normalized_path);

    if let Some(hit) = lookup_cached_preview(
        app_data_dir,
        &google_key,
        source,
        &target_lang,
        &normalized_path,
        GOOGLE_MODEL_LABEL,
    ) {
        return Ok(hit);
    }

    match google_fn(settings, source) {
        Ok(mut preview) => {
            preview.from_cache = false;
            preview.model = GOOGLE_MODEL_LABEL.to_string();
            preview.target_lang = target_lang.clone();
            store_cached_preview(
                app_data_dir,
                google_key,
                source,
                &target_lang,
                &normalized_path,
                GOOGLE_MODEL_LABEL,
                &preview.markdown,
            );
            Ok(preview)
        }
        Err(google_error) => {
            if settings.is_configured() {
                preview_translate_with_cache(app_data_dir, settings, source, model_fn)
            } else {
                Err(AppError::Translate {
                    message: format!(
                        "{}（公共翻译失败，可在设置中配置模型服务作为备用）",
                        translate_error_detail(&google_error)
                    ),
                })
            }
        }
    }
}

/// Preview translate with local content-hash cache. Cache hit skips `translate_fn`.
pub fn preview_translate_with_cache<F>(
    app_data_dir: &Path,
    settings: &TranslateSettings,
    source: &CollectedSource,
    translate_fn: F,
) -> Result<TranslatePreview, AppError>
where
    F: FnOnce(&TranslateSettings, &CollectedSource) -> Result<TranslatePreview, AppError>,
{
    if !settings.is_configured() {
        return Err(AppError::Translate {
            message: "请先在设置中配置完整的翻译接口（Base URL、API Key、模型、目标语言）".into(),
        });
    }

    let target_lang = settings.target_lang.trim().to_string();
    let normalized_path = source_relative_path(source);
    let model = settings.model.trim().to_string();
    let key = translate_cache_key(
        &source.content_md5,
        &target_lang,
        &normalized_path,
        &settings.base_url,
        &model,
        &settings.api_key,
    );

    if let Some(hit) = lookup_cached_preview(
        app_data_dir,
        &key,
        source,
        &target_lang,
        &normalized_path,
        &model,
    ) {
        return Ok(hit);
    }

    let mut preview = translate_fn(settings, source)?;
    preview.from_cache = false;
    store_cached_preview(
        app_data_dir,
        key,
        source,
        &target_lang,
        &normalized_path,
        &model,
        &preview.markdown,
    );
    Ok(preview)
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
        let snippet = sanitize_api_error_body(response_text, ERROR_BODY_SNIPPET_BYTES);
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
        let snippet = sanitize_api_error_body(trimmed, ERROR_BODY_SNIPPET_BYTES);
        return Err(AppError::Translate {
            message: format!(
                "API 响应解析失败：收到 SSE/流式响应，请关闭 stream 或改用非流式 chat/completions。片段：{snippet}"
            ),
        });
    }

    let parsed: ChatCompletionResponse = match serde_json::from_str(trimmed) {
        Ok(value) => value,
        Err(error) => {
            let snippet = sanitize_api_error_body(trimmed, ERROR_BODY_SNIPPET_BYTES);
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
                message: format!("API 响应解析失败：{hint}（{error}）。片段：{snippet}"),
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
    translate_with_chunk_fn(settings, source, translate_prompt_http)
}

pub fn translate_with_google_public(
    settings: &TranslateSettings,
    source: &CollectedSource,
) -> Result<TranslatePreview, AppError> {
    translate_google_with_chunk_fn(settings, source, translate_google_chunk_http)
}

pub fn translate_google_with_chunk_fn<F>(
    settings: &TranslateSettings,
    source: &CollectedSource,
    translate_chunk: F,
) -> Result<TranslatePreview, AppError>
where
    F: Fn(&str, &str) -> Result<String, AppError>,
{
    let target_lang = effective_target_lang(settings);
    let lang_code = google_lang_code(&target_lang);
    let chunks = split_text_into_byte_chunks(&source.prompt_body, GOOGLE_MAX_CHUNK_BYTES);
    if chunks.is_empty() {
        let relative_path = source_relative_path(source);
        return Err(AppError::Translate {
            message: format!("「{relative_path}」没有可翻译的文本内容"),
        });
    }

    let mut translated_parts = Vec::with_capacity(chunks.len());
    for chunk in &chunks {
        let mut last_error = None;
        let mut translated = None;
        for attempt in 1..=TRANSLATE_CHUNK_MAX_ATTEMPTS {
            match translate_chunk(&lang_code, chunk) {
                Ok(text) => {
                    translated = Some(text);
                    break;
                }
                Err(error) => {
                    last_error = Some(error);
                    if attempt < TRANSLATE_CHUNK_MAX_ATTEMPTS {
                        continue;
                    }
                }
            }
        }
        translated_parts.push(translated.ok_or_else(|| {
            last_error.unwrap_or_else(|| AppError::Translate {
                message: "Google 公共翻译失败".into(),
            })
        })?);
    }

    Ok(TranslatePreview {
        markdown: join_translated_chunks(&translated_parts),
        source_files: source.source_files.clone(),
        truncated: false,
        target_lang,
        model: GOOGLE_MODEL_LABEL.to_string(),
        from_cache: false,
    })
}

/// Translate a collected source by splitting large bodies and running up to two chunk
/// requests at a time, then assembling results in order.
pub fn translate_with_chunk_fn<F>(
    settings: &TranslateSettings,
    source: &CollectedSource,
    translate_chunk: F,
) -> Result<TranslatePreview, AppError>
where
    F: Fn(&TranslateSettings, &str) -> Result<String, AppError> + Sync,
{
    if !settings.is_configured() {
        return Err(AppError::Translate {
            message: "请先在设置中配置完整的翻译接口（Base URL、API Key、模型、目标语言）".into(),
        });
    }

    let target_lang = settings.target_lang.trim().to_string();
    let model = settings.model.trim().to_string();
    let relative_path = source
        .source_files
        .first()
        .map(|path| path.as_str())
        .unwrap_or("SKILL.md");
    let budget = chunk_content_budget(relative_path);
    let chunks = split_text_into_byte_chunks(&source.prompt_body, budget);
    if chunks.is_empty() {
        return Err(AppError::Translate {
            message: format!("「{relative_path}」没有可翻译的文本内容"),
        });
    }

    let total = chunks.len();
    let prompts: Vec<String> = chunks
        .iter()
        .enumerate()
        .map(|(index, chunk)| build_chunk_prompt(relative_path, index + 1, total, chunk))
        .collect();
    let translated_parts =
        translate_prompts_in_batches(settings, &prompts, TRANSLATE_CONCURRENCY, &translate_chunk)?;

    Ok(TranslatePreview {
        markdown: join_translated_chunks(&translated_parts),
        source_files: source.source_files.clone(),
        truncated: false,
        target_lang,
        model,
        from_cache: false,
    })
}

fn translate_chunk_with_retry<F>(
    settings: &TranslateSettings,
    prompt: &str,
    translate_chunk: &F,
) -> Result<String, AppError>
where
    F: Fn(&TranslateSettings, &str) -> Result<String, AppError>,
{
    let mut last_error = None;
    for attempt in 1..=TRANSLATE_CHUNK_MAX_ATTEMPTS {
        match translate_chunk(settings, prompt) {
            Ok(text) => return Ok(text),
            Err(error) => {
                last_error = Some(error);
                if attempt < TRANSLATE_CHUNK_MAX_ATTEMPTS {
                    continue;
                }
            }
        }
    }
    Err(last_error.unwrap_or_else(|| AppError::Translate {
        message: "分片翻译失败".into(),
    }))
}

fn translate_prompts_in_batches<F>(
    settings: &TranslateSettings,
    prompts: &[String],
    concurrency: usize,
    translate_chunk: &F,
) -> Result<Vec<String>, AppError>
where
    F: Fn(&TranslateSettings, &str) -> Result<String, AppError> + Sync,
{
    let concurrency = concurrency.max(1);
    let mut translated = vec![String::new(); prompts.len()];
    let mut index = 0usize;
    while index < prompts.len() {
        let end = (index + concurrency).min(prompts.len());
        let mut batch_error: Option<AppError> = None;
        std::thread::scope(|scope| {
            let mut handles = Vec::with_capacity(end - index);
            for (offset, prompt) in prompts[index..end].iter().enumerate() {
                let absolute = index + offset;
                handles.push(scope.spawn(move || {
                    (
                        absolute,
                        translate_chunk_with_retry(settings, prompt, translate_chunk),
                    )
                }));
            }
            for handle in handles {
                match handle.join() {
                    Ok((absolute, Ok(text))) => translated[absolute] = text,
                    Ok((_, Err(error))) => {
                        if batch_error.is_none() {
                            batch_error = Some(error);
                        }
                    }
                    Err(_) => {
                        if batch_error.is_none() {
                            batch_error = Some(AppError::Translate {
                                message: "分片翻译线程异常退出".into(),
                            });
                        }
                    }
                }
            }
        });
        if let Some(error) = batch_error {
            return Err(error);
        }
        index = end;
    }
    Ok(translated)
}

fn translate_system_prompt(target_lang: &str, multipart: bool) -> String {
    let mut prompt = format!(
        "You are a careful documentation translator. Translate the skill documents into {target_lang}. \
         Preserve markdown structure, headings, lists, tables, links, code fences, inline code, \
         YAML/JSON frontmatter keys and values that are identifiers, file paths, URLs, and command names. \
         Only translate natural-language prose. Keep HTML comments like <!-- file: ... --> unchanged. \
         Output only the translated markdown, with no surrounding explanation."
    );
    if multipart {
        prompt.push_str(
            " This input is one ordered part of a larger document (see <!-- part: i/n -->). \
             Translate only this part, keep continuity of markdown structure, and do not add \
             part labels, summaries, or content from other parts.",
        );
    }
    prompt
}

fn translate_prompt_http(
    settings: &TranslateSettings,
    user_prompt: &str,
) -> Result<String, AppError> {
    let target_lang = settings.target_lang.trim();
    let model = settings.model.trim();
    let url = chat_completions_url(&settings.base_url);
    if url.is_empty() {
        return Err(AppError::Translate {
            message: "请先在设置中配置翻译 Base URL".into(),
        });
    }

    let multipart = user_prompt.contains("<!-- part:");
    let system = translate_system_prompt(target_lang, multipart);
    let body = json!({
        "model": model,
        "temperature": 0.2,
        "stream": false,
        "messages": [
            { "role": "system", "content": system },
            { "role": "user", "content": user_prompt },
        ],
    });

    let client = crate::proxy::blocking_client(Duration::from_secs(HTTP_TIMEOUT_SECS))
        .map_err(|error| AppError::Translate {
            message: format!("创建 HTTP 客户端失败：{error}"),
        })?;

    // Never log api_key. Error messages must not include the Authorization header.
    let response = client
        .post(&url)
        .header(
            "Authorization",
            format!("Bearer {}", settings.api_key.trim()),
        )
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
    parse_translate_api_response(status, &response_text)
}

fn percent_encode(value: &str, space_as_plus: bool) -> String {
    let mut out = String::new();
    for &byte in value.as_bytes() {
        match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                out.push(byte as char);
            }
            b' ' if space_as_plus => out.push('+'),
            _ => out.push_str(&format!("%{byte:02X}")),
        }
    }
    out
}

fn encode_form_q(value: &str) -> String {
    format!("q={}", percent_encode(value, true))
}

pub fn parse_google_translate_response(
    status: u16,
    response_text: &str,
) -> Result<String, AppError> {
    if !(200..300).contains(&status) {
        let snippet = sanitize_api_error_body(response_text, ERROR_BODY_SNIPPET_BYTES);
        return Err(AppError::Translate {
            message: format!("Google 公共翻译返回 HTTP {status}：{snippet}"),
        });
    }

    let mut trimmed = response_text.trim();
    if let Some(rest) = trimmed.strip_prefix(")]}'") {
        trimmed = rest.trim();
    }
    if trimmed.is_empty() {
        return Err(AppError::Translate {
            message: "Google 公共翻译返回空响应".into(),
        });
    }

    let value: serde_json::Value = serde_json::from_str(trimmed).map_err(|error| {
        let snippet = sanitize_api_error_body(trimmed, ERROR_BODY_SNIPPET_BYTES);
        AppError::Translate {
            message: format!("Google 公共翻译响应解析失败：{error}。片段：{snippet}"),
        }
    })?;

    let Some(sentences) = value.get(0).and_then(|item| item.as_array()) else {
        let snippet = sanitize_api_error_body(trimmed, ERROR_BODY_SNIPPET_BYTES);
        return Err(AppError::Translate {
            message: format!("Google 公共翻译响应格式无效。片段：{snippet}"),
        });
    };

    let mut out = String::new();
    for sentence in sentences {
        if let Some(text) = sentence.get(0).and_then(|item| item.as_str()) {
            out.push_str(text);
        }
    }
    if out.trim().is_empty() {
        return Err(AppError::Translate {
            message: "Google 公共翻译返回内容为空".into(),
        });
    }
    Ok(out)
}

fn translate_google_chunk_http(lang_code: &str, text: &str) -> Result<String, AppError> {
    let client = crate::proxy::blocking_client(Duration::from_secs(GOOGLE_HTTP_TIMEOUT_SECS))
        .map_err(|error| AppError::Translate {
            message: format!("创建 HTTP 客户端失败：{error}"),
        })?;

    let tl = percent_encode(lang_code, false);
    let url = format!("{GOOGLE_TRANSLATE_URL}?client=gtx&sl=auto&tl={tl}&dt=t&ie=UTF-8&oe=UTF-8");
    let response = client
        .post(&url)
        .header("User-Agent", GOOGLE_USER_AGENT)
        .header("Accept", "application/json")
        .header(
            "Content-Type",
            "application/x-www-form-urlencoded;charset=UTF-8",
        )
        .body(encode_form_q(text))
        .send()
        .map_err(|error| AppError::Translate {
            message: format!("请求 Google 公共翻译失败：{error}"),
        })?;

    let status = response.status().as_u16();
    let response_text = response.text().map_err(|error| AppError::Translate {
        message: format!("读取 Google 公共翻译响应失败：{error}"),
    })?;
    parse_google_translate_response(status, &response_text)
}

fn truncate_utf8_to_max_bytes(value: &mut String, max_bytes: usize) -> bool {
    if value.len() <= max_bytes {
        return false;
    }
    let mut end = max_bytes;
    while !value.is_char_boundary(end) {
        end -= 1;
    }
    value.truncate(end);
    true
}

fn redact_json_secret_fields(value: &mut serde_json::Value) {
    match value {
        serde_json::Value::Object(fields) => {
            for (key, value) in fields {
                if key.eq_ignore_ascii_case("api_key")
                    || key.eq_ignore_ascii_case("apiKey")
                    || key.eq_ignore_ascii_case("authorization")
                {
                    *value = serde_json::Value::String("***".into());
                } else {
                    redact_json_secret_fields(value);
                }
            }
        }
        serde_json::Value::Array(values) => {
            for value in values {
                redact_json_secret_fields(value);
            }
        }
        _ => {}
    }
}

fn find_ascii_case_insensitive(text: &str, start: usize, needle: &[u8]) -> Option<usize> {
    text.as_bytes()[start..]
        .windows(needle.len())
        .position(|window| window.eq_ignore_ascii_case(needle))
        .map(|offset| start + offset)
}

fn token_end(text: &str, start: usize) -> usize {
    text[start..]
        .char_indices()
        .find(|(_, ch)| {
            !(ch.is_ascii_alphanumeric() || matches!(ch, '-' | '_' | '.' | '~' | '+' | '/' | '='))
        })
        .map(|(offset, _)| start + offset)
        .unwrap_or(text.len())
}

fn find_bearer_token(text: &str, start: usize) -> Option<(usize, usize)> {
    let mut search_from = start;
    while let Some(found) = find_ascii_case_insensitive(text, search_from, b"bearer") {
        let after_word = found + "bearer".len();
        let has_boundary_before = found == 0 || !text.as_bytes()[found - 1].is_ascii_alphanumeric();
        let whitespace_len = text[after_word..]
            .chars()
            .take_while(|ch| ch.is_ascii_whitespace())
            .map(char::len_utf8)
            .sum::<usize>();
        if has_boundary_before && whitespace_len > 0 {
            return Some((found, after_word + whitespace_len));
        }
        search_from = after_word;
    }
    None
}

fn redact_api_tokens(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let mut cursor = 0;
    while cursor < text.len() {
        let bearer =
            find_bearer_token(text, cursor).map(|(start, token_start)| (start, token_start, false));
        let sk = find_ascii_case_insensitive(text, cursor, b"sk-")
            .map(|start| (start, start + "sk-".len(), true));
        let next = match (bearer, sk) {
            (Some(bearer), Some(sk)) => Some(if bearer.0 <= sk.0 { bearer } else { sk }),
            (Some(found), None) | (None, Some(found)) => Some(found),
            (None, None) => None,
        };
        let Some((start, token_start, is_sk)) = next else {
            out.push_str(&text[cursor..]);
            break;
        };
        let end = token_end(text, token_start);
        if end == token_start {
            out.push_str(&text[cursor..token_start]);
            cursor = token_start;
            continue;
        }
        out.push_str(&text[cursor..start]);
        if is_sk {
            out.push_str("sk-***");
        } else {
            out.push_str("bearer ***");
        }
        cursor = end;
    }
    out
}

fn sanitize_api_error_body(body: &str, max_bytes: usize) -> String {
    let mut text = if let Ok(mut value) = serde_json::from_str::<serde_json::Value>(body) {
        redact_json_secret_fields(&mut value);
        serde_json::to_string(&value).unwrap_or_else(|_| body.to_string())
    } else {
        body.to_string()
    };
    text = redact_api_tokens(&text);
    text = text.replace(['\n', '\r'], " ");
    let trimmed = text.trim();
    if trimmed.is_empty() {
        return "(空响应体)".into();
    }
    let mut out = trimmed.to_string();
    if truncate_utf8_to_max_bytes(&mut out, max_bytes) {
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
        assert!(!collected.prompt_body.contains("<!-- file:"));
        assert!(collected.prompt_body.contains("# Thresholds"));
        assert!(!collected.prompt_body.contains("# Hello"));
        assert!(!collected.truncated);
    }

    #[test]
    fn collects_large_file_without_truncation() {
        let dir = tempdir().unwrap();
        let relative_path = "SKILL.md";
        let content = format!("{}中文", "a".repeat(MAX_SOURCE_BYTES + 100));
        fs::write(dir.path().join(relative_path), &content).unwrap();

        let collected = collect_translate_source(dir.path(), relative_path).unwrap();
        assert!(!collected.truncated);
        assert_eq!(collected.prompt_body, content);
        assert!(collected.prompt_body.len() > MAX_SOURCE_BYTES);
    }

    #[test]
    fn splits_large_text_on_utf8_and_newline_boundaries() {
        let text = format!("{}中\n{}", "a".repeat(40), "b".repeat(40));
        let chunks = split_text_into_byte_chunks(&text, 50);
        assert!(chunks.len() >= 2);
        assert_eq!(chunks.join(""), text);
        for chunk in &chunks {
            assert!(chunk.len() <= 50);
            assert!(std::str::from_utf8(chunk.as_bytes()).is_ok());
        }
        assert!(chunks[0].ends_with('\n') || chunks.len() == 1);
    }

    #[test]
    fn translates_large_source_in_ordered_concurrent_batches() {
        use std::sync::{
            atomic::{AtomicUsize, Ordering},
            Mutex,
        };

        let settings = TranslateSettings {
            base_url: "https://api.openai.com/v1".into(),
            api_key: "sk-x".into(),
            model: "gpt-4o-mini".into(),
            target_lang: "中文".into(),
        };
        let body = format!(
            "one\n{}\ntwo\n{}\nthree\n{}",
            "a".repeat(40_000),
            "b".repeat(40_000),
            "c".repeat(40_000)
        );
        let source = CollectedSource {
            prompt_body: body.clone(),
            source_files: vec!["SKILL.md".into()],
            truncated: false,
            content_md5: content_md5_hex(&body),
        };

        let active = AtomicUsize::new(0);
        let peak = AtomicUsize::new(0);
        let seen = Mutex::new(Vec::new());
        let preview = translate_with_chunk_fn(&settings, &source, |_settings, prompt| {
            let current = active.fetch_add(1, Ordering::SeqCst) + 1;
            peak.fetch_max(current, Ordering::SeqCst);
            std::thread::sleep(Duration::from_millis(30));
            active.fetch_sub(1, Ordering::SeqCst);
            seen.lock().unwrap().push(prompt.to_string());
            let marker = prompt
                .lines()
                .find_map(|line| line.strip_prefix("<!-- part: "))
                .and_then(|rest| rest.strip_suffix(" -->"))
                .unwrap_or("1/1");
            Ok(format!("[{marker}]"))
        })
        .unwrap();

        let prompts = seen.lock().unwrap().clone();
        assert!(
            prompts.len() >= 2,
            "expected chunking, got {}",
            prompts.len()
        );
        assert!(peak.load(Ordering::SeqCst) <= TRANSLATE_CONCURRENCY);
        assert!(peak.load(Ordering::SeqCst) >= 2.min(prompts.len()));
        assert!(!preview.truncated);
        assert_eq!(
            preview.markdown,
            (1..=prompts.len())
                .map(|part| format!("[{part}/{}]", prompts.len()))
                .collect::<String>()
        );
        let mut part_labels: Vec<String> = prompts
            .iter()
            .map(|prompt| {
                assert!(prompt.contains("<!-- file: SKILL.md -->"));
                prompt
                    .lines()
                    .find_map(|line| {
                        line.strip_prefix("<!-- part: ")
                            .and_then(|rest| rest.strip_suffix(" -->"))
                            .map(str::to_string)
                    })
                    .expect("chunk prompt missing part marker")
            })
            .collect();
        part_labels.sort();
        let expected: Vec<String> = (1..=prompts.len())
            .map(|part| format!("{part}/{}", prompts.len()))
            .collect();
        assert_eq!(part_labels, expected);
    }

    #[test]
    fn retries_failed_chunk_translation_once() {
        use std::sync::atomic::{AtomicUsize, Ordering};

        let settings = TranslateSettings {
            base_url: "https://api.openai.com/v1".into(),
            api_key: "sk-x".into(),
            model: "gpt-4o-mini".into(),
            target_lang: "中文".into(),
        };
        let source = CollectedSource {
            prompt_body: "hello".into(),
            source_files: vec!["SKILL.md".into()],
            truncated: false,
            content_md5: content_md5_hex("hello"),
        };
        let attempts = AtomicUsize::new(0);
        let preview = translate_with_chunk_fn(&settings, &source, |_settings, prompt| {
            let attempt = attempts.fetch_add(1, Ordering::SeqCst) + 1;
            assert!(prompt.contains("<!-- file: SKILL.md -->"));
            if attempt == 1 {
                return Err(AppError::Translate {
                    message: "temporary failure".into(),
                });
            }
            Ok("[ok]".into())
        })
        .unwrap();
        assert_eq!(attempts.load(Ordering::SeqCst), 2);
        assert_eq!(preview.markdown, "[ok]");
    }

    #[test]
    fn stops_after_chunk_translation_retry_is_exhausted() {
        use std::sync::atomic::{AtomicUsize, Ordering};

        let settings = TranslateSettings {
            base_url: "https://api.openai.com/v1".into(),
            api_key: "sk-x".into(),
            model: "gpt-4o-mini".into(),
            target_lang: "中文".into(),
        };
        let source = CollectedSource {
            prompt_body: "hello".into(),
            source_files: vec!["SKILL.md".into()],
            truncated: false,
            content_md5: content_md5_hex("hello"),
        };
        let attempts = AtomicUsize::new(0);
        let error = translate_with_chunk_fn(&settings, &source, |_settings, _prompt| {
            attempts.fetch_add(1, Ordering::SeqCst);
            Err(AppError::Translate {
                message: "persistent failure".into(),
            })
        })
        .unwrap_err();
        assert_eq!(
            attempts.load(Ordering::SeqCst),
            TRANSLATE_CHUNK_MAX_ATTEMPTS
        );
        assert!(error.to_string().contains("persistent failure"));
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
    fn sanitize_strips_all_bearer_and_sk_tokens() {
        let raw = "Bearer first-token and bEaReR second.token plus sk-one and SK-two";
        let cleaned = sanitize_api_error_body(raw, 400);
        for secret in ["first-token", "second.token", "sk-one", "SK-two"] {
            assert!(!cleaned.contains(secret), "{cleaned}");
        }
        assert_eq!(cleaned.matches("***").count(), 4, "{cleaned}");
    }

    #[test]
    fn sanitize_strips_json_secret_fields_recursively() {
        let raw = r#"{"api_key":"first","apiKey":"second","AUTHORIZATION":"Basic third","nested":{"Api_Key":"fourth"},"safe":"kept"}"#;
        let cleaned = sanitize_api_error_body(raw, 400);
        for secret in ["first", "second", "third", "fourth"] {
            assert!(!cleaned.contains(secret), "{cleaned}");
        }
        assert!(cleaned.contains("kept"), "{cleaned}");
    }

    #[test]
    fn sanitize_truncates_chinese_at_utf8_boundary_after_redaction() {
        let raw = format!("Bearer secret {}", "中".repeat(200));
        let cleaned = sanitize_api_error_body(&raw, 20);
        assert!(!cleaned.contains("secret"), "{cleaned}");
        assert!(cleaned.ends_with('…'), "{cleaned}");
        assert!(cleaned.len() <= 23);
    }

    #[test]
    fn content_md5_changes_with_content() {
        // RFC / common test vectors
        assert_eq!(content_md5_hex(""), "d41d8cd98f00b204e9800998ecf8427e");
        assert_eq!(content_md5_hex("abc"), "900150983cd24fb0d6963f7d28e17f72");
        let a = content_md5_hex("# Hello\n");
        let b = content_md5_hex("# Hello\n\nChanged");
        assert_ne!(a, b);
        assert_eq!(a, content_md5_hex("# Hello\n"));
    }

    #[test]
    fn cache_key_covers_translation_configuration_without_raw_api_key() {
        let args = (
            "md5",
            "中文",
            "references\\doc.md",
            "https://example.com//v1/",
            "model-a",
            "sk-secret",
        );
        let key = translate_cache_key(args.0, args.1, args.2, args.3, args.4, args.5);
        assert!(key.starts_with("v2:"));
        assert!(!key.contains("sk-secret"));
        assert_eq!(
            key,
            translate_cache_key(
                args.0,
                args.1,
                "references/doc.md",
                "https://example.com/v1",
                args.4,
                args.5
            )
        );
        for changed in [
            translate_cache_key("other", args.1, args.2, args.3, args.4, args.5),
            translate_cache_key(args.0, "English", args.2, args.3, args.4, args.5),
            translate_cache_key(args.0, args.1, "other.md", args.3, args.4, args.5),
            translate_cache_key(
                args.0,
                args.1,
                args.2,
                "https://other.example/v1",
                args.4,
                args.5,
            ),
            translate_cache_key(args.0, args.1, args.2, args.3, "model-b", args.5),
            translate_cache_key(args.0, args.1, args.2, args.3, args.4, "sk-other"),
        ] {
            assert_ne!(key, changed);
        }
    }

    #[test]
    fn cache_hit_skips_translate_fn() {
        let dir = tempdir().unwrap();
        let settings = TranslateSettings {
            base_url: "https://api.openai.com/v1".into(),
            api_key: "sk-x".into(),
            model: "gpt-4o-mini".into(),
            target_lang: "中文".into(),
        };
        let source = CollectedSource {
            prompt_body: "<!-- file: SKILL.md -->\n# Hello".into(),
            source_files: vec!["SKILL.md".into()],
            truncated: false,
            content_md5: content_md5_hex("# Hello"),
        };

        let mut calls = 0_u32;
        let first = preview_translate_with_cache(dir.path(), &settings, &source, |s, src| {
            calls += 1;
            Ok(TranslatePreview {
                markdown: "# 你好".into(),
                source_files: src.source_files.clone(),
                truncated: src.truncated,
                target_lang: s.target_lang.clone(),
                model: s.model.clone(),
                from_cache: false,
            })
        })
        .unwrap();
        assert_eq!(calls, 1);
        assert!(!first.from_cache);
        assert_eq!(first.markdown, "# 你好");

        let second = preview_translate_with_cache(dir.path(), &settings, &source, |_s, _src| {
            calls += 1;
            panic!("translate_fn must not run on cache hit");
        })
        .unwrap();
        assert_eq!(calls, 1);
        assert!(second.from_cache);
        assert_eq!(second.markdown, "# 你好");
    }

    #[test]
    fn cache_miss_on_content_or_lang_change() {
        let dir = tempdir().unwrap();
        let mut settings = TranslateSettings {
            base_url: "https://api.openai.com/v1".into(),
            api_key: "sk-x".into(),
            model: "gpt-4o-mini".into(),
            target_lang: "中文".into(),
        };
        let source_v1 = CollectedSource {
            prompt_body: "<!-- file: SKILL.md -->\n# A".into(),
            source_files: vec!["SKILL.md".into()],
            truncated: false,
            content_md5: content_md5_hex("# A"),
        };
        preview_translate_with_cache(dir.path(), &settings, &source_v1, |s, src| {
            Ok(TranslatePreview {
                markdown: "中文A".into(),
                source_files: src.source_files.clone(),
                truncated: false,
                target_lang: s.target_lang.clone(),
                model: s.model.clone(),
                from_cache: false,
            })
        })
        .unwrap();

        let mut calls = 0_u32;
        let source_v2 = CollectedSource {
            prompt_body: "<!-- file: SKILL.md -->\n# B".into(),
            source_files: vec!["SKILL.md".into()],
            truncated: false,
            content_md5: content_md5_hex("# B"),
        };
        let changed = preview_translate_with_cache(dir.path(), &settings, &source_v2, |s, src| {
            calls += 1;
            Ok(TranslatePreview {
                markdown: "中文B".into(),
                source_files: src.source_files.clone(),
                truncated: false,
                target_lang: s.target_lang.clone(),
                model: s.model.clone(),
                from_cache: false,
            })
        })
        .unwrap();
        assert_eq!(calls, 1);
        assert!(!changed.from_cache);
        assert_eq!(changed.markdown, "中文B");

        settings.target_lang = "English".into();
        let lang_changed =
            preview_translate_with_cache(dir.path(), &settings, &source_v2, |s, src| {
                calls += 1;
                Ok(TranslatePreview {
                    markdown: "English B".into(),
                    source_files: src.source_files.clone(),
                    truncated: false,
                    target_lang: s.target_lang.clone(),
                    model: s.model.clone(),
                    from_cache: false,
                })
            })
            .unwrap();
        assert_eq!(calls, 2);
        assert!(!lang_changed.from_cache);
        assert_eq!(lang_changed.markdown, "English B");
    }

    #[test]
    fn cache_evicts_oldest_beyond_max() {
        let dir = tempdir().unwrap();
        let settings = TranslateSettings {
            base_url: "https://api.openai.com/v1".into(),
            api_key: "sk-x".into(),
            model: "m".into(),
            target_lang: "中文".into(),
        };
        for i in 0..(TRANSLATE_CACHE_MAX_ENTRIES + 3) {
            let body = format!("# doc {i}");
            let source = CollectedSource {
                prompt_body: format!("<!-- file: f{i}.md -->\n{body}"),
                source_files: vec![format!("f{i}.md")],
                truncated: false,
                content_md5: content_md5_hex(&body),
            };
            preview_translate_with_cache(dir.path(), &settings, &source, |s, src| {
                Ok(TranslatePreview {
                    markdown: format!("t{i}"),
                    source_files: src.source_files.clone(),
                    truncated: false,
                    target_lang: s.target_lang.clone(),
                    model: s.model.clone(),
                    from_cache: false,
                })
            })
            .unwrap();
        }
        let store = load_translate_cache(dir.path()).unwrap();
        assert!(store.entries.len() <= TRANSLATE_CACHE_MAX_ENTRIES);
    }

    fn sample_source(body: &str) -> CollectedSource {
        CollectedSource {
            prompt_body: body.into(),
            source_files: vec!["SKILL.md".into()],
            truncated: false,
            content_md5: content_md5_hex(body),
        }
    }

    #[test]
    fn maps_google_lang_codes() {
        assert_eq!(google_lang_code("中文"), "zh-CN");
        assert_eq!(google_lang_code("English"), "en");
        assert_eq!(google_lang_code("日本語"), "ja");
        assert_eq!(google_lang_code("zh_tw"), "zh-TW");
        assert_eq!(google_lang_code("it"), "it");
        assert_eq!(effective_target_lang(&TranslateSettings::default()), "中文");
    }

    #[test]
    fn parses_google_single_response() {
        let body = r#"[[["你好","Hello",null,null,10],["世界","World",null,null,0]],null,"en"]"#;
        assert_eq!(
            parse_google_translate_response(200, body).unwrap(),
            "你好世界"
        );

        let prefixed = ")]}'\n[[[\"bonjour\",\"hello\",null,null,1]]]";
        assert_eq!(
            parse_google_translate_response(200, prefixed).unwrap(),
            "bonjour"
        );

        let err = parse_google_translate_response(429, "rate limit").unwrap_err();
        assert!(err.to_string().contains("HTTP 429"));
    }

    #[test]
    fn google_chunks_are_translated_in_order() {
        let settings = TranslateSettings {
            target_lang: "中文".into(),
            ..TranslateSettings::default()
        };
        let body = format!("{}{}", "a".repeat(3_000), "b".repeat(3_000));
        let source = sample_source(&body);
        let preview = translate_google_with_chunk_fn(&settings, &source, |lang, chunk| {
            assert_eq!(lang, "zh-CN");
            Ok(format!("[{}]", chunk.len()))
        })
        .unwrap();
        assert_eq!(preview.model, GOOGLE_MODEL_LABEL);
        assert!(preview.markdown.starts_with('['));
        assert!(preview.markdown.contains("][") || preview.markdown.matches('[').count() == 1);
        assert_eq!(
            preview.markdown.matches('[').count(),
            preview.markdown.matches(']').count()
        );
        assert!(preview.markdown.matches('[').count() >= 2);
    }

    #[test]
    fn prefer_google_uses_google_even_when_model_is_configured() {
        let dir = tempdir().unwrap();
        let settings = TranslateSettings {
            base_url: "https://api.openai.com/v1".into(),
            api_key: "sk-x".into(),
            model: "gpt-4o-mini".into(),
            target_lang: "中文".into(),
        };
        let source = sample_source("# Hello");
        let mut google_calls = 0_u32;
        let mut model_calls = 0_u32;
        let preview = preview_translate_prefer_google(
            dir.path(),
            &settings,
            &source,
            |_s, src| {
                google_calls += 1;
                Ok(TranslatePreview {
                    markdown: "# 你好".into(),
                    source_files: src.source_files.clone(),
                    truncated: false,
                    target_lang: "中文".into(),
                    model: "ignored".into(),
                    from_cache: false,
                })
            },
            |_s, _src| {
                model_calls += 1;
                panic!("model must not run when google succeeds");
            },
        )
        .unwrap();
        assert_eq!(google_calls, 1);
        assert_eq!(model_calls, 0);
        assert_eq!(preview.markdown, "# 你好");
        assert_eq!(preview.model, GOOGLE_MODEL_LABEL);
        assert!(!preview.from_cache);

        let cached = preview_translate_prefer_google(
            dir.path(),
            &settings,
            &source,
            |_s, _src| panic!("google must not run on cache hit"),
            |_s, _src| panic!("model must not run on google cache hit"),
        )
        .unwrap();
        assert!(cached.from_cache);
        assert_eq!(cached.markdown, "# 你好");
    }

    #[test]
    fn prefer_google_falls_back_to_model_when_google_fails() {
        let dir = tempdir().unwrap();
        let settings = TranslateSettings {
            base_url: "https://api.openai.com/v1".into(),
            api_key: "sk-x".into(),
            model: "gpt-4o-mini".into(),
            target_lang: "中文".into(),
        };
        let source = sample_source("# Hello");
        let preview = preview_translate_prefer_google(
            dir.path(),
            &settings,
            &source,
            |_s, _src| {
                Err(AppError::Translate {
                    message: "Google down".into(),
                })
            },
            |s, src| {
                Ok(TranslatePreview {
                    markdown: "# model".into(),
                    source_files: src.source_files.clone(),
                    truncated: false,
                    target_lang: s.target_lang.clone(),
                    model: s.model.clone(),
                    from_cache: false,
                })
            },
        )
        .unwrap();
        assert_eq!(preview.markdown, "# model");
        assert_eq!(preview.model, "gpt-4o-mini");
        assert!(!preview.from_cache);
    }

    #[test]
    fn prefer_google_without_model_returns_google_error() {
        let dir = tempdir().unwrap();
        let settings = TranslateSettings::default();
        let source = sample_source("# Hello");
        let error = preview_translate_prefer_google(
            dir.path(),
            &settings,
            &source,
            |_s, _src| {
                Err(AppError::Translate {
                    message: "HTTP 429".into(),
                })
            },
            |_s, _src| panic!("model must not run when unconfigured"),
        )
        .unwrap_err();
        let message = error.to_string();
        assert!(message.contains("HTTP 429"), "{message}");
        assert!(message.contains("模型服务"), "{message}");
    }
}
