use std::collections::{BTreeMap, HashMap};
use std::fs;
use std::path::Path;

use serde::{Deserialize, Serialize};
use serde_yaml::Value;

use crate::error::AppError;

const KNOWN_FIELD_ORDER: &[&str] = &[
    "name",
    "description",
    "license",
    "compatibility",
    "metadata",
    "allowed-tools",
    "tags",
    "version",
    "author",
    "homepage",
];

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FrontmatterValidation {
    pub ok: bool,
    pub name: Option<String>,
    pub description: Option<String>,
    pub fields: HashMap<String, String>,
    pub warnings: Vec<String>,
}

pub(crate) struct SkillMetadata {
    pub name: String,
    pub description: String,
    pub warnings: Vec<String>,
}

pub fn frontmatter_yaml(markdown: &str) -> Option<&str> {
    let mut lines = markdown.split_inclusive('\n');
    let opening = lines.next()?;
    if opening.trim_end_matches(['\r', '\n']) != "---" {
        return None;
    }

    let content_start = opening.len();
    let mut offset = content_start;
    for line in lines {
        let line_end = offset + line.len();
        if line.trim_end_matches(['\r', '\n']) == "---" {
            return Some(&markdown[content_start..offset]);
        }
        offset = line_end;
    }
    None
}

fn value_to_edit_string(value: &Value) -> String {
    match value {
        Value::String(text) => text.clone(),
        Value::Bool(flag) => flag.to_string(),
        Value::Number(number) => number.to_string(),
        Value::Null => String::new(),
        other => serde_yaml::to_string(other)
            .unwrap_or_default()
            .trim()
            .trim_start_matches("---")
            .trim()
            .to_owned(),
    }
}

fn mapping_to_fields(map: &serde_yaml::Mapping) -> HashMap<String, String> {
    let mut fields = HashMap::new();
    for (key, value) in map {
        if let Some(name) = key.as_str() {
            fields.insert(name.to_owned(), value_to_edit_string(value));
        }
    }
    fields
}

fn parse_field_value(key: &str, raw: &str) -> Value {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Value::String(String::new());
    }

    let try_structured = key == "metadata"
        || key == "tags"
        || trimmed.contains('\n')
        || trimmed.starts_with('[')
        || trimmed.starts_with('{');

    if try_structured {
        if let Ok(parsed) = serde_yaml::from_str::<Value>(trimmed) {
            match &parsed {
                Value::Mapping(_) | Value::Sequence(_) | Value::Bool(_) | Value::Number(_) => {
                    return parsed;
                }
                Value::String(_) | Value::Null => {}
                Value::Tagged(_) => return parsed,
            }
        }
    }

    Value::String(raw.to_owned())
}

fn fields_to_yaml(fields: &HashMap<String, String>) -> Result<String, AppError> {
    let mut ordered: BTreeMap<String, Value> = BTreeMap::new();
    for key in KNOWN_FIELD_ORDER {
        if let Some(value) = fields.get(*key) {
            if value.trim().is_empty() && *key != "name" && *key != "description" {
                continue;
            }
            ordered.insert((*key).to_owned(), parse_field_value(key, value));
        }
    }
    for (key, value) in fields {
        if KNOWN_FIELD_ORDER.contains(&key.as_str()) {
            continue;
        }
        if value.trim().is_empty() {
            continue;
        }
        ordered.insert(key.clone(), parse_field_value(key, value));
    }

    // Re-emit in preferred order (BTreeMap is alpha; rebuild manually).
    let mut map = serde_yaml::Mapping::new();
    for key in KNOWN_FIELD_ORDER {
        if let Some(value) = ordered.remove(*key) {
            map.insert(Value::String((*key).to_owned()), value);
        }
    }
    for (key, value) in ordered {
        map.insert(Value::String(key), value);
    }

    let yaml = serde_yaml::to_string(&Value::Mapping(map)).map_err(|error| AppError::Io {
        message: format!("无法序列化 frontmatter：{error}"),
    })?;
    let yaml = yaml.trim_start_matches("---\n").to_owned();
    if yaml.ends_with('\n') {
        Ok(yaml)
    } else {
        Ok(format!("{yaml}\n"))
    }
}

fn markdown_body_after_frontmatter(content: &str) -> String {
    if !content.starts_with("---") {
        return content.to_owned();
    }
    let mut lines = content.lines();
    let _ = lines.next();
    for line in lines.by_ref() {
        if line.trim() == "---" {
            let rest: Vec<&str> = lines.collect();
            let body = rest.join("\n");
            return body.trim_start_matches('\n').to_owned();
        }
    }
    content.to_owned()
}

