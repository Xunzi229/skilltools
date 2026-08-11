import { invoke } from "@tauri-apps/api/core";
import type {
  AppPathsInfo,
  AppSettings,
  BackupRecord,
  BatchResult,
  CommandError,
  ExternalEditor,
  FileContent,
  FileNode,
  FrontmatterValidation,
  InstallHealthReport,
  InstallOverview,
  InstallPreset,
  LibrarySkillDetail,
  LibrarySkillSummary,
  MigrateResult,
  Project,
  ProjectPullResult,
  Provider,
  ScanResult,
  SkillDetail,
  SkillGroup,
  SkillInstallation,
  Tag,
  GroupSuggestion,
  TranslatePreview,
  TranslateSkillSource,
} from "../model/skill";

export interface SkillApi {
  scanSkills(): Promise<ScanResult>;
  getSkillDetail(skillId: string): Promise<SkillDetail>;
  listSkillTree(skillId: string): Promise<FileNode[]>;
  readSkillFile(skillId: string, relativePath: string): Promise<FileContent>;
  writeSkillFile(
    skillId: string,
    relativePath: string,
    content: string,
  ): Promise<void>;
  listExternalEditors(): Promise<ExternalEditor[]>;
  openSkillFileExternal(
    skillId: string,
    relativePath: string,
    editorId: string,
  ): Promise<void>;
  openLibrarySkillFileExternal(
    id: string,
    relativePath: string,
    editorId: string,
  ): Promise<void>;
  pauseSkill(skillId: string): Promise<SkillDetail>;
  resumeSkill(skillId: string): Promise<SkillDetail>;
  createBackup(skillId: string): Promise<BackupRecord>;
  listBackups(): Promise<BackupRecord[]>;
  restoreBackup(backupId: string): Promise<SkillDetail>;
  deleteBackup(backupId: string): Promise<void>;
  cleanupBackups(): Promise<number>;
  deleteSkill(skillId: string): Promise<BackupRecord>;
  listProjects(): Promise<Project[]>;
  addLocalProject(path: string): Promise<Project>;
  addGitProject(url: string): Promise<Project>;
  pullGitProject(projectId: string): Promise<ProjectPullResult>;
  removeProject(projectId: string): Promise<void>;
  listLibrarySkills(): Promise<LibrarySkillSummary[]>;
  getLibrarySkillDetail(id: string): Promise<LibrarySkillDetail>;
  listLibrarySkillTree(id: string): Promise<FileNode[]>;
  readLibrarySkillFile(id: string, relativePath: string): Promise<FileContent>;
  writeLibrarySkillFile(
    id: string,
    relativePath: string,
    content: string,
  ): Promise<void>;
  installSkill(librarySkillId: string, provider: Provider): Promise<SkillInstallation>;
  uninstallSkill(librarySkillId: string, provider: Provider): Promise<void>;
  listInstallations(): Promise<SkillInstallation[]>;
  getInstallOverview(): Promise<InstallOverview>;
  scanInstallHealth(): Promise<InstallHealthReport>;
  repairInstallations(): Promise<InstallHealthReport>;
  migrateProviderSkill(
    skillId: string,
    replaceWithLink: boolean,
  ): Promise<MigrateResult>;
  listInstallPresets(): Promise<InstallPreset[]>;
  saveInstallPreset(
    id: string | null,
    name: string,
    skillIds: string[],
    providers: Provider[],
  ): Promise<InstallPreset>;
  deleteInstallPreset(id: string): Promise<void>;
  applyInstallPreset(id: string): Promise<BatchResult>;
  validateSkillFrontmatter(content: string): Promise<FrontmatterValidation>;
  updateSkillMetadata(
    skillId: string,
    fields: Record<string, string>,
  ): Promise<FrontmatterValidation>;
  updateLibrarySkillMetadata(
    librarySkillId: string,
    fields: Record<string, string>,
  ): Promise<FrontmatterValidation>;
  createLibrarySkill(
    name: string,
    description: string,
    projectId?: string | null,
  ): Promise<LibrarySkillSummary>;
  renameLibrarySkill(skillId: string, newName: string): Promise<LibrarySkillSummary>;
  deleteLibrarySkill(skillId: string): Promise<void>;
  listTags(): Promise<Tag[]>;
  createTag(name: string, color: string | null): Promise<Tag>;
  renameTag(id: string, name: string): Promise<Tag>;
  updateTag(id: string, name: string, color: string | null): Promise<Tag>;
  deleteTag(id: string): Promise<void>;
  setSkillTags(skillId: string, tagIds: string[]): Promise<LibrarySkillSummary>;
  listGroups(): Promise<SkillGroup[]>;
  createGroup(
    name: string,
    order: number,
    color: string | null,
  ): Promise<SkillGroup>;
  renameGroup(id: string, name: string): Promise<SkillGroup>;
  updateGroup(
    id: string,
    name: string,
    color: string | null,
  ): Promise<SkillGroup>;
  updateGroupOrder(id: string, order: number): Promise<SkillGroup>;
  deleteGroup(id: string): Promise<void>;
  setSkillGroup(skillId: string, groupId: string | null): Promise<LibrarySkillSummary>;
  getSettings(): Promise<AppSettings>;
  listSystemFonts(): Promise<string[]>;
  saveSettings(settings: AppSettings): Promise<AppSettings>;
  previewTranslateSkill(
    source: TranslateSkillSource,
    skillId: string,
    relativePath: string,
  ): Promise<TranslatePreview>;
  suggestSkillGroups(
    skillIds: string[],
    options?: { allowNewGroups?: boolean; allowNewTags?: boolean },
  ): Promise<GroupSuggestion[]>;
  getAppPaths(): Promise<AppPathsInfo>;
  revealPath(path: string): Promise<void>;
  exportLibrarySkillZip(id: string, destPath: string): Promise<void>;
  exportProjectZip(projectId: string, destPath: string): Promise<void>;
  importSkillZip(zipPath: string): Promise<Project>;
  batchPauseSkills(skillIds: string[]): Promise<BatchResult>;
  batchResumeSkills(skillIds: string[]): Promise<BatchResult>;
  batchBackupSkills(skillIds: string[]): Promise<BatchResult>;
  batchDeleteSkills(skillIds: string[]): Promise<BatchResult>;
  batchInstallSkills(skillIds: string[], provider: Provider): Promise<BatchResult>;
  batchUninstallSkills(
    skillIds: string[],
    provider: Provider,
  ): Promise<BatchResult>;
  batchSetSkillGroup(
    skillIds: string[],
    groupId: string | null,
  ): Promise<BatchResult>;
  batchAddSkillTags(skillIds: string[], tagId: string): Promise<BatchResult>;
  batchRemoveSkillTags(skillIds: string[], tagId: string): Promise<BatchResult>;
  batchSetSkillTags(skillIds: string[], tagIds: string[]): Promise<BatchResult>;
  batchMigrateProviderSkills(
    skillIds: string[],
    replaceWithLink: boolean,
  ): Promise<BatchResult>;
}

