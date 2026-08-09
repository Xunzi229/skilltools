import { useState } from "react";
import type { useInstallations } from "../hooks/useInstallations";
import type { LibrarySkillSummary, Provider } from "../model/skill";

type InstallationsState = ReturnType<typeof useInstallations>;

interface InstallationsPanelProps {
  installations: InstallationsState;
  librarySkills: LibrarySkillSummary[];
  selectedSkillIds?: string[];
  onChanged: () => void;
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
  installations,
  librarySkills,
  selectedSkillIds = [],
  onChanged,
}: InstallationsPanelProps) {
  const {
    overview,
    presets,
    loading,
    error,
    busyKey,
    healthBusy,
    uninstall,
    scanHealth,
    repair,
    migrateUnmanaged,
    savePreset,
    deletePreset,
    applyPreset,
  } = installations;
  const [presetName, setPresetName] = useState("");
  const [presetProviders, setPresetProviders] = useState<Provider[]>(["cursor"]);

  const nameOf = (librarySkillId: string) =>
    librarySkills.find((skill) => skill.id === librarySkillId)?.name ?? librarySkillId;

  const repairableCount =
    overview?.health.issues.filter((issue) => issue.repairable).length ?? 0;

  const toggleProvider = (provider: Provider) => {
    setPresetProviders((current) =>
      current.includes(provider)
        ? current.filter((item) => item !== provider)
        : [...current, provider],
    );
  };

  return (
    <section
      className="col-span-2 flex h-full min-h-0 min-w-0 flex-col overflow-hidden bg-panel"
      aria-label="安装总览"
    >
      <header className="shrink-0 border-b border-line-strong px-6 pt-5 pb-4">
        <h2 className="m-0 text-[28px] font-bold text-ink">安装</h2>
        <p className="mt-2 text-[14px] text-ink-2">
          受管链接、未托管 Skill、同名冲突与健康检查；支持安装预设。
        </p>
      </header>
      <div className="min-h-0 flex-1 overflow-auto px-6 py-5">
        {error && (
          <p className="mb-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[12px] text-red-700">
            {error.message}
          </p>
        )}

        <section className="mb-8">
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <h3 className="m-0 text-[15px] font-semibold text-ink">健康</h3>
            <button
              type="button"
              className="rounded-lg border border-line px-3 py-1.5 text-[12px] hover:bg-hover disabled:opacity-55"
              disabled={healthBusy}
              onClick={() => void scanHealth()}
            >
              {healthBusy ? "扫描中…" : "扫描"}
            </button>
            <button
              type="button"
              className="rounded-lg border border-line px-3 py-1.5 text-[12px] hover:bg-hover disabled:opacity-55"
              disabled={healthBusy || repairableCount === 0}
              onClick={() =>
                void repair().then(() => {
                  onChanged();
                })
              }
            >
              安全修复（{repairableCount}）
            </button>
          </div>
          {overview && (
            <div className="rounded-lg border border-line px-3 py-3 text-[12px] text-ink-2">
              共 {overview.health.issues.length} 项问题
              {overview.health.repaired > 0
                ? `，本次已修复 ${overview.health.repaired}`
                : ""}
              {overview.health.issues.length === 0 ? (
                <p className="mt-2 mb-0 text-ink-3">未发现问题</p>
              ) : (
                <ul className="mt-2 mb-0 list-disc pl-5">
                  {overview.health.issues.map((issue) => (
                    <li key={`${issue.kind}:${issue.targetPath}`}>
                      [{providerLabels[issue.provider]}]{" "}
                      {healthKindLabel[issue.kind] ?? issue.kind}：{issue.message}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </section>

        <section className="mb-8">
          <h3 className="m-0 mb-3 text-[15px] font-semibold text-ink">安装预设</h3>
          <div className="mb-3 flex flex-wrap items-end gap-2">
            <label className="text-[12px] text-ink-3">
              名称
              <input
                className="mt-1 block rounded border border-line px-2 py-1.5 text-[13px]"
                value={presetName}
                onChange={(event) => setPresetName(event.target.value)}
                placeholder="例如：日常三端"
              />
            </label>
            {(["cursor", "claude", "codex"] as Provider[]).map((provider) => (
              <label key={provider} className="text-[12px] text-ink-2">
                <input
                  type="checkbox"
                  className="mr-1"
                  checked={presetProviders.includes(provider)}
                  onChange={() => toggleProvider(provider)}
                />
                {providerLabels[provider]}
              </label>
            ))}
            <button
              type="button"
              className="rounded-lg border border-line px-3 py-1.5 text-[12px] hover:bg-hover disabled:opacity-55"
              disabled={
                !presetName.trim() ||
                selectedSkillIds.length === 0 ||
                presetProviders.length === 0 ||
                busyKey === "preset:save"
              }
              onClick={() =>
                void savePreset(presetName.trim(), selectedSkillIds, presetProviders).then(
                  () => setPresetName(""),
                )
              }
            >
              用库勾选保存
            </button>
          </div>
          {presets.length === 0 ? (
            <p className="text-[12px] text-ink-3">暂无预设。先在库列表勾选 Skill 再保存。</p>
          ) : (
            <ul className="m-0 list-none space-y-2 p-0">
              {presets.map((preset) => (
                <li
                  key={preset.id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-line px-3 py-2"
                >
                  <div className="text-[13px] text-ink">
                    <strong>{preset.name}</strong>
                    <span className="ml-2 text-[12px] text-ink-3">
                      {preset.skillIds.length} 个 Skill ·{" "}
                      {preset.providers.map((p) => providerLabels[p]).join(" / ")}
                    </span>
                  </div>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      className="rounded border border-line px-2 py-1 text-[12px] hover:bg-hover disabled:opacity-55"
                      disabled={busyKey === `preset:apply:${preset.id}`}
                      onClick={() => {
                        if (
                          !window.confirm(
                            `应用预设「${preset.name}」到 ${preset.providers.length} 个 Provider？`,
                          )
                        ) {
                          return;
                        }
                        void applyPreset(preset.id).then(() => onChanged());
                      }}
                    >
                      应用
                    </button>
                    <button
                      type="button"
                      className="rounded border border-line px-2 py-1 text-[12px] text-red-600 hover:bg-hover disabled:opacity-55"
                      disabled={busyKey === `preset:delete:${preset.id}`}
                      onClick={() => void deletePreset(preset.id)}
                    >
                      删除
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        {loading || !overview ? (
          <p className="text-[13px] text-ink-3">加载中…</p>
        ) : (
          <>
            <section className="mb-8">
              <h3 className="m-0 mb-3 text-[15px] font-semibold text-ink">
                受管安装（{overview.managed.length}）
              </h3>
              {overview.managed.length === 0 ? (
                <p className="text-[12px] text-ink-3">暂无受管安装</p>
              ) : (
                <ul className="m-0 list-none space-y-2 p-0">
                  {overview.managed.map((item) => {
                    const key = `${item.librarySkillId}:${item.provider}`;
                    return (
                      <li
                        key={key}
                        className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-line px-3 py-2"
                      >
                        <div className="min-w-0">
                          <div className="text-[13px] font-medium text-ink">
                            {nameOf(item.librarySkillId)} · {providerLabels[item.provider]}
                          </div>
                          <div className="truncate font-mono text-[11px] text-ink-3">
                            {item.targetPath}
                          </div>
                        </div>
                        <button
                          type="button"
                          className="rounded border border-line px-2 py-1 text-[12px] hover:bg-hover disabled:opacity-55"
                          disabled={busyKey === key}
                          onClick={() =>
                            void uninstall(item.librarySkillId, item.provider).then(() =>
                              onChanged(),
                            )
                          }
                        >
                          卸载
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>

            <section className="mb-8">
              <h3 className="m-0 mb-3 text-[15px] font-semibold text-ink">
                未托管（{overview.unmanaged.length}）
              </h3>
              {overview.unmanaged.length === 0 ? (
                <p className="text-[12px] text-ink-3">本机无未托管 Skill</p>
              ) : (
                <ul className="m-0 list-none space-y-2 p-0">
                  {overview.unmanaged.map((item) => (
                    <li
                      key={item.skillId}
                      className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-line px-3 py-2"
                    >
                      <div className="min-w-0">
                        <div className="text-[13px] font-medium text-ink">
                          {item.name} · {providerLabels[item.provider]}
                        </div>
                        <div className="truncate font-mono text-[11px] text-ink-3">
                          {item.path}
                        </div>
                      </div>
                      <div className="flex gap-2">
                        <button
                          type="button"
                          className="rounded border border-line px-2 py-1 text-[12px] hover:bg-hover disabled:opacity-55"
                          disabled={busyKey === `migrate:${item.skillId}`}
                          onClick={() =>
                            void migrateUnmanaged(item.skillId, false).then(() => onChanged())
                          }
                        >
                          迁入库
                        </button>
                        <button
                          type="button"
                          className="rounded border border-line px-2 py-1 text-[12px] hover:bg-hover disabled:opacity-55"
                          disabled={busyKey === `migrate:${item.skillId}`}
                          onClick={() => {
                            if (
                              !window.confirm(
                                "将删除本机真实目录并替换为库链接？冲突真实目录不会被覆盖。",
                              )
                            ) {
                              return;
                            }
                            void migrateUnmanaged(item.skillId, true).then(() => onChanged());
                          }}
                        >
                          替换为库链接
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section>
              <h3 className="m-0 mb-3 text-[15px] font-semibold text-ink">
                同名冲突（{overview.duplicates.length}）
              </h3>
              {overview.duplicates.length === 0 ? (
                <p className="text-[12px] text-ink-3">未发现同名冲突</p>
              ) : (
                <ul className="m-0 list-none space-y-2 p-0">
                  {overview.duplicates.map((group) => (
                    <li
                      key={group.name}
                      className="rounded-lg border border-line px-3 py-2 text-[12px] text-ink-2"
                    >
                      <strong className="text-ink">{group.name}</strong>
                      <div className="mt-1">
                        Provider:{" "}
                        {group.providers.map((p) => providerLabels[p]).join(" / ") || "—"}
                        {" · "}库内 {group.librarySkillIds.length} · 未托管{" "}
                        {group.unmanagedSkillIds.length}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </>
        )}
      </div>
    </section>
  );
}
