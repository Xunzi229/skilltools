export type Provider = "cursor" | "claude" | "codex";
export type SkillStatus = "active" | "paused";
export type BackupReason = "manual" | "beforeDelete";

export interface SkillSummary {
  id: string;
  name: string;
  description: string;
  provider: Provider;
  status: SkillStatus;
  originalPath: string;
  currentPath: string;
  warnings: string[];
}

export interface ScanResult {
  skills: SkillSummary[];
  warnings: string[];
}

export interface SkillDetail extends SkillSummary {
  skillMarkdown: string;
  files: string[];
}

export type FileNodeKind = "file" | "directory";

export interface FileNode {
  name: string;
  relativePath: string;
  kind: FileNodeKind;
  size: number | null;
  children: FileNode[];
}

export type FileMediaType = "markdown" | "text" | "unsupported";

export interface FileContent {
  relativePath: string;
  mediaType: FileMediaType;
  content: string | null;
  message: string | null;
}

export interface BackupRecord {
  id: string;
  skillId: string;
  skillName: string;
  provider: Provider;
  reason: BackupReason;
  createdAt: string;
  originalPath: string;
  archivePath: string;
  checksum: string;
}

export interface CommandError {
  code: string;
  message: string;
}
