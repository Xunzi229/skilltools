import { useCallback, useEffect, useState } from "react";
import type { SkillApi } from "../api/skillApi";
import type {
  CommandError,
  InstallHealthReport,
  LibrarySkillSummary,
  Provider,
  SkillInstallation,
} from "../model/skill";
import { normalizeCommandError } from "../utils/errors";

interface InstallationsPanelProps {
  api: SkillApi;
  librarySkills: LibrarySkillSummary[];
  onUninstalled: () => void;
  onOpenSettingsHealth: () => void;
}

const providerLabels: Record<Provider, string> = {
  cursor: "Cursor",
  claude: "Claude",
  codex: "Codex",
};

const healthKindLabel: Record<string, string> = {
  missingTarget: "目标缺失",
  notSymlink: "非符号链接",
  brokenLink: "断链",
  sourceMismatch: "源不匹配",
  indexOrphan: "索引孤儿",
  diskOrphan: "磁盘孤儿",
};

export function InstallationsPanel({
  api,
  librarySkills,
  onUninstalled,
  onOpenSettingsHealth,
}: InstallationsPanelProps) {
  const [installations, setInstallations] = useState<SkillInstallation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<CommandError | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [health, setHealth] = useState<InstallHealthReport | null>(null);
  const [healthBusy, setHealthBusy] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setInstallations(await api.listInstallations());
    } catch (err: unknown) {
      setError(normalizeCommandError(err, "加载安装列表失败"));
    } finally {
      setLoading(false);
    }
  }, [api]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const nameOf = (librarySkillId: string) =>
    librarySkills.find((skill) => skill.id === librarySkillId)?.name ?? librarySkillId;

  const uninstall = async (librarySkillId: string, provider: Provider) => {
    const key = `${librarySkillId}:${provider}`;
    setBusyKey(key);
    setError(null);
    try {
      await api.uninstallSkill(librarySkillId, provider);
      await refresh();
      onUninstalled();
    } catch (err: unknown) {
      setError(normalizeCommandError(err, "卸载失败"));
    } finally {
      setBusyKey(null);
    }
  };

  const scanHealth = async () => {
    setHealthBusy(true);
    setError(null);
    try {
      setHealth(await api.scanInstallHealth());
    } catch (err: unknown) {
      setError(normalizeCommandError(err, "健康扫描失败"));
    } finally {
      setHealthBusy(false);
    }
  };

  const repairHealth = async () => {
    setHealthBusy(true);
    setError(null);
    try {
      const report = await api.repairInstallations();
      setHealth(report);
      await refresh();
      onUninstalled();
    } catch (err: unknown) {
      setError(normalizeCommandError(err, "修复失败"));
    } finally {
      setHealthBusy(false);
    }
  };

  const repairable = health?.issues.filter((issue) => issue.repairable).length ?? 0;

  return (
    <section
      className="col-span-2 flex h-full min-h-0 min-w-0 flex-col overflow-hidden bg-panel"
      aria-label="安装总览"
    >
      <header className="shrink-0 border-b border-line-strong px-6 pt-5 pb-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="m-0 text-[28px] font-bold text-ink">安装总览</h2>
            <p className="mt-2 text-[14px] text-ink-2">
              查看库 Skill 在各工具中的受管符号链接安装。
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="rounded-lg border border-line px-3 py-1.5 text-[12px] hover:bg-hover disabled:opacity-55"
              disabled={healthBusy}
              onClick={() => void scanHealth()}
            >
              {healthBusy ? "扫描中…" : "健康检查"}
            </button>
            <button
              type="button"
              className="rounded-lg border border-line px-3 py-1.5 text-[12px] hover:bg-hover disabled:opacity-55"
              disabled={healthBusy || repairable === 0}
              onClick={() => void repairHealth()}
            >
              修复安全项
            </button>
            <button
              type="button"
              className="rounded-lg border border-line px-3 py-1.5 text-[12px] hover:bg-hover"
              onClick={onOpenSettingsHealth}
            >
              打开设置
            </button>
          </div>
        </div>
      </header>
      <div className="min-h-0 flex-1 overflow-auto px-6 py-5">
        {error && (
          <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[12px] text-red-700">
            {error.message}
          </div>
        )}
        {health && (
          <div className="mb-4 rounded-lg border border-line px-3 py-3 text-[12px] text-ink-2">
            <p className="m-0">
              健康问题 {health.issues.length} 项
              {health.repaired > 0 ? `，已修复 ${health.repaired}` : ""}
            </p>
            {health.issues.length > 0 && (
              <ul className="mt-2 max-h-40 list-none overflow-auto p-0">
                {health.issues.map((issue) => (
                  <li
                    key={`${issue.kind}:${issue.targetPath}`}
                    className="border-t border-line py-2 first:border-t-0"
                  >
                    <strong className="text-ink">
                      {healthKindLabel[issue.kind] ?? issue.kind}
                    </strong>
                    <span className="ml-2 text-ink-3">
                      {providerLabels[issue.provider]}
                    </span>
                    <p className="m-0 mt-1 break-all font-mono text-[11px] text-ink-3">
                      {issue.targetPath}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
        {loading ? (
          <p className="text-[13px] text-ink-3">正在加载安装记录…</p>
        ) : installations.length === 0 ? (
          <p className="text-[13px] text-ink-3">暂无安装记录。可在 Skill 库中安装到工具。</p>
        ) : (
          <ul className="m-0 flex list-none flex-col gap-2 p-0">
            {installations.map((item) => {
              const key = `${item.librarySkillId}:${item.provider}`;
              return (
                <li
                  key={key}
                  className="rounded-lg border border-line px-3 py-3"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <strong className="text-[13px] text-ink">
                        {nameOf(item.librarySkillId)}
                      </strong>
                      <span className="ml-2 text-[12px] text-ink-3">
                        {providerLabels[item.provider]}
                      </span>
                    </div>
                    <button
                      type="button"
                      className="rounded border border-red-200 px-2 py-1 text-[12px] text-red-700 hover:bg-red-50 disabled:opacity-55"
                      disabled={busyKey === key}
                      onClick={() => void uninstall(item.librarySkillId, item.provider)}
                    >
                      {busyKey === key ? "卸载中…" : "卸载"}
                    </button>
                  </div>
                  <p className="mt-2 break-all font-mono text-[11px] text-ink-3">
                    {item.targetPath}
                  </p>
                  <p className="mt-1 break-all font-mono text-[11px] text-ink-3">
                    → {item.sourcePath}
                  </p>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </section>
  );
}
