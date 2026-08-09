import { useCallback, useEffect, useState } from "react";
import type { SkillApi } from "../api/skillApi";
import type {
  CommandError,
  InstallHealthReport,
  InstallOverview,
  InstallPreset,
  Provider,
} from "../model/skill";
import { normalizeCommandError } from "../utils/errors";

export function useInstallations(api: SkillApi) {
  const [overview, setOverview] = useState<InstallOverview | null>(null);
  const [presets, setPresets] = useState<InstallPreset[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<CommandError | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [healthBusy, setHealthBusy] = useState(false);

  const refresh = useCallback(async (options?: { silent?: boolean }) => {
    if (!options?.silent) {
      setLoading(true);
    }
    setError(null);
    try {
      const [nextOverview, nextPresets] = await Promise.all([
        api.getInstallOverview(),
        api.listInstallPresets(),
      ]);
      setOverview(nextOverview);
      setPresets(nextPresets);
    } catch (err: unknown) {
      setError(normalizeCommandError(err, "加载安装总览失败"));
    } finally {
      if (!options?.silent) {
        setLoading(false);
      }
    }
  }, [api]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const uninstall = async (librarySkillId: string, provider: Provider) => {
    const key = `${librarySkillId}:${provider}`;
    setBusyKey(key);
    setError(null);
    try {
      await api.uninstallSkill(librarySkillId, provider);
      await refresh({ silent: true });
    } catch (err: unknown) {
      setError(normalizeCommandError(err, "卸载失败"));
    } finally {
      setBusyKey(null);
    }
  };

  const scanHealth = async (): Promise<InstallHealthReport | null> => {
    setHealthBusy(true);
    setError(null);
    try {
      const report = await api.scanInstallHealth();
      setOverview((current) =>
        current ? { ...current, health: report } : current,
      );
      return report;
    } catch (err: unknown) {
      setError(normalizeCommandError(err, "健康扫描失败"));
      return null;
    } finally {
      setHealthBusy(false);
    }
  };

  const repair = async (): Promise<InstallHealthReport | null> => {
    setHealthBusy(true);
    setError(null);
    try {
      const report = await api.repairInstallations();
      await refresh({ silent: true });
      return report;
    } catch (err: unknown) {
      setError(normalizeCommandError(err, "修复失败"));
      return null;
    } finally {
      setHealthBusy(false);
    }
  };

  const migrateUnmanaged = async (skillId: string, replaceWithLink: boolean) => {
    setBusyKey(`migrate:${skillId}`);
    setError(null);
    try {
      await api.migrateProviderSkill(skillId, replaceWithLink);
      await refresh({ silent: true });
    } catch (err: unknown) {
      setError(normalizeCommandError(err, "迁入库失败"));
    } finally {
      setBusyKey(null);
    }
  };

  const savePreset = async (
    name: string,
    skillIds: string[],
    providers: Provider[],
    id: string | null = null,
  ) => {
    setBusyKey("preset:save");
    setError(null);
    try {
      await api.saveInstallPreset(id, name, skillIds, providers);
      await refresh({ silent: true });
    } catch (err: unknown) {
      setError(normalizeCommandError(err, "保存预设失败"));
    } finally {
      setBusyKey(null);
    }
  };

  const deletePreset = async (id: string) => {
    setBusyKey(`preset:delete:${id}`);
    setError(null);
    try {
      await api.deleteInstallPreset(id);
      await refresh({ silent: true });
    } catch (err: unknown) {
      setError(normalizeCommandError(err, "删除预设失败"));
    } finally {
      setBusyKey(null);
    }
  };

  const applyPreset = async (id: string) => {
    setBusyKey(`preset:apply:${id}`);
    setError(null);
    try {
      const result = await api.applyInstallPreset(id);
      await refresh({ silent: true });
      return result;
    } catch (err: unknown) {
      setError(normalizeCommandError(err, "应用预设失败"));
      return null;
    } finally {
      setBusyKey(null);
    }
  };

  return {
    overview,
    presets,
    loading,
    error,
    busyKey,
    healthBusy,
    installationCount: overview?.managed.length ?? 0,
    refresh,
    uninstall,
    scanHealth,
    repair,
    migrateUnmanaged,
    savePreset,
    deletePreset,
    applyPreset,
    clearError: () => setError(null),
  };
}
