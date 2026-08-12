import { useCallback, useEffect, useRef, useState } from "react";
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
  const operationRef = useRef<symbol | null>(null);
  const refreshRequestRef = useRef(0);

  const refresh = useCallback(async (options?: { silent?: boolean }) => {
    const requestId = ++refreshRequestRef.current;
    if (!options?.silent) {
      setLoading(true);
    }
    if (requestId === refreshRequestRef.current) setError(null);
    try {
      const [nextOverview, nextPresets] = await Promise.all([
        api.getInstallOverview(),
        api.listInstallPresets(),
      ]);
      if (requestId === refreshRequestRef.current) {
        setOverview(nextOverview);
        setPresets(nextPresets);
      }
    } catch (err: unknown) {
      if (requestId === refreshRequestRef.current) {
        setError(normalizeCommandError(err, "加载安装总览失败"));
      }
    } finally {
      if (requestId === refreshRequestRef.current) {
        setLoading(false);
      }
    }
  }, [api]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const runOperation = async <T,>(
    key: string,
    action: () => Promise<T>,
    fallback: string,
    health = false,
  ): Promise<T | null> => {
    if (operationRef.current) return null;
    const operation = Symbol(key);
    operationRef.current = operation;
    if (health) setHealthBusy(true);
    else setBusyKey(key);
    setError(null);
    try {
      return await action();
    } catch (err: unknown) {
      setError(normalizeCommandError(err, fallback));
      return null;
    } finally {
      if (operationRef.current === operation) {
        operationRef.current = null;
        if (health) setHealthBusy(false);
        else setBusyKey(null);
      }
    }
  };

  const uninstall = (librarySkillId: string, provider: Provider) =>
    runOperation(`${librarySkillId}:${provider}`, async () => {
      await api.uninstallSkill(librarySkillId, provider);
      await refresh({ silent: true });
      return true;
    }, "卸载失败");

  const scanHealth = async (): Promise<InstallHealthReport | null> => {
    return runOperation("health:scan", async () => {
      const report = await api.scanInstallHealth();
      setOverview((current) =>
        current ? { ...current, health: report } : current,
      );
      return report;
    }, "健康扫描失败", true);
  };

  const repair = async (): Promise<InstallHealthReport | null> => {
    return runOperation("health:repair", async () => {
      const report = await api.repairInstallations();
      await refresh({ silent: true });
      return report;
    }, "修复失败", true);
  };

  const migrateUnmanaged = (skillId: string, replaceWithLink: boolean) =>
    runOperation(`migrate:${skillId}`, async () => {
      await api.migrateProviderSkill(skillId, replaceWithLink);
      await refresh({ silent: true });
      return true;
    }, "迁入库失败");

  const savePreset = async (
    name: string,
    skillIds: string[],
    providers: Provider[],
    id: string | null = null,
  ) =>
    runOperation("preset:save", async () => {
      await api.saveInstallPreset(id, name, skillIds, providers);
      await refresh({ silent: true });
      return true;
    }, "保存预设失败");

  const deletePreset = (id: string) =>
    runOperation(`preset:delete:${id}`, async () => {
      await api.deleteInstallPreset(id);
      await refresh({ silent: true });
      return true;
    }, "删除预设失败");

  const applyPreset = (id: string) =>
    runOperation(`preset:apply:${id}`, async () => {
      const result = await api.applyInstallPreset(id);
      await refresh({ silent: true });
      return result;
    }, "应用预设失败");

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
