import { invoke } from "@tauri-apps/api/core";
import type {
  BackupRecord,
  CommandError,
  FileContent,
  FileNode,
  LibrarySkillDetail,
  LibrarySkillSummary,
  Project,
  Provider,
  ScanResult,
  SkillDetail,
  SkillGroup,
  SkillInstallation,
  Tag,
} from "../model/skill";

export interface SkillApi {
  scanSkills(): Promise<ScanResult>;
  getSkillDetail(skillId: string): Promise<SkillDetail>;
  listSkillTree(skillId: string): Promise<FileNode[]>;
  readSkillFile(skillId: string, relativePath: string): Promise<FileContent>;
  pauseSkill(skillId: string): Promise<SkillDetail>;
  resumeSkill(skillId: string): Promise<SkillDetail>;
  createBackup(skillId: string): Promise<BackupRecord>;
  listBackups(): Promise<BackupRecord[]>;
  restoreBackup(backupId: string): Promise<SkillDetail>;
  deleteSkill(skillId: string): Promise<BackupRecord>;
  listProjects(): Promise<Project[]>;
  addLocalProject(path: string): Promise<Project>;
  addGitProject(url: string): Promise<Project>;
  pullGitProject(projectId: string): Promise<Project>;
  removeProject(projectId: string): Promise<void>;
  listLibrarySkills(): Promise<LibrarySkillSummary[]>;
  getLibrarySkillDetail(id: string): Promise<LibrarySkillDetail>;
  listLibrarySkillTree(id: string): Promise<FileNode[]>;
  readLibrarySkillFile(id: string, relativePath: string): Promise<FileContent>;
  installSkill(librarySkillId: string, provider: Provider): Promise<SkillInstallation>;
  uninstallSkill(librarySkillId: string, provider: Provider): Promise<void>;
  listInstallations(): Promise<SkillInstallation[]>;
  listTags(): Promise<Tag[]>;
  createTag(name: string, color: string | null): Promise<Tag>;
  renameTag(id: string, name: string): Promise<Tag>;
  deleteTag(id: string): Promise<void>;
  setSkillTags(skillId: string, tagIds: string[]): Promise<LibrarySkillSummary>;
  listGroups(): Promise<SkillGroup[]>;
  createGroup(name: string, order: number): Promise<SkillGroup>;
  renameGroup(id: string, name: string): Promise<SkillGroup>;
  updateGroupOrder(id: string, order: number): Promise<SkillGroup>;
  deleteGroup(id: string): Promise<void>;
  setSkillGroup(skillId: string, groupId: string | null): Promise<LibrarySkillSummary>;
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
  pauseSkill: (skillId) => call("pause_skill", { skillId }),
  resumeSkill: (skillId) => call("resume_skill", { skillId }),
  createBackup: (skillId) => call("create_backup", { skillId }),
  listBackups: () => call("list_backups"),
  restoreBackup: (backupId) => call("restore_backup", { backupId }),
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
  installSkill: (librarySkillId, provider) =>
    call("install_skill", { librarySkillId, provider }),
  uninstallSkill: (librarySkillId, provider) =>
    call("uninstall_skill", { librarySkillId, provider }),
  listInstallations: () => call("list_installations"),
  listTags: () => call("list_tags"),
  createTag: (name, color) => call("create_tag", { name, color }),
  renameTag: (id, name) => call("rename_tag", { id, name }),
  deleteTag: (id) => call("delete_tag", { id }),
  setSkillTags: (skillId, tagIds) => call("set_skill_tags", { skillId, tagIds }),
  listGroups: () => call("list_groups"),
  createGroup: (name, order) => call("create_group", { name, order }),
  renameGroup: (id, name) => call("rename_group", { id, name }),
  updateGroupOrder: (id, order) => call("update_group_order", { id, order }),
  deleteGroup: (id) => call("delete_group", { id }),
  setSkillGroup: (skillId, groupId) =>
    call("set_skill_group", { skillId, groupId }),
};
