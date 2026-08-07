import { useCallback, useEffect, useRef, useState } from "react";
import type { SkillApi } from "../api/skillApi";
import type {
  BackupRecord,
  CommandError,
  SkillDetail,
  SkillSummary,
} from "../model/skill";

function normalizeError(error: unknown): CommandError {
  if (typeof error === "object" && error !== null) {
    const candidate = error as Record<string, unknown>;
    if (typeof candidate.code === "string" && typeof candidate.message === "string") {
      return { code: candidate.code, message: candidate.message };
    }
  }

  return { code: "UNKNOWN", message: "操作失败，请重试" };
}

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
  const [detailEpoch, setDetailEpoch] = useState(0);
  const detailRequest = useRef(0);
  const pendingActionRef = useRef<string | null>(null);

  const refresh = useCallback(async () => {
    setListLoading(true);
    setScanError(null);

    try {
      const result = await api.scanSkills();
      const nextSkills = result.skills;
      setSkills(nextSkills);
      setScanWarnings(result.warnings);
      setSelectedSkillId((currentId) => {
        if (currentId && nextSkills.some((skill) => skill.id === currentId)) {
          return currentId;
        }
        return nextSkills[0]?.id ?? null;
      });
      if (nextSkills.length === 0) {
        detailRequest.current += 1;
        setSelectedSkill(null);
        setDetailLoading(false);
        setDetailError(null);
      } else {
        // Force detail reload even when the selected ID stays the same.
        setDetailEpoch((epoch) => epoch + 1);
      }
    } catch (error) {
      setScanError(normalizeError(error));
    } finally {
      setListLoading(false);
    }
  }, [api]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (!selectedSkillId) {
      return;
    }

    const requestId = ++detailRequest.current;
    setDetailLoading(true);
    setDetailError(null);

    void api
      .getSkillDetail(selectedSkillId)
      .then((detail) => {
        if (requestId === detailRequest.current) {
          setSelectedSkill(detail);
        }
      })
      .catch((error: unknown) => {
        if (requestId === detailRequest.current) {
          setSelectedSkill(null);
          setDetailError(normalizeError(error));
        }
      })
      .finally(() => {
        if (requestId === detailRequest.current) {
          setDetailLoading(false);
        }
      });
  }, [api, selectedSkillId, detailEpoch]);

  const selectSkill = useCallback((skillId: string) => {
    setSelectedSkillId(skillId);
  }, []);

  const loadBackups = useCallback(async () => {
    setBackupsLoading(true);
    setBackupsError(null);
    try {
      setBackups(await api.listBackups());
    } catch (error) {
      setBackupsError(normalizeError(error));
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
        setActionError(normalizeError(error));
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
        await refresh();
      }),
    [api, refresh, runAction],
  );

  const resumeSkill = useCallback(
    (skillId: string) =>
      runAction(`resume:${skillId}`, async () => {
        await api.resumeSkill(skillId);
        await refresh();
      }),
    [api, refresh, runAction],
  );

  const createBackup = useCallback(
    (skillId: string) =>
      runAction(`backup:${skillId}`, async () => {
        await api.createBackup(skillId);
        await refresh();
        await loadBackups();
      }),
    [api, loadBackups, refresh, runAction],
  );

  const deleteSkill = useCallback(
    (skillId: string) =>
      runAction(`delete:${skillId}`, async () => {
        await api.deleteSkill(skillId);
        detailRequest.current += 1;
        setSelectedSkillId(null);
        setSelectedSkill(null);
        setDetailLoading(false);
        setDetailError(null);
        const result = await api.scanSkills();
        const nextSkills = result.skills;
        setSkills(nextSkills);
        setScanWarnings(result.warnings);
        setScanError(null);
        await loadBackups();
      }),
    [api, loadBackups, runAction],
  );

  const restoreBackup = useCallback(
    (backupId: string) =>
      runAction(`restore:${backupId}`, async () => {
        const restoredSkill = await api.restoreBackup(backupId);
        const result = await api.scanSkills();
        const nextSkills = result.skills;
        setSkills(nextSkills);
        setScanWarnings(result.warnings);
        setScanError(null);
        await loadBackups();
        if (nextSkills.some((skill) => skill.id === restoredSkill.id)) {
          setSelectedSkillId(restoredSkill.id);
          setDetailEpoch((epoch) => epoch + 1);
        }
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
    clearActionError,
  };
}
