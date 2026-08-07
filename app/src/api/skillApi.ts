import { invoke } from "@tauri-apps/api/core";
import type {
  BackupRecord,
  CommandError,
  FileContent,
  FileNode,
  ScanResult,
  SkillDetail,
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
  args?: Record<string, string>,
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
};
