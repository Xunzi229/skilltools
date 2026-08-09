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
  /** 符号链接解析后的真实 Skill 路径 */
  resolvedPath?: string | null;
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

export interface ExternalEditor {
  id: string;
  name: string;
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

export type ProjectSourceType = "local" | "git";

export interface Project {
  id: string;
  name: string;
  sourceType: ProjectSourceType;
  localPath: string;
  remoteUrl: string | null;
  addedAt: string;
  lastUpdatedAt: string | null;
  lastSyncedAt: string | null;
  warnings: string[];
}

export interface LibrarySkillSummary {
  id: string;
  projectId: string;
  name: string;
  description: string;
  relativePath: string;
  absolutePath: string;
  parentSkillId: string | null;
  groupId: string | null;
  tagIds: string[];
  installedProviders: Provider[];
  warnings: string[];
}

export interface LibrarySkillDetail extends LibrarySkillSummary {
  skillMarkdown: string;
  files: string[];
}

export interface SkillInstallation {
  librarySkillId: string;
  provider: Provider;
  sourcePath: string;
  targetPath: string;
  installedAt: string;
}

export interface Tag {
  id: string;
  name: string;
  color: string | null;
}

export interface SkillGroup {
  id: string;
  name: string;
  order: number;
}

export interface CommandError {
  code: string;
  message: string;
}

export type ThemePreference = "light" | "dark";

export interface SkillRootOverrides {
  cursor: string | null;
  claude: string | null;
  codex: string | null;
}

export interface AppSettings {
  theme: ThemePreference;
  skillRootOverrides: SkillRootOverrides;
  /** null = 永不按天清理 */
  backupRetentionDays: number | null;
  /** null = 不限制条数 */
  backupMaxCount: number | null;
}

export interface AppPathsInfo {
  appDataDir: string;
  disabledDir: string;
  backupsDir: string;
  libraryDir: string;
  cursorSkills: string;
  claudeSkills: string;
  codexSkills: string;
  defaultCursorSkills: string;
  defaultClaudeSkills: string;
  defaultCodexSkills: string;
}

export type InstallHealthKind =
  | "missingTarget"
  | "notSymlink"
  | "brokenLink"
  | "sourceMismatch"
  | "indexOrphan"
  | "diskOrphan";

export interface InstallHealthIssue {
  kind: InstallHealthKind;
  provider: Provider;
  librarySkillId: string | null;
  targetPath: string;
  message: string;
  repairable: boolean;
}

export interface InstallHealthReport {
  issues: InstallHealthIssue[];
  repaired: number;
}

export type BatchItemStatus = "success" | "failed" | "skipped";

export interface BatchItemResult {
  id: string;
  status: BatchItemStatus;
  message?: string | null;
}

export interface BatchResult {
  total: number;
  success: number;
  failed: number;
  skipped: number;
  items: BatchItemResult[];
}

export interface MigrateResult {
  project: Project;
  librarySkillId: string;
  replacedWithLink: boolean;
}

export interface UnmanagedSkill {
  skillId: string;
  name: string;
  provider: Provider;
  path: string;
  description: string;
}

export interface DuplicateSkillGroup {
  name: string;
  providers: Provider[];
  librarySkillIds: string[];
  unmanagedSkillIds: string[];
}

export interface InstallOverview {
  managed: SkillInstallation[];
  unmanaged: UnmanagedSkill[];
  duplicates: DuplicateSkillGroup[];
  health: InstallHealthReport;
}

export interface ProjectPullResult {
  project: Project;
  added: LibrarySkillSummary[];
  removed: LibrarySkillSummary[];
  changed: LibrarySkillSummary[];
}

export interface InstallPreset {
  id: string;
  name: string;
  skillIds: string[];
  providers: Provider[];
}

export interface FrontmatterValidation {
  ok: boolean;
  name: string | null;
  description: string | null;
  warnings: string[];
}
