import { useCallback, useRef, useState } from "react";
import type { SkillApi } from "../api/skillApi";
import type {
  BatchResult,
  CommandError,
  Provider,
  SkillGroupAssignment,
} from "../model/skill";
import { t } from "../i18n";
import { normalizeCommandError } from "../utils/errors";

type BatchScope = "library" | "installed";

export function useBatchActions(api: SkillApi) {
  const [batchBusy, setBatchBusy] = useState(false);
  const [batchResult, setBatchResult] = useState<BatchResult | null>(null);
  const [batchError, setBatchError] = useState<CommandError | null>(null);
  const [batchScope, setBatchScope] = useState<BatchScope | null>(null);
  const operationRef = useRef<symbol | null>(null);

  const clearBatchResult = useCallback(() => {
    setBatchResult(null);
    setBatchError(null);
    setBatchScope(null);
  }, []);

  const run = useCallback(async (
    scope: BatchScope,
    action: () => Promise<BatchResult>,
  ): Promise<BatchResult | null> => {
    if (operationRef.current) return null;
    const operation = Symbol("batch-operation");
    operationRef.current = operation;
    setBatchBusy(true);
    setBatchResult(null);
    setBatchError(null);
    setBatchScope(scope);
    try {
      const result = await action();
      setBatchResult(result);
      return result;
    } catch (error: unknown) {
      setBatchError(normalizeCommandError(error, t("batch.failed")));
      return null;
    } finally {
      if (operationRef.current === operation) {
        operationRef.current = null;
        setBatchBusy(false);
      }
    }
  }, []);

  return {
    batchBusy,
    batchResult,
    batchError,
    batchScope,
    clearBatchResult,
    batchPauseSkills: (skillIds: string[]) =>
      run("installed", () => api.batchPauseSkills(skillIds)),
    batchResumeSkills: (skillIds: string[]) =>
      run("installed", () => api.batchResumeSkills(skillIds)),
    batchBackupSkills: (skillIds: string[]) =>
      run("installed", () => api.batchBackupSkills(skillIds)),
    batchDeleteSkills: (skillIds: string[]) =>
      run("installed", () => api.batchDeleteSkills(skillIds)),
    batchInstallSkills: (skillIds: string[], provider: Provider) =>
      run("library", () => api.batchInstallSkills(skillIds, provider)),
    batchUninstallSkills: (skillIds: string[], provider: Provider) =>
      run("library", () => api.batchUninstallSkills(skillIds, provider)),
    batchSetSkillGroup: (skillIds: string[], groupId: string | null) =>
      run("library", () => api.batchSetSkillGroup(skillIds, groupId)),
    batchApplySkillGroups: (assignments: SkillGroupAssignment[]) =>
      run("library", async () => {
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
      run("library", () => api.batchAddSkillTags(skillIds, tagId)),
    batchRemoveSkillTags: (skillIds: string[], tagId: string) =>
      run("library", () => api.batchRemoveSkillTags(skillIds, tagId)),
    batchSetSkillTags: (skillIds: string[], tagIds: string[]) =>
      run("library", () => api.batchSetSkillTags(skillIds, tagIds)),
    batchMigrateProviderSkills: (skillIds: string[], replaceWithLink: boolean) =>
      run("installed", () => api.batchMigrateProviderSkills(skillIds, replaceWithLink)),
  };
}

export function formatBatchSummary(result: BatchResult): string {
  const firstError = result.items.find((item) => item.status === "failed")?.message;
  const skipped =
    result.skipped > 0 ? t("batch.skipped", { count: result.skipped }) : "";
  return t("batch.summary", {
    success: result.success,
    failed: result.failed,
    skipped,
    error: firstError ? `；${firstError}` : "",
  });
}
