import { useCallback, useEffect, useRef, useState } from "react";
import type { SkillApi } from "../api/skillApi";
import type {
  BackupRecord,
  CommandError,
  SkillDetail,
  SkillSummary,
} from "../model/skill";
import { skillMemberIds } from "../model/skill";
import { normalizeCommandError } from "../utils/errors";

export function useSkills(api: SkillApi) {
  const [skills, setSkills] = useState<SkillSummary[]>([]);
  const [selectedSkillId, setSelectedSkillId] = useState<string | null>(null);
  const [selectedSkill, setSelectedSkill] = useState<SkillDetail | null>(null);
  const [listLoading, setListLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [scanError, setScanError] = useState<CommandError | null>(null);
  const [scanWarnings, setScanWarnings] = useState<string[]>([]);
  const [detailError, setDetailError] = useState<CommandError | null>(null);
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const [actionError, setActionError] = useState<CommandError | null>(null);
  const [backups, setBackups] = useState<BackupRecord[]>([]);
  const [backupsLoading, setBackupsLoading] = useState(false);
  const [backupsError, setBackupsError] = useState<CommandError | null>(null);
  const detailRequest = useRef(0);
  const pendingActionRef = useRef<string | null>(null);
  const selectedSkillIdRef = useRef<string | null>(null);
  selectedSkillIdRef.current = selectedSkillId;

  const loadDetail = useCallback(
    async (skillId: string, options?: { silent?: boolean }) => {
      const requestId = ++detailRequest.current;
      if (!options?.silent) {
        setDetailLoading(true);
      }
      setDetailError(null);
      try {
        const detail = await api.getSkillDetail(skillId);
        if (requestId === detailRequest.current) {
          setSelectedSkill(detail);
        }
      } catch (error: unknown) {
        if (requestId === detailRequest.current) {
          setSelectedSkill(null);
          setDetailError(normalizeCommandError(error));
        }
      } finally {
        if (requestId === detailRequest.current && !options?.silent) {
          setDetailLoading(false);
        }
      }
    },
    [api],
  );

  const refresh = useCallback(
    async (options?: {
      silent?: boolean;
      clearSelection?: boolean;
    }): Promise<SkillSummary[]> => {
      if (!options?.silent) {
        setListLoading(true);
      }
      setScanError(null);

      try {
        const result = await api.scanSkills();
        const nextSkills = result.skills;
        setSkills(nextSkills);
        setScanWarnings(result.warnings);
        const currentId = options?.clearSelection
          ? null
          : selectedSkillIdRef.current;
        const nextSelectedId =
          currentId &&
          nextSkills.some((skill) => skillMemberIds(skill).includes(currentId))
            ? currentId
            : options?.clearSelection
              ? null
              : nextSkills[0]?.id ?? null;
        setSelectedSkillId(nextSelectedId);
        if (!nextSelectedId) {
          detailRequest.current += 1;
          setSelectedSkill(null);
          setDetailLoading(false);
          setDetailError(null);
        } else if (nextSelectedId === currentId) {
          // 选中项未变时 useEffect 不会重跑，需在此同步详情
          await loadDetail(nextSelectedId, { silent: options?.silent });
        }
        return nextSkills;
      } catch (error) {
        setScanError(normalizeCommandError(error));
        return [];
      } finally {
        if (!options?.silent) {
          setListLoading(false);
        }
      }
    },
    [api, loadDetail],
  );

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (!selectedSkillId) {
      return;
    }
    void loadDetail(selectedSkillId);
  }, [loadDetail, selectedSkillId]);

  const selectSkill = useCallback((skillId: string) => {
    setSelectedSkillId(skillId);
  }, []);

  const loadBackups = useCallback(async () => {
    setBackupsLoading(true);
    setBackupsError(null);
    try {
      setBackups(await api.listBackups());
    } catch (error) {
      setBackupsError(normalizeCommandError(error));
    } finally {
      setBackupsLoading(false);
    }
  }, [api]);

  const runAction = useCallback(
    async (key: string, action: () => Promise<void>) => {
      if (pendingActionRef.current) {
        return;
      }
      pendingActionRef.current = key;
      setPendingAction(key);
      setActionError(null);
      try {
        await action();
      } catch (error) {
        setActionError(normalizeCommandError(error));
      } finally {
        pendingActionRef.current = null;
        setPendingAction(null);
      }
    },
    [],
  );

  const pauseSkill = useCallback(
    (skillId: string) =>
      runAction(`pause:${skillId}`, async () => {
        await api.pauseSkill(skillId);
        await refresh({ silent: true });
      }),
    [api, refresh, runAction],
  );

  const resumeSkill = useCallback(
    (skillId: string) =>
      runAction(`resume:${skillId}`, async () => {
        await api.resumeSkill(skillId);
        await refresh({ silent: true });
      }),
    [api, refresh, runAction],
  );

  const createBackup = useCallback(
    (skillId: string) =>
      runAction(`backup:${skillId}`, async () => {
        await api.createBackup(skillId);
        await refresh({ silent: true });
        await loadBackups();
      }),
    [api, loadBackups, refresh, runAction],
  );

  const deleteSkill = useCallback(
    (skillId: string) =>
      runAction(`delete:${skillId}`, async () => {
        await api.deleteSkill(skillId);
        // 删除后保持未选中，避免 refresh 自动选中第一项
        await refresh({ silent: true, clearSelection: true });
        await loadBackups();
      }),
    [api, loadBackups, refresh, runAction],
  );

  const restoreBackup = useCallback(
    (backupId: string) =>
      runAction(`restore:${backupId}`, async () => {
        const restoredSkill = await api.restoreBackup(backupId);
        const nextSkills = await refresh({ silent: true });
        await loadBackups();
        if (nextSkills.some((skill) => skill.id === restoredSkill.id)) {
          setSelectedSkillId(restoredSkill.id);
        }
      }),
    [api, loadBackups, refresh, runAction],
  );

  const deleteBackup = useCallback(
    (backupId: string) =>
      runAction(`delete-backup:${backupId}`, async () => {
        await api.deleteBackup(backupId);
        await loadBackups();
      }),
    [api, loadBackups, runAction],
  );

  const clearActionError = useCallback(() => {
    setActionError(null);
  }, []);

  return {
    skills,
    selectedSkillId,
    selectedSkill,
    listLoading,
    detailLoading,
    scanError,
    scanWarnings,
    detailError,
    pendingAction,
    actionError,
    backups,
    backupsLoading,
    backupsError,
    refresh,
    selectSkill,
    pauseSkill,
    resumeSkill,
    createBackup,
    deleteSkill,
    loadBackups,
    restoreBackup,
    deleteBackup,
    clearActionError,
  };
}
