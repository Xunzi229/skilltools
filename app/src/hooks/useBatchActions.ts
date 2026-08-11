import { useCallback, useState } from "react";
import type { SkillApi } from "../api/skillApi";
import type { BatchResult, Provider, SkillGroupAssignment } from "../model/skill";

export function useBatchActions(api: SkillApi) {
  const [batchBusy, setBatchBusy] = useState(false);
  const [batchResult, setBatchResult] = useState<BatchResult | null>(null);

  const clearBatchResult = useCallback(() => setBatchResult(null), []);

  const run = useCallback(async (action: () => Promise<BatchResult>) => {
    setBatchBusy(true);
    setBatchResult(null);
    try {
      const result = await action();
      setBatchResult(result);
      return result;
    } finally {
      setBatchBusy(false);
    }
  }, []);

  return {
    batchBusy,
    batchResult,
    clearBatchResult,
    batchPauseSkills: (skillIds: string[]) =>
      run(() => api.batchPauseSkills(skillIds)),
    batchResumeSkills: (skillIds: string[]) =>
      run(() => api.batchResumeSkills(skillIds)),
    batchBackupSkills: (skillIds: string[]) =>
      run(() => api.batchBackupSkills(skillIds)),
    batchDeleteSkills: (skillIds: string[]) =>
      run(() => api.batchDeleteSkills(skillIds)),
    batchInstallSkills: (skillIds: string[], provider: Provider) =>
      run(() => api.batchInstallSkills(skillIds, provider)),
    batchUninstallSkills: (skillIds: string[], provider: Provider) =>
      run(() => api.batchUninstallSkills(skillIds, provider)),
    batchSetSkillGroup: (skillIds: string[], groupId: string | null) =>
      run(() => api.batchSetSkillGroup(skillIds, groupId)),
    batchApplySkillGroups: (assignments: SkillGroupAssignment[]) =>
      run(async () => {
        const buckets = new Map<string, string[]>();
        for (const item of assignments) {
          const key = item.groupId ?? "__none__";
          const list = buckets.get(key) ?? [];
          list.push(item.skillId);
          buckets.set(key, list);
        }
        const merged: BatchResult = {
          total: 0,
          success: 0,
          failed: 0,
          skipped: 0,
          items: [],
        };
        for (const [key, skillIds] of buckets) {
          const groupId = key === "__none__" ? null : key;
          const result = await api.batchSetSkillGroup(skillIds, groupId);
          merged.total += result.total;
          merged.success += result.success;
          merged.failed += result.failed;
          merged.skipped += result.skipped;
          merged.items.push(...result.items);
        }
        return merged;
      }),
    batchAddSkillTags: (skillIds: string[], tagId: string) =>
      run(() => api.batchAddSkillTags(skillIds, tagId)),
    batchRemoveSkillTags: (skillIds: string[], tagId: string) =>
      run(() => api.batchRemoveSkillTags(skillIds, tagId)),
    batchSetSkillTags: (skillIds: string[], tagIds: string[]) =>
      run(() => api.batchSetSkillTags(skillIds, tagIds)),
    batchMigrateProviderSkills: (skillIds: string[], replaceWithLink: boolean) =>
      run(() => api.batchMigrateProviderSkills(skillIds, replaceWithLink)),
  };
}

export function formatBatchSummary(result: BatchResult): string {
  const firstError = result.items.find((item) => item.status === "failed")?.message;
  const skipped =
    result.skipped > 0 ? `，跳过 ${result.skipped}` : "";
  return `批量完成：成功 ${result.success}，失败 ${result.failed}${skipped}${
    firstError ? `；${firstError}` : ""
  }`;
}