pub fn validate_skill_frontmatter(content: &str) -> FrontmatterValidation {
    let mut warnings = Vec::new();
    let Some(yaml) = frontmatter_yaml(content) else {
        return FrontmatterValidation {
            ok: false,
            name: None,
            description: None,
            fields: HashMap::new(),
            warnings: vec!["缺少 YAML frontmatter（应以 --- 开头并闭合）".into()],
        };
    };
    match serde_yaml::from_str::<Value>(yaml) {
        Ok(Value::Mapping(map)) => {
            let fields = mapping_to_fields(&map);
            let name = fields.get("name").cloned();
            let description = fields.get("description").cloned();
            if name
                .as_ref()
                .map(|value| value.trim().is_empty())
                .unwrap_or(true)
            {
                warnings.push("frontmatter 缺少 name".into());
            }
            if description
                .as_ref()
                .map(|value| value.trim().is_empty())
                .unwrap_or(true)
            {
                warnings.push("frontmatter 缺少 description".into());
            }
            FrontmatterValidation {
                ok: warnings.is_empty(),
                name,
                description,
                fields,
                warnings,
            }
        }
        Ok(_) => FrontmatterValidation {
            ok: false,
            name: None,
            description: None,
            fields: HashMap::new(),
            warnings: vec!["SKILL.md frontmatter 必须是 YAML 映射".into()],
        },
        Err(error) => FrontmatterValidation {
            ok: false,
            name: None,
            description: None,
            fields: HashMap::new(),
            warnings: vec![format!("SKILL.md 的 YAML 格式错误：{error}")],
        },
    }
}

pub(crate) fn read_skill_metadata(skill_path: &Path) -> SkillMetadata {
    let mut metadata = SkillMetadata {
        name: skill_path
            .file_name()
            .map(|name| name.to_string_lossy().into_owned())
            .unwrap_or_default(),
        description: String::new(),
        warnings: Vec::new(),
    };
    match fs::read_to_string(skill_path.join("SKILL.md")) {
        Ok(markdown) => {
            let validated = validate_skill_frontmatter(&markdown);
            metadata.warnings.extend(validated.warnings);
            if let Some(name) = validated.name {
                if !name.trim().is_empty() {
                    metadata.name = name;
                }
            }
            if let Some(description) = validated.description {
                metadata.description = description;
            }
        }
        Err(error) => metadata
            .warnings
            .push(format!("无法读取 SKILL.md：{error}")),
    }
    metadata
}

pub fn update_frontmatter_fields(
    content: &str,
    name: Option<&str>,
    description: Option<&str>,
) -> Result<String, AppError> {
    if name.is_none() && description.is_none() {
        return Ok(content.to_owned());
    }
    if content.starts_with("---") {
        let mut lines = content.lines();
        let _ = lines.next();
        let mut out = String::from("---\n");
        let mut replaced_name = name.is_none();
        let mut replaced_description = description.is_none();
        let mut closed = false;
        for line in lines {
            if !closed && line.trim() == "---" {
                if !replaced_name {
                    if let Some(name) = name {
                        out.push_str(&format!("name: {name}\n"));
                    }
                }
                if !replaced_description {
                    if let Some(description) = description {
                        out.push_str(&format!("description: {description}\n"));
                    }
                }
                out.push_str("---");
                out.push('\n');
                closed = true;
                continue;
            }
            if !closed && name.is_some() && line.starts_with("name:") {
                out.push_str(&format!("name: {}\n", name.unwrap()));
                replaced_name = true;
                continue;
            }
            if !closed && description.is_some() && line.starts_with("description:") {
                out.push_str(&format!("description: {}\n", description.unwrap()));
                replaced_description = true;
                continue;
            }
            out.push_str(line);
            out.push('\n');
        }
        if !closed {
            return Err(AppError::Io {
                message: "SKILL.md frontmatter 不完整".into(),
            });
        }
        Ok(out)
    } else {
        let name = name.unwrap_or("skill");
        let description = description.unwrap_or(name);
        Ok(format!(
            "---\nname: {name}\ndescription: {description}\n---\n\n{content}"
        ))
    }
}

pub fn rewrite_skill_frontmatter_name(skill_dir: &Path, new_name: &str) -> Result<(), AppError> {
    let path = crate::skill_files::resolve_writable_file_path(skill_dir, "SKILL.md")?;
    let content = fs::read_to_string(&path)?;
    let updated = update_frontmatter_fields(&content, Some(new_name), None)?;
    fs::write(path, updated)?;
    Ok(())
}

