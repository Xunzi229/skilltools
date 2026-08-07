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
            warnings: vec![],
        };

        let value = serde_json::to_value(summary).unwrap();

        assert_eq!(value["provider"], json!("cursor"));
        assert_eq!(value["status"], json!("active"));
        assert_eq!(value["originalPath"], json!("/skills/example"));
        assert_eq!(value["currentPath"], json!("/skills/example"));
    }
}
