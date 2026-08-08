use std::path::PathBuf;

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Provider {
    Cursor,
    Claude,
    Codex,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum SkillStatus {
    Active,
    Paused,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum BackupReason {
    Manual,
    BeforeDelete,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SkillSummary {
    pub id: String,
    pub name: String,
    pub description: String,
    pub provider: Provider,
    pub status: SkillStatus,
    pub original_path: PathBuf,
    pub current_path: PathBuf,
    /// 当 current_path 为符号链接时，解析后的真实 Skill 目录
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub resolved_path: Option<PathBuf>,
    pub warnings: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScanResult {
    pub skills: Vec<SkillSummary>,
    pub warnings: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SkillDetail {
    pub id: String,
    pub name: String,
    pub description: String,
    pub provider: Provider,
    pub status: SkillStatus,
    pub original_path: PathBuf,
    pub current_path: PathBuf,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub resolved_path: Option<PathBuf>,
    pub warnings: Vec<String>,
    pub skill_markdown: String,
    pub files: Vec<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum FileNodeKind {
    File,
    Directory,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileNode {
    pub name: String,
    pub relative_path: String,
    pub kind: FileNodeKind,
    pub size: Option<u64>,
    pub children: Vec<FileNode>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileContent {
    pub relative_path: String,
    pub media_type: String,
    pub content: Option<String>,
    pub message: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupRecord {
    pub id: String,
    pub skill_id: String,
    pub skill_name: String,
    pub provider: Provider,
    pub reason: BackupReason,
    pub created_at: DateTime<Utc>,
    pub original_path: PathBuf,
    pub archive_path: PathBuf,
    pub checksum: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PauseRecord {
    pub skill_id: String,
    pub provider: Provider,
    pub original_path: PathBuf,
    pub paused_path: PathBuf,
    pub paused_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ProjectSourceType {
    Local,
    Git,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Project {
    pub id: String,
    pub name: String,
    pub source_type: ProjectSourceType,
    pub local_path: PathBuf,
    pub remote_url: Option<String>,
    pub added_at: DateTime<Utc>,
    /// 内容最后更新时间（本地目录 mtime / Git HEAD 提交时间）
    #[serde(default)]
    pub last_updated_at: Option<DateTime<Utc>>,
    /// 最近一次 Git 克隆或拉取时间；本地项目为 None
    pub last_synced_at: Option<DateTime<Utc>>,
    pub warnings: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LibrarySkillSummary {
    pub id: String,
    pub project_id: String,
    pub name: String,
    pub description: String,
    pub relative_path: PathBuf,
    pub absolute_path: PathBuf,
    /// 所属父 Skill（位于父目录 `skills/` 下的嵌套 Skill）
    #[serde(default)]
    pub parent_skill_id: Option<String>,
    pub group_id: Option<String>,
    pub tag_ids: Vec<String>,
    #[serde(default)]
    pub installed_providers: Vec<Provider>,
    pub warnings: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SkillInstallation {
    pub library_skill_id: String,
    pub provider: Provider,
    pub source_path: PathBuf,
    pub target_path: PathBuf,
    pub installed_at: DateTime<Utc>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LibrarySkillDetail {
    #[serde(flatten)]
    pub summary: LibrarySkillSummary,
    pub skill_markdown: String,
    pub files: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Tag {
    pub id: String,
    pub name: String,
    pub color: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SkillGroup {
    pub id: String,
    pub name: String,
    pub order: i32,
}

#[cfg(test)]
mod tests {
    use std::path::PathBuf;

    use serde_json::json;

    use super::{Provider, SkillStatus, SkillSummary};

    #[test]
    fn model_serializes_frontend_fields_as_camel_case() {
        let summary = SkillSummary {
            id: "cursor:example".into(),
            name: "example".into(),
            description: "Example skill".into(),
            provider: Provider::Cursor,
            status: SkillStatus::Active,
            original_path: PathBuf::from("/skills/example"),
            current_path: PathBuf::from("/skills/example"),
            resolved_path: None,
            warnings: vec![],
        };

        let value = serde_json::to_value(summary).unwrap();

        assert_eq!(value["provider"], json!("cursor"));
        assert_eq!(value["status"], json!("active"));
        assert_eq!(value["originalPath"], json!("/skills/example"));
        assert_eq!(value["currentPath"], json!("/skills/example"));
    }
}