pub fn write_skill_metadata(
    skill_dir: &Path,
    fields: &HashMap<String, String>,
) -> Result<FrontmatterValidation, AppError> {
    let name = fields
        .get("name")
        .map(|value| value.trim())
        .filter(|value| !value.is_empty())
        .ok_or_else(|| AppError::Io {
            message: "frontmatter 缺少 name".into(),
        })?;
    let description = fields
        .get("description")
        .map(|value| value.trim())
        .filter(|value| !value.is_empty())
        .ok_or_else(|| AppError::Io {
            message: "frontmatter 缺少 description".into(),
        })?;

    let mut normalized = fields.clone();
    normalized.insert("name".into(), name.to_owned());
    normalized.insert("description".into(), description.to_owned());

    let path = crate::skill_files::resolve_writable_file_path(skill_dir, "SKILL.md")?;
    let content = fs::read_to_string(&path).unwrap_or_default();
    let body = markdown_body_after_frontmatter(&content);
    let yaml = fields_to_yaml(&normalized)?;
    let updated = if body.is_empty() {
        format!("---\n{yaml}---\n")
    } else {
        format!("---\n{yaml}---\n\n{body}")
    };
    let validation = validate_skill_frontmatter(&updated);
    if !validation.ok {
        return Err(AppError::Io {
            message: validation
                .warnings
                .first()
                .cloned()
                .unwrap_or_else(|| "SKILL.md frontmatter 无效".into()),
        });
    }
    fs::write(path, updated)?;
    Ok(validation)
}

pub fn skill_content_fingerprint(skill_dir: &Path) -> String {
    use sha2::{Digest, Sha256};
    let markdown = fs::read_to_string(skill_dir.join("SKILL.md")).unwrap_or_default();
    Sha256::digest(markdown.as_bytes())
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn validates_and_updates_frontmatter() {
        let content = "---\nname: old\ndescription: d\n---\nbody\n";
        let validation = validate_skill_frontmatter(content);
        assert!(validation.ok);
        assert_eq!(validation.fields.get("name").map(String::as_str), Some("old"));
        let updated = update_frontmatter_fields(content, Some("new"), Some("desc")).unwrap();
        assert!(updated.contains("name: new"));
        assert!(updated.contains("description: desc"));
        assert!(updated.contains("body"));
    }

    #[test]
    fn rejects_missing_frontmatter() {
        let validation = validate_skill_frontmatter("# bare\n");
        assert!(!validation.ok);
        assert!(validation.fields.is_empty());
    }

    #[test]
    fn writes_extra_fields_and_preserves_body() {
        let dir = tempfile::tempdir().unwrap();
        let skill_dir = dir.path();
        fs::write(
            skill_dir.join("SKILL.md"),
            "---\nname: old\ndescription: d\nlicense: MIT\n---\n\n# Body\n",
        )
        .unwrap();
        let mut fields = HashMap::new();
        fields.insert("name".into(), "new-skill".into());
        fields.insert("description".into(), "useful skill".into());
        fields.insert("license".into(), "Apache-2.0".into());
        fields.insert("author".into(), "tester".into());
        fields.insert("metadata".into(), "version: \"1.0\"\norg: demo".into());
        let validation = write_skill_metadata(skill_dir, &fields).unwrap();
        assert!(validation.ok);
        let content = fs::read_to_string(skill_dir.join("SKILL.md")).unwrap();
        assert!(content.contains("name: new-skill"));
        assert!(content.contains("license: Apache-2.0"));
        assert!(content.contains("author: tester"));
        assert!(content.contains("metadata:"));
        assert!(content.contains("# Body"));
    }

    #[cfg(unix)]
    #[test]
    fn metadata_writes_reject_external_skill_md_symlink() {
        use std::os::unix::fs::symlink;

        let dir = tempfile::tempdir().unwrap();
        let outside = tempfile::tempdir().unwrap();
        let external = outside.path().join("external.md");
        let original = "---\nname: outside\ndescription: keep\n---\n";
        fs::write(&external, original).unwrap();
        symlink(&external, dir.path().join("SKILL.md")).unwrap();
        let mut fields = HashMap::new();
        fields.insert("name".into(), "changed".into());
        fields.insert("description".into(), "changed".into());

        assert!(write_skill_metadata(dir.path(), &fields).is_err());
        assert!(rewrite_skill_frontmatter_name(dir.path(), "changed").is_err());
        assert_eq!(fs::read_to_string(external).unwrap(), original);
    }
}
