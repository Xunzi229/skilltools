use std::collections::{HashMap, HashSet};
use std::time::Duration;

use serde::{Deserialize, Serialize};
use serde_json::json;

use crate::error::AppError;
use crate::settings::TranslateSettings;
use crate::translate::{chat_completions_url, parse_translate_api_response};

const HTTP_TIMEOUT_SECS: u64 = 120;
const MAX_SKILLS_PER_REQUEST: usize = 40;
const MAX_DESC_CHARS: usize = 400;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GroupSuggestSkill {
    pub id: String,
    pub name: String,
    pub description: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GroupSuggestion {
    pub skill_id: String,
    /// Group name (existing or newly proposed), or null for ungrouped / uncertain.
    pub group_name: Option<String>,
    /// Suggested tag names to append (existing or newly proposed).
    #[serde(default)]
    pub tag_names: Vec<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ModelSuggestionRow {
    skill_id: String,
    #[serde(default)]
    group_name: Option<String>,
    #[serde(default)]
    tag_names: Vec<String>,
}

#[derive(Debug, Clone, Copy)]
pub struct SuggestOptions {
    pub allow_new_groups: bool,
    pub allow_new_tags: bool,
}

/// Suggest group/tag names for skills using an OpenAI-compatible chat API.
pub fn suggest_groups_with_openai_compatible(
    settings: &TranslateSettings,
    skills: &[GroupSuggestSkill],
    existing_groups: &[String],
    existing_tags: &[String],
    options: SuggestOptions,
) -> Result<Vec<GroupSuggestion>, AppError> {
    if !settings.is_configured() {
        return Err(AppError::Translate {
            message: "请先在设置中配置完整的翻译接口（Base URL、API Key、模型、目标语言）"
                .into(),
        });
    }
    if existing_groups.is_empty() && !options.allow_new_groups {
        return Err(AppError::Translate {
            message: "请先在侧栏创建至少一个分组，或开启「允许新建分组」".into(),
        });
    }
    if skills.is_empty() {
        return Err(AppError::Translate {
            message: "请先选择要分组的 Skill".into(),
        });
    }
    if skills.len() > MAX_SKILLS_PER_REQUEST {
        return Err(AppError::Translate {
            message: format!("单次最多识别 {MAX_SKILLS_PER_REQUEST} 个 Skill，请减少选中数量"),
        });
    }

    let model = settings.model.trim().to_string();
    let url = chat_completions_url(&settings.base_url);
    if url.is_empty() {
        return Err(AppError::Translate {
            message: "请先在设置中配置翻译 Base URL".into(),
        });
    }

    let allowed_groups: HashSet<String> = existing_groups
        .iter()
        .map(|name| name.trim().to_string())
        .filter(|name| !name.is_empty())
        .collect();
    let allowed_tags: HashSet<String> = existing_tags
        .iter()
        .map(|name| name.trim().to_string())
        .filter(|name| !name.is_empty())
        .collect();
    let group_list: Vec<&str> = existing_groups
        .iter()
        .map(|s| s.trim())
        .filter(|s| !s.is_empty())
        .collect();
    let tag_list: Vec<&str> = existing_tags
        .iter()
        .map(|s| s.trim())
        .filter(|s| !s.is_empty())
        .collect();

    let skill_payload: Vec<serde_json::Value> = skills
        .iter()
        .map(|skill| {
            let desc = truncate_chars(skill.description.trim(), MAX_DESC_CHARS);
            json!({
                "skillId": skill.id,
                "name": skill.name,
                "description": desc,
            })
        })
        .collect();

    let group_rule = if options.allow_new_groups {
        "Prefer existing group names. You may propose a short new Chinese/English group name \
         only when none of the existing groups fit; keep new names concise (2–8 chars / short phrase). \
         Prefer null over inventing vague buckets."
    } else {
        "Use only the provided existing group names. Prefer null over a weak match. Do NOT invent groups."
    };
    let tag_rule = if options.allow_new_tags {
        "tagNames: prefer existing tags; you may add a few short new tags when useful \
         (provider/platform/risk). Keep 0–3 tags per skill."
    } else if tag_list.is_empty() {
        "tagNames: always return []."
    } else {
        "tagNames: use only existing tag names; 0–3 per skill; empty array when unsure."
    };

    let system = format!(
        "You classify developer agent skills into groups and tags. \
         {group_rule} \
         Assign a groupName ONLY when the skill clearly and primarily belongs to that group \
         based on its description. If it could fit multiple groups, fits none well, \
         or you are not confident, return null for groupName. \
         {tag_rule} \
         Output ONLY a JSON array (no markdown fences, no commentary). \
         Each item: {{\"skillId\":\"...\",\"groupName\":\"name or null\",\"tagNames\":[\"...\"]}}. \
         Include every input skillId exactly once."
    );

    let user = format!(
        "Existing groups:\n{}\n\nExisting tags:\n{}\n\n\
         allowNewGroups={}\nallowNewTags={}\n\n\
         Skills to classify:\n{}",
        serde_json::to_string_pretty(&group_list).unwrap_or_else(|_| "[]".into()),
        serde_json::to_string_pretty(&tag_list).unwrap_or_else(|_| "[]".into()),
        options.allow_new_groups,
        options.allow_new_tags,
        serde_json::to_string_pretty(&skill_payload).unwrap_or_else(|_| "[]".into()),
    );

    let body = json!({
        "model": model,
        "temperature": 0.1,
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
            message: format!("请求分组识别接口失败（{url}）：{error}"),
        })?;

    let status = response.status().as_u16();
    let response_text = response.text().map_err(|error| AppError::Translate {
        message: format!("读取分组识别响应失败：{error}"),
    })?;

    let content = parse_translate_api_response(status, &response_text)?;
    parse_group_suggestions(
        &content,
        skills,
        &allowed_groups,
        &allowed_tags,
        options,
    )
}

fn truncate_chars(text: &str, max: usize) -> String {
    if text.chars().count() <= max {
        return text.to_string();
    }
    let mut out = text.chars().take(max).collect::<String>();
    out.push('…');
    out
}

fn strip_json_fence(raw: &str) -> &str {
    let trimmed = raw.trim();
    let without_fence = trimmed
        .strip_prefix("```json")
        .or_else(|| trimmed.strip_prefix("```JSON"))
        .or_else(|| trimmed.strip_prefix("```"))
        .unwrap_or(trimmed);
    without_fence
        .strip_suffix("```")
        .unwrap_or(without_fence)
        .trim()
}

fn resolve_name(name: &str, allowed: &HashSet<String>, allow_new: bool) -> Option<String> {
    let trimmed = name.trim();
    if trimmed.is_empty() {
        return None;
    }
    if allowed.contains(trimmed) {
        return Some(trimmed.to_string());
    }
    if let Some(existing) = allowed.iter().find(|candidate| {
        candidate.eq_ignore_ascii_case(trimmed)
            || candidate.to_ascii_lowercase() == trimmed.to_ascii_lowercase()
    }) {
        return Some(existing.clone());
    }
    if allow_new {
        return Some(trimmed.to_string());
    }
    None
}

fn parse_group_suggestions(
    raw: &str,
    skills: &[GroupSuggestSkill],
    allowed_groups: &HashSet<String>,
    allowed_tags: &HashSet<String>,
    options: SuggestOptions,
) -> Result<Vec<GroupSuggestion>, AppError> {
    let text = strip_json_fence(raw);
    let rows: Vec<ModelSuggestionRow> = serde_json::from_str(text).map_err(|error| {
        AppError::Translate {
            message: format!("分组识别结果不是有效 JSON：{error}"),
        }
    })?;

    let expected: HashSet<&str> = skills.iter().map(|s| s.id.as_str()).collect();
    let mut by_id: HashMap<String, (Option<String>, Vec<String>)> = HashMap::new();

    for row in rows {
        if !expected.contains(row.skill_id.as_str()) {
            continue;
        }
        let group_name = row
            .group_name
            .as_deref()
            .and_then(|name| resolve_name(name, allowed_groups, options.allow_new_groups));
        let mut tag_names = Vec::new();
        let mut seen = HashSet::new();
        for tag in row.tag_names {
            if let Some(resolved) = resolve_name(&tag, allowed_tags, options.allow_new_tags) {
                if seen.insert(resolved.clone()) {
                    tag_names.push(resolved);
                }
            }
            if tag_names.len() >= 3 {
                break;
            }
        }
        by_id.insert(row.skill_id, (group_name, tag_names));
    }

    Ok(skills
        .iter()
        .map(|skill| {
            let (group_name, tag_names) = by_id
                .get(&skill.id)
                .cloned()
                .unwrap_or((None, Vec::new()));
            GroupSuggestion {
                skill_id: skill.id.clone(),
                group_name,
                tag_names,
            }
        })
        .collect())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_json_array_and_filters_unknown_groups() {
        let skills = vec![
            GroupSuggestSkill {
                id: "a".into(),
                name: "alpha".into(),
                description: "review requirements".into(),
            },
            GroupSuggestSkill {
                id: "b".into(),
                name: "beta".into(),
                description: "generate code".into(),
            },
        ];
        let allowed_groups = HashSet::from(["需求评审".to_string(), "代码生成".to_string()]);
        let allowed_tags = HashSet::from(["cursor".to_string()]);
        let raw = r#"[
          {"skillId":"a","groupName":"需求评审","tagNames":["cursor","windows"]},
          {"skillId":"b","groupName":"不存在的组","tagNames":[]},
          {"skillId":"ghost","groupName":"代码生成"}
        ]"#;
        let out = parse_group_suggestions(
            raw,
            &skills,
            &allowed_groups,
            &allowed_tags,
            SuggestOptions {
                allow_new_groups: false,
                allow_new_tags: false,
            },
        )
        .unwrap();
        assert_eq!(
            out,
            vec![
                GroupSuggestion {
                    skill_id: "a".into(),
                    group_name: Some("需求评审".into()),
                    tag_names: vec!["cursor".into()],
                },
                GroupSuggestion {
                    skill_id: "b".into(),
                    group_name: None,
                    tag_names: vec![],
                },
            ]
        );
    }

    #[test]
    fn allows_new_group_and_tag_names() {
        let skills = vec![GroupSuggestSkill {
            id: "a".into(),
            name: "alpha".into(),
            description: "x".into(),
        }];
        let allowed_groups = HashSet::new();
        let allowed_tags = HashSet::new();
        let raw = r#"[{"skillId":"a","groupName":"新分组","tagNames":["实验性"]}]"#;
        let out = parse_group_suggestions(
            raw,
            &skills,
            &allowed_groups,
            &allowed_tags,
            SuggestOptions {
                allow_new_groups: true,
                allow_new_tags: true,
            },
        )
        .unwrap();
        assert_eq!(out[0].group_name.as_deref(), Some("新分组"));
        assert_eq!(out[0].tag_names, vec!["实验性".to_string()]);
    }

    #[test]
    fn strips_markdown_fence() {
        let skills = vec![GroupSuggestSkill {
            id: "a".into(),
            name: "alpha".into(),
            description: "x".into(),
        }];
        let allowed_groups = HashSet::from(["代码生成".to_string()]);
        let allowed_tags = HashSet::new();
        let raw = "```json\n[{\"skillId\":\"a\",\"groupName\":\"代码生成\",\"tagNames\":[]}]\n```";
        let out = parse_group_suggestions(
            raw,
            &skills,
            &allowed_groups,
            &allowed_tags,
            SuggestOptions {
                allow_new_groups: false,
                allow_new_tags: false,
            },
        )
        .unwrap();
        assert_eq!(out[0].group_name.as_deref(), Some("代码生成"));
    }
}