const unknownError: CommandError = {
  code: "UNKNOWN",
  message: "操作失败，请重试",
};

function isCommandError(error: unknown): error is CommandError {
  if (typeof error !== "object" || error === null) {
    return false;
  }

  const candidate = error as Record<string, unknown>;
  return typeof candidate.code === "string" && typeof candidate.message === "string";
}

async function call<T>(
  command: string,
  args?: Record<string, unknown>,
): Promise<T> {
  try {
    return await invoke<T>(command, args);
  } catch (error) {
    throw isCommandError(error) ? error : unknownError;
  }
}

export const tauriSkillApi: SkillApi = {
  scanSkills: () => call("scan_skills"),
  getSkillDetail: (skillId) => call("get_skill_detail", { skillId }),
  listSkillTree: (skillId) => call("list_skill_tree", { skillId }),
  readSkillFile: (skillId, relativePath) =>
    call("read_skill_file", { skillId, relativePath }),
  writeSkillFile: (skillId, relativePath, content) =>
    call("write_skill_file", { skillId, relativePath, content }),
  listExternalEditors: () => call("list_external_editors"),
  openSkillFileExternal: (skillId, relativePath, editorId) =>
    call("open_skill_file_external", { skillId, relativePath, editorId }),
  openLibrarySkillFileExternal: (id, relativePath, editorId) =>
    call("open_library_skill_file_external", { id, relativePath, editorId }),
  pauseSkill: (skillId) => call("pause_skill", { skillId }),
  resumeSkill: (skillId) => call("resume_skill", { skillId }),
  createBackup: (skillId) => call("create_backup", { skillId }),
  listBackups: () => call("list_backups"),
  restoreBackup: (backupId) => call("restore_backup", { backupId }),
  deleteBackup: (backupId) => call("delete_backup", { backupId }),
  cleanupBackups: () => call("cleanup_backups"),
  deleteSkill: (skillId) => call("delete_skill", { skillId }),
  listProjects: () => call("list_projects"),
  addLocalProject: (path) => call("add_local_project", { path }),
  addGitProject: (url) => call("add_git_project", { url }),
  pullGitProject: (projectId) => call("pull_git_project", { projectId }),
  removeProject: (projectId) => call("remove_project", { projectId }),
  listLibrarySkills: () => call("list_library_skills"),
  getLibrarySkillDetail: (id) => call("get_library_skill_detail", { id }),
  listLibrarySkillTree: (id) => call("list_library_skill_tree", { id }),
  readLibrarySkillFile: (id, relativePath) =>
    call("read_library_skill_file", { id, relativePath }),
  writeLibrarySkillFile: (id, relativePath, content) =>
    call("write_library_skill_file", { id, relativePath, content }),
  installSkill: (librarySkillId, provider) =>
    call("install_skill", { librarySkillId, provider }),
  uninstallSkill: (librarySkillId, provider) =>
    call("uninstall_skill", { librarySkillId, provider }),
  listInstallations: () => call("list_installations"),
  getInstallOverview: () => call("get_install_overview"),
  scanInstallHealth: () => call("scan_install_health"),
  repairInstallations: () => call("repair_installations"),
  migrateProviderSkill: (skillId, replaceWithLink) =>
    call("migrate_provider_skill", { skillId, replaceWithLink }),
  listInstallPresets: () => call("list_install_presets"),
  saveInstallPreset: (id, name, skillIds, providers) =>
    call("save_install_preset", { id, name, skillIds, providers }),
  deleteInstallPreset: (id) => call("delete_install_preset", { id }),
  applyInstallPreset: (id) => call("apply_install_preset", { id }),
  validateSkillFrontmatter: (content) =>
    call("validate_skill_frontmatter", { content }),
  updateSkillMetadata: (skillId, fields) =>
    call("update_skill_metadata", { skillId, fields }),
  updateLibrarySkillMetadata: (librarySkillId, fields) =>
    call("update_library_skill_metadata", { librarySkillId, fields }),
  createLibrarySkill: (name, description, projectId = null) =>
    call("create_library_skill", { name, description, projectId }),
  renameLibrarySkill: (skillId, newName) =>
    call("rename_library_skill", { skillId, newName }),
  deleteLibrarySkill: (skillId) => call("delete_library_skill", { skillId }),
  listTags: () => call("list_tags"),
  createTag: (name, color) => call("create_tag", { name, color }),
  renameTag: (id, name) => call("rename_tag", { id, name }),
  updateTag: (id, name, color) => call("update_tag", { id, name, color }),
  deleteTag: (id) => call("delete_tag", { id }),
  setSkillTags: (skillId, tagIds) => call("set_skill_tags", { skillId, tagIds }),
  listGroups: () => call("list_groups"),
  createGroup: (name, order, color) =>
    call("create_group", { name, order, color }),
  renameGroup: (id, name) => call("rename_group", { id, name }),
  updateGroup: (id, name, color) => call("update_group", { id, name, color }),
  updateGroupOrder: (id, order) => call("update_group_order", { id, order }),
  deleteGroup: (id) => call("delete_group", { id }),
  setSkillGroup: (skillId, groupId) =>
    call("set_skill_group", { skillId, groupId }),
  getSettings: () => call("get_settings"),
  listSystemFonts: () => call("list_system_fonts"),
  saveSettings: (settings) => call("save_settings", { next: settings }),
  previewTranslateSkill: (source, skillId, relativePath) =>
    call("preview_translate_skill", { source, skillId, relativePath }),
  suggestSkillGroups: (skillIds, options) =>
    call("suggest_skill_groups", {
      skillIds,
      allowNewGroups: options?.allowNewGroups ?? false,
      allowNewTags: options?.allowNewTags ?? false,
    }),
  getAppPaths: () => call("get_app_paths"),
  revealPath: (path) => call("reveal_path", { path }),
  exportLibrarySkillZip: (id, destPath) =>
    call("export_library_skill_zip", { id, destPath }),
  exportProjectZip: (projectId, destPath) =>
    call("export_project_zip", { projectId, destPath }),
  importSkillZip: (zipPath) => call("import_skill_zip", { zipPath }),
  batchPauseSkills: (skillIds) => call("batch_pause_skills", { skillIds }),
  batchResumeSkills: (skillIds) => call("batch_resume_skills", { skillIds }),
  batchBackupSkills: (skillIds) => call("batch_backup_skills", { skillIds }),
  batchDeleteSkills: (skillIds) => call("batch_delete_skills", { skillIds }),
  batchInstallSkills: (skillIds, provider) =>
    call("batch_install_skills", { skillIds, provider }),
  batchUninstallSkills: (skillIds, provider) =>
    call("batch_uninstall_skills", { skillIds, provider }),
  batchSetSkillGroup: (skillIds, groupId) =>
    call("batch_set_skill_group", { skillIds, groupId }),
  batchAddSkillTags: (skillIds, tagId) =>
    call("batch_add_skill_tags", { skillIds, tagId }),
  batchRemoveSkillTags: (skillIds, tagId) =>
    call("batch_remove_skill_tags", { skillIds, tagId }),
  batchSetSkillTags: (skillIds, tagIds) =>
    call("batch_set_skill_tags", { skillIds, tagIds }),
  batchMigrateProviderSkills: (skillIds, replaceWithLink) =>
    call("batch_migrate_provider_skills", { skillIds, replaceWithLink }),
};
