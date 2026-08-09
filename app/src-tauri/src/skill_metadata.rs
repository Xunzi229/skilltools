use std::fs;
use std::path::Path;

use serde::{Deserialize, Serialize};

use crate::error::AppError;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FrontmatterValidation {
    pub ok: bool,
    pub name: Option<String>,
    pub description: Option<String>,
    pub warnings: Vec<String>,
}

#[derive(Deserialize)]
struct Frontmatter {
    name: Option<String>,
    description: Option<String>,
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

pub fn validate_skill_frontmatter(content: &str) -> FrontmatterValidation {
    let mut warnings = Vec::new();
    let Some(yaml) = frontmatter_yaml(content) else {
        return FrontmatterValidation {
            ok: false,
            name: None,
            description: None,
            warnings: vec!["缺少 YAML frontmatter（应以 --- 开头并闭合）".into()],
        };
    };
    match serde_yaml::from_str::<Frontmatter>(yaml) {
        Ok(frontmatter) => {
            if frontmatter
                .name
                .as_ref()
                .map(|name| name.trim().is_empty())
                .unwrap_or(true)
            {
                warnings.push("frontmatter 缺少 name".into());
            }
            if frontmatter
                .description
                .as_ref()
                .map(|description| description.trim().is_empty())
                .unwrap_or(true)
            {
                warnings.push("frontmatter 缺少 description".into());
            }
            FrontmatterValidation {
                ok: warnings.is_empty(),
                name: frontmatter.name,
                description: frontmatter.description,
                warnings,
            }
        }
        Err(error) => FrontmatterValidation {
            ok: false,
            name: None,
            description: None,
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
    let path = skill_dir.join("SKILL.md");
    let content = fs::read_to_string(&path)?;
    let updated = update_frontmatter_fields(&content, Some(new_name), None)?;
    fs::write(path, updated)?;
    Ok(())
}

pub fn write_skill_metadata(
    skill_dir: &Path,
    name: &str,
    description: &str,
) -> Result<FrontmatterValidation, AppError> {
    let path = skill_dir.join("SKILL.md");
    let content = fs::read_to_string(&path).unwrap_or_default();
    let updated = update_frontmatter_fields(&content, Some(name), Some(description))?;
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
        let updated = update_frontmatter_fields(content, Some("new"), Some("desc")).unwrap();
        assert!(updated.contains("name: new"));
        assert!(updated.contains("description: desc"));
        assert!(updated.contains("body"));
    }

    #[test]
    fn rejects_missing_frontmatter() {
        let validation = validate_skill_frontmatter("# bare\n");
        assert!(!validation.ok);
    }
}
