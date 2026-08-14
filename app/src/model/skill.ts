export type Provider = "cursor" | "claude" | "codex";
export type SkillStatus = "active" | "paused";
export type BackupReason = "manual" | "beforeDelete";

export interface SkillProviderInstall {
  id: string;
  provider: Provider;
  currentPath: string;
  status: SkillStatus;
}

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
  /** 同一源路径下的全部 Provider（含自身） */
  providers?: Provider[];
  /** 除主条目外的同名源安装 */
  alsoInstalled?: SkillProviderInstall[];
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

/** 列表/侧栏：同一源路径去重后的 Provider 集合 */
export function skillProviders(skill: Pick<SkillSummary, "provider" | "providers">): Provider[] {
  if (skill.providers && skill.providers.length > 0) {
    return skill.providers;
  }
  return [skill.provider];
}

/** 去重/ join 键：Windows 路径 ASCII 小写；POSIX 路径保留大小写。 */
export function skillCanonicalKey(
  skill: Pick<SkillSummary, "resolvedPath" | "currentPath">,
): string {
  return normalizePathKey(skill.resolvedPath ?? skill.currentPath);
}

/** 与后端 normalize_path_key_str 同规则，供 taxonomy join / 列表去重共用 */
export function normalizePathKey(input: string | null | undefined): string {
  let raw = input ?? "";
  const original = raw;
  if (raw.slice(0, 8).toUpperCase() === "\\\\?\\UNC\\") {
    raw = `\\\\${raw.slice(8)}`;
  } else if (raw.slice(0, 4).toUpperCase() === "\\\\?\\") {
    raw = raw.slice("\\\\?\\".length);
  } else if (raw.slice(0, 8).toUpperCase() === "//?/UNC/") {
    raw = `//${raw.slice(8)}`;
  } else if (raw.slice(0, 4).toUpperCase() === "//?/") {
    raw = raw.slice("//?/".length);
  }

  const windowsStyle =
    original.startsWith("\\\\?\\") ||
    original.startsWith("//?/") ||
    original.startsWith("\\\\") ||
    raw.startsWith("\\\\") ||
    raw.startsWith("//") ||
    /^[A-Za-z]:/.test(raw);
  const normalized = windowsStyle
    ? raw.replace(/\\/g, "/").replace(/[A-Z]/g, (char) => char.toLowerCase())
    : raw;
  let prefix = "";
  let rest = normalized;
  if (normalized.startsWith("//")) {
    prefix = "//";
    rest = normalized.slice(2);
  }
  let key = prefix;
  let prevSlash = false;
  for (const ch of rest) {
    if (ch === "/") {
      if (prevSlash) continue;
      prevSlash = true;
      key += "/";
      continue;
    }
    prevSlash = false;
    key += ch;
  }
  while (key.length > 1 && key.endsWith("/")) {
    key = key.slice(0, -1);
  }
  return key;
}

export function skillMemberIds(skill: SkillSummary): string[] {
  const ids = [skill.id];
  for (const item of skill.alsoInstalled ?? []) {
    if (!ids.includes(item.id)) ids.push(item.id);
  }
  return ids;
}

/** 按侧栏 Provider 筛选时，优先定位到该 Provider 的安装 id */
export function skillIdForProviderFilter(
  skill: SkillSummary,
  filter: Provider | "all" | "paused" | string,
): string {
  if (filter === "cursor" || filter === "claude" || filter === "codex") {
    if (skill.provider === filter) return skill.id;
    const alt = skill.alsoInstalled?.find((item) => item.provider === filter);
    if (alt) return alt.id;
  }
  return skill.id;
}

export function skillMatchesSelection(
  skill: SkillSummary,
  selectedId: string | null,
): boolean {
  if (!selectedId) return false;
  return skillMemberIds(skill).includes(selectedId);
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
  archiveKind?: "directory" | "providerSymlink";
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
  /** Git 来源 owner/repo；无法解析时为 null/undefined */
  sourceRepo?: string | null;
  /** 可在浏览器打开的来源 URL */
  sourceUrl?: string | null;
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
  color: string | null;
}

export interface CommandError {
  code: string;
  message: string;
}

/** 前端 Git 导入占位（clone 完成前不在后端索引中） */
export type GitImportStatus = "importing" | "failed";

export interface GitImportItem {
  tempId: string;
  url: string;
  name: string;
  status: GitImportStatus;
  error: CommandError | null;
}

export type ThemePreference = "light" | "dark";

export interface SkillRootOverrides {
  cursor: string | null;
  claude: string | null;
  codex: string | null;
}

export interface TranslateSettings {
  /** e.g. https://api.openai.com/v1 */
  baseUrl: string;
  apiKey: string;
  model: string;
  /** e.g. 中文 / English / 日本語 */
  targetLang: string;
}

export type TranslateSkillSource = "provider" | "library";

export interface TranslatePreview {
  markdown: string;
  sourceFiles: string[];
  truncated: boolean;
  targetLang: string;
  model: string;
  /** 命中本地内容哈希缓存，未发起翻译请求 */
  fromCache?: boolean;
}

/** AI 智能分组/标签建议（可为新建名；null 表示未分组） */
export interface GroupSuggestion {
  skillId: string;
  groupName: string | null;
  tagNames?: string[];
}

export interface AiTaxonomyApplyItem {
  skillId: string;
  groupId: string | null;
  /** 若无 groupId 且有此名，应用前先创建分组 */
  newGroupName?: string | null;
  tagIds: string[];
  newTagNames: string[];
}

export interface SkillGroupAssignment {
  skillId: string;
  groupId: string | null;
}

export interface AppSettings {
  theme: ThemePreference;
  skillRootOverrides: SkillRootOverrides;
  /** null = 永不按天清理 */
  backupRetentionDays: number | null;
  /** null = 不限制条数 */
  backupMaxCount: number | null;
  /** 预览区字体名，如 Microsoft YaHei */
  previewFontFamily: string;
  previewFontSize: number;
  translate: TranslateSettings;
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
  /** 解析出的全部 frontmatter 字段（标量/嵌套均以字符串表示） */
  fields: Record<string, string>;
  warnings: string[];
}
