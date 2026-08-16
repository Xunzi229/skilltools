import { useState } from "react";
import type { useInstallations } from "../hooks/useInstallations";
import type { LibrarySkillSummary, Provider } from "../model/skill";
import { issueIsRebuildable } from "../model/skill";
import { ConfirmDialog } from "./ConfirmDialog";
import { useI18n } from "../i18n";

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

function healthKindLabel(t: (k: string) => string, kind: string): string {
  const map: Record<string, string> = {
    missingTarget: t("installations.issueMissingTarget"),
    notSymlink: t("installations.issueNotSymlink"),
    brokenLink: t("installations.issueBrokenLink"),
    sourceMismatch: t("installations.issueSourceMismatch"),
    indexOrphan: t("installations.issueIndexOrphan"),
    diskOrphan: t("installations.issueDiskOrphan"),
  };
  return map[kind] ?? kind;
}

export function InstallationsPanel({
  installations,
  librarySkills,
  selectedSkillIds = [],
  onChanged,
}: InstallationsPanelProps) {
  const { t } = useI18n();
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
    rebuild,
    migrateUnmanaged,
    savePreset,
    deletePreset,
    applyPreset,
  } = installations;
  const [presetName, setPresetName] = useState("");
  const [presetProviders, setPresetProviders] = useState<Provider[]>(["cursor"]);
  const [confirm, setConfirm] = useState<
    | { kind: "apply"; id: string; name: string; providerCount: number }
    | { kind: "replace"; skillId: string }
    | null
  >(null);

  const nameOf = (librarySkillId: string) =>
    librarySkills.find((skill) => skill.id === librarySkillId)?.name ?? librarySkillId;

  const repairableCount =
    overview?.health.issues.filter((issue) => issue.repairable).length ?? 0;
  const rebuildableCount =
    overview?.health.issues.filter(issueIsRebuildable).length ?? 0;
  const anyBusy = busyKey !== null || healthBusy;

  const toggleProvider = (provider: Provider) => {
    setPresetProviders((current) =>
      current.includes(provider)
        ? current.filter((item) => item !== provider)
        : [...current, provider],
    );
  };

  return (
    <>
    <section
      className="col-span-2 flex h-full min-h-0 min-w-0 flex-col overflow-hidden bg-panel"
      aria-label={t("installations.region")}
    >
      <header className="shrink-0 border-b border-line-strong px-6 pt-5 pb-4">
        <h2 className="macos-page-title">{t("installations.title")}</h2>
        <p className="macos-page-sub">{t("installations.subtitle")}</p>
      </header>
      <div className="min-h-0 flex-1 overflow-auto px-6 py-5">
        {error && (
          <p className="macos-alert-error mb-4">{error.message}</p>
        )}

        <section className="mb-8">
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <h3 className="m-0 text-[15px] font-semibold text-ink">{t("installations.health")}</h3>
            <button
              type="button"
              className="macos-btn-ghost"
              disabled={anyBusy}
              onClick={() => void scanHealth()}
            >
              {healthBusy ? t("installations.scanning") : t("installations.scan")}
            </button>
            <button
              type="button"
              className="macos-btn-primary"
              disabled={anyBusy || rebuildableCount === 0}
              onClick={() =>
                void rebuild().then((result) => {
                  if (result) onChanged();
                })
              }
            >
              {t("installations.rebuildLinks", { count: rebuildableCount })}
            </button>
            <button
              type="button"
              className="macos-btn-ghost"
              disabled={anyBusy || repairableCount === 0}
              onClick={() =>
                void repair().then((result) => {
                  if (result) onChanged();
                })
              }
            >
              {t("installations.safeRepair", { count: repairableCount })}
            </button>
          </div>
          <p className="mb-3 text-[11px] text-ink-3">
            {t("installations.healthHint")}
          </p>
          {overview && (
            <div className="macos-card px-3 py-3 text-[12px] text-ink-2">
              {t("installations.issueCount", { count: overview.health.issues.length })}
              {overview.health.repaired > 0
                ? t("installations.repairedSuffix", { count: overview.health.repaired })
                : ""}
              {overview.health.issues.length === 0 ? (
                <p className="mt-2 mb-0 text-ink-3">{t("installations.noIssues")}</p>
              ) : (
                <ul className="mt-2 mb-0 list-disc pl-5">
                  {overview.health.issues.map((issue) => (
                    <li key={`${issue.kind}:${issue.targetPath}`}>
                      [{providerLabels[issue.provider]}]{" "}
                      {healthKindLabel(t, issue.kind)}：{issue.message}
                      {issue.kind === "notSymlink"
                        ? ` ${t("installations.notSymlinkHint")}`
                        : ""}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </section>

        <section className="mb-8">
          <h3 className="m-0 mb-3 text-[15px] font-semibold text-ink">{t("installations.presets")}</h3>
          <div className="mb-3 flex flex-wrap items-end gap-2">
            <label className="text-[12px] text-ink-3">
              {t("installations.name")}
              <input
                className="macos-input mt-1 block w-full"
                value={presetName}
                onChange={(event) => setPresetName(event.target.value)}
                placeholder={t("installations.namePlaceholder")}
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
              className="macos-btn-primary"
              disabled={
                !presetName.trim() ||
                selectedSkillIds.length === 0 ||
                presetProviders.length === 0 ||
                anyBusy
              }
              title={
                selectedSkillIds.length === 0
                  ? t("installations.saveNeedSelection")
                  : t("installations.saveWillSave", { count: selectedSkillIds.length })
              }
              onClick={() =>
                void savePreset(presetName.trim(), selectedSkillIds, presetProviders).then(
                  (result) => {
                    if (result) setPresetName("");
                  },
                )
              }
            >
              {t("installations.saveFromLibrary")}
            </button>
            <span className="text-[12px] text-ink-3">
              {selectedSkillIds.length > 0
                ? t("installations.selectedCount", { count: selectedSkillIds.length })
                : t("installations.noneSelected")}
            </span>
          </div>
          {presets.length === 0 ? (
            <p className="text-[12px] text-ink-3">{t("installations.noPresets")}</p>
          ) : (
            <ul className="m-0 list-none space-y-2 p-0">
              {presets.map((preset) => (
                <li
                  key={preset.id}
                  className="macos-row flex flex-wrap items-center justify-between gap-2"
                >
                  <div className="text-[13px] text-ink">
                    <strong>{preset.name}</strong>
                    <span className="ml-2 text-[12px] text-ink-3">
                      {t("installations.presetSkillCount", { count: preset.skillIds.length })}
                      {preset.providers.map((p) => providerLabels[p]).join(" / ")}
                    </span>
                  </div>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      className="macos-btn-ghost macos-btn-sm"
                      disabled={anyBusy}
                      onClick={() =>
                        setConfirm({
                          kind: "apply",
                          id: preset.id,
                          name: preset.name,
                          providerCount: preset.providers.length,
                        })
                      }
                    >
                      {t("installations.apply")}
                    </button>
                    <button
                      type="button"
                      className="macos-btn-danger-soft macos-btn-sm"
                      disabled={anyBusy}
                      onClick={() => void deletePreset(preset.id)}
                    >
                      {t("installations.delete")}
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        {loading || !overview ? (
          <p className="text-[13px] text-ink-3">{t("installations.loading")}</p>
        ) : (
          <>
            <section className="mb-8">
              <h3 className="m-0 mb-3 text-[15px] font-semibold text-ink">
                {t("installations.managed", { count: overview.managed.length })}
              </h3>
              {overview.managed.length === 0 ? (
                <p className="text-[12px] text-ink-3">{t("installations.noManaged")}</p>
              ) : (
                <ul className="m-0 list-none space-y-2 p-0">
                  {overview.managed.map((item) => {
                    const key = `${item.librarySkillId}:${item.provider}`;
                    return (
                      <li
                        key={key}
                        className="macos-row flex flex-wrap items-center justify-between gap-2"
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
                          className="macos-btn-ghost macos-btn-sm"
                          disabled={anyBusy}
                          onClick={() =>
                            void uninstall(item.librarySkillId, item.provider).then((result) => {
                              if (result) onChanged();
                            })
                          }
                        >
                          {t("installations.uninstall")}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>

            <section className="mb-8">
              <h3 className="m-0 mb-3 text-[15px] font-semibold text-ink">
                {t("installations.unmanaged", { count: overview.unmanaged.length })}
              </h3>
              {overview.unmanaged.length === 0 ? (
                <p className="text-[12px] text-ink-3">{t("installations.noUnmanaged")}</p>
              ) : (
                <ul className="m-0 list-none space-y-2 p-0">
                  {overview.unmanaged.map((item) => (
                    <li
                      key={item.skillId}
                      className="macos-row flex flex-wrap items-center justify-between gap-2"
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
                          className="macos-btn-ghost macos-btn-sm"
                          disabled={anyBusy}
                          onClick={() =>
                            void migrateUnmanaged(item.skillId, false).then((result) => {
                              if (result) onChanged();
                            })
                          }
                        >
                          {t("installations.migrate")}
                        </button>
                        <button
                          type="button"
                          className="macos-btn-ghost macos-btn-sm"
                          disabled={anyBusy}
                          onClick={() =>
                            setConfirm({ kind: "replace", skillId: item.skillId })
                          }
                        >
                          {t("installations.replaceLink")}
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section>
              <h3 className="m-0 mb-3 text-[15px] font-semibold text-ink">
                {t("installations.duplicates", { count: overview.duplicates.length })}
              </h3>
              {overview.duplicates.length === 0 ? (
                <p className="text-[12px] text-ink-3">{t("installations.noDuplicates")}</p>
              ) : (
                <ul className="m-0 list-none space-y-2 p-0">
                  {overview.duplicates.map((group) => (
                    <li
                      key={group.name}
                      className="macos-row text-[12px] text-ink-2"
                    >
                      <strong className="text-ink">{group.name}</strong>
                      <div className="mt-1">
                        Provider:{" "}
                        {group.providers.map((p) => providerLabels[p]).join(" / ") || "—"}
                        {t("installations.duplicateStats", {
                          library: group.librarySkillIds.length,
                          unmanaged: group.unmanagedSkillIds.length,
                        })}
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
    <ConfirmDialog
      open={confirm?.kind === "apply"}
      title={confirm?.kind === "apply" ? t("installations.applyPresetTitle", { name: confirm.name }) : ""}
      message={
        confirm?.kind === "apply"
          ? t("installations.applyPresetMessage", { count: confirm.providerCount })
          : ""
      }
      confirmLabel={t("installations.apply")}
      busy={anyBusy}
      onCancel={() => setConfirm(null)}
      onConfirm={() => {
        if (confirm?.kind !== "apply") return;
        const id = confirm.id;
        void applyPreset(id).then((result) => {
          if (!result) return;
          setConfirm(null);
          onChanged();
        });
      }}
    />
    <ConfirmDialog
      open={confirm?.kind === "replace"}
      title={t("installations.replaceTitle")}
      message={t("installations.replaceMessage")}
      confirmLabel={t("installations.replaceConfirm")}
      tone="danger"
      busy={anyBusy}
      onCancel={() => setConfirm(null)}
      onConfirm={() => {
        if (confirm?.kind !== "replace") return;
        const skillId = confirm.skillId;
        void migrateUnmanaged(skillId, true).then((result) => {
          if (!result) return;
          setConfirm(null);
          onChanged();
        });
      }}
    />
    </>
  );
}
