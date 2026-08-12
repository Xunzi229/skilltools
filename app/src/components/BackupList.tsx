import { useCallback, useEffect, useMemo, useState } from "react";
import type { BackupRecord, CommandError } from "../model/skill";
import {
  rowCheckboxClass,
  useSelectionMode,
} from "../hooks/useSelectionMode";
import { ConfirmDialog } from "./ConfirmDialog";
import { SelectionModeButton } from "./SelectionModeButton";
import { SkillCard } from "./SkillCard";
import { getLocale, useI18n } from "../i18n";

interface BackupListProps {
  backups: BackupRecord[];
  loading: boolean;
  error: CommandError | null;
  actionError: CommandError | null;
  pendingAction: string | null;
  onRetry: () => void;
  onRestore: (backupId: string) => Promise<void>;
  onDelete: (backupId: string) => Promise<void>;
  onClearActionError: () => void;
}

const providerNames = {
  cursor: "Cursor",
  claude: "Claude",
  codex: "Codex",
};

function reasonLabel(t: (k: string) => string, reason: string) {
  if (reason === "manual") return t("backups.reasonManual");
  if (reason === "beforeDelete") return t("backups.reasonBeforeDelete");
  return reason;
}

function formatTime(createdAt: string) {
  const locale = getLocale() === "en" ? "en-US" : "zh-CN";
  return new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(createdAt));
}

export function BackupList({
  backups,
  loading,
  error,
  actionError,
  pendingAction,
  onRetry,
  onRestore,
  onDelete,
  onClearActionError,
}: BackupListProps) {
  const { t } = useI18n();
  const orderedBackups = useMemo(
    () =>
      [...backups].sort(
        (left, right) =>
          new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime(),
      ),
    [backups],
  );
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [restoreOpen, setRestoreOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [batchDeleteOpen, setBatchDeleteOpen] = useState(false);
  const [batchDeleting, setBatchDeleting] = useState(false);
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const clearChecked = useCallback(() => setChecked(new Set()), []);
  const { selectionActive, toggleSelectionMode } = useSelectionMode(
    checked.size,
    clearChecked,
  );

  useEffect(() => {
    setSelectedId((current) =>
      current && orderedBackups.some((backup) => backup.id === current)
        ? current
        : orderedBackups[0]?.id ?? null,
    );
    setChecked((current) => {
      const next = new Set(
        [...current].filter((id) => orderedBackups.some((backup) => backup.id === id)),
      );
      return next;
    });
  }, [orderedBackups]);

  const selected =
    orderedBackups.find((backup) => backup.id === selectedId) ?? null;
  const restoreBusy =
    selected !== null && pendingAction === `restore:${selected.id}`;
  const deleteBusy =
    selected !== null && pendingAction === `delete-backup:${selected.id}`;

  return (
    <>
      <section
        className="flex h-full min-h-0 w-full min-w-0 flex-col overflow-hidden border-r border-line-strong bg-panel"
        aria-label={t("backups.region")}
      >
        <header className="shrink-0 border-b border-line-strong px-4 pt-5 pb-3">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <h2 className="m-0 text-[17px] font-semibold tracking-tight text-ink">{t("backups.title")}</h2>
              <p className="mt-1 text-[12px] text-ink-2">{t("backups.count", { count: orderedBackups.length })}</p>
            </div>
            <SelectionModeButton
              selectionActive={selectionActive}
              disabled={pendingAction !== null || batchDeleting}
              onToggle={toggleSelectionMode}
            />
          </div>
          {checked.size > 0 && (
            <button
              type="button"
              className="macos-btn-danger-soft macos-btn-sm mt-2"
              disabled={pendingAction !== null || batchDeleting}
              onClick={() => setBatchDeleteOpen(true)}
            >
              {t("backups.deleteSelected", { count: checked.size })}
            </button>
          )}
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-2 py-2">
          {loading ? (
            <div className="px-3 py-8 text-center text-[13px] text-ink-3">{t("backups.loading")}</div>
          ) : error ? (
            <div className="px-3 py-8 text-center text-[13px]" role="alert">
              <strong className="macos-alert-error block">{t("backups.loadFailed")}</strong>
              <span className="text-ink-3">{error.message}</span>
              <button
                type="button"
                className="macos-btn-primary mt-3"
                onClick={onRetry}
              >
                {t("backups.retry")}
              </button>
            </div>
          ) : orderedBackups.length === 0 ? (
            <div className="px-3 py-8 text-center text-[13px] text-ink-3">
              <strong className="block text-ink">{t("backups.emptyTitle")}</strong>
              <span>{t("backups.emptyHint")}</span>
            </div>
          ) : (
            <ul className="m-0 flex list-none flex-col gap-0.5 p-0">
              {orderedBackups.map((backup) => (
                <li key={backup.id} className="group flex items-center gap-1.5">
                  <input
                    type="checkbox"
                    className={rowCheckboxClass(selectionActive)}
                    checked={checked.has(backup.id)}
                    tabIndex={selectionActive ? 0 : -1}
                    aria-label={t("backups.selectAria", { name: backup.skillName })}
                    onChange={(event) => {
                      setChecked((current) => {
                        const next = new Set(current);
                        if (event.target.checked) next.add(backup.id);
                        else next.delete(backup.id);
                        return next;
                      });
                    }}
                  />
                  <div className="min-w-0 flex-1">
                    <SkillCard
                      name={backup.skillName}
                      description={t("backups.reasonLine", { reason: reasonLabel(t, backup.reason), time: formatTime(backup.createdAt) })}
                      statusLabel={providerNames[backup.provider]}
                      selected={backup.id === selected?.id}
                      onSelect={() => {
                        setSelectedId(backup.id);
                        onClearActionError();
                      }}
                    />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      <section className="flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-panel">
        {!selected ? (
          <div className="flex flex-1 items-center justify-center text-[13px] text-ink-3">
            <strong className="text-ink">{t("backups.pickOne")}</strong>
          </div>
        ) : (
          <>
            <header className="shrink-0 border-b border-line-strong px-6 pt-5 pb-4">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <span className="text-[12px] text-ink-3">
                    {providerNames[selected.provider]}
                  </span>
                  <h2 className="macos-page-title mt-1">
                    {selected.skillName}
                  </h2>
                  <p className="mt-2 text-[14px] text-ink-2">
                    {t("backups.createdAt", { time: formatTime(selected.createdAt) })}
                  </p>
                </div>
                <div className="flex gap-2">
                  <button
                    type="button"
                    className="macos-btn-danger-soft"
                    disabled={pendingAction !== null}
                    onClick={() => setDeleteOpen(true)}
                  >
                    {deleteBusy ? t("backups.deleting") : t("backups.deleteBackup")}
                  </button>
                  <button
                    type="button"
                    className="macos-btn-primary"
                    disabled={pendingAction !== null}
                    onClick={() => setRestoreOpen(true)}
                  >
                    {restoreBusy ? t("backups.restoring") : t("backups.restore")}
                  </button>
                </div>
              </div>
            </header>
            <div className="min-h-0 flex-1 overflow-auto px-6 py-4">
              {actionError && (
                <div
                  className="macos-alert-error mb-4 flex items-center justify-between gap-3"
                  role="alert"
                >
                  <span>{actionError.message}</span>
                  <button
                    type="button"
                    className="macos-btn-ghost macos-btn-sm"
                    onClick={onClearActionError}
                  >
                    {t("common.close")}
                  </button>
                </div>
              )}
              <dl className="m-0 grid gap-3 text-[13px]">
                <div>
                  <dt className="text-ink-3">{t("backups.reason")}</dt>
                  <dd className="m-0 mt-0.5 text-ink">{reasonLabel(t, selected.reason)}</dd>
                </div>
                <div>
                  <dt className="text-ink-3">{t("backups.source")}</dt>
                  <dd className="m-0 mt-0.5 text-ink">
                    {providerNames[selected.provider]}
                  </dd>
                </div>
                <div>
                  <dt className="text-ink-3">{t("backups.originalPath")}</dt>
                  <dd className="m-0 mt-0.5 font-mono text-[12px] text-ink">
                    {selected.originalPath}
                  </dd>
                </div>
                <div>
                  <dt className="text-ink-3">{t("backups.archivePath")}</dt>
                  <dd className="m-0 mt-0.5 font-mono text-[12px] text-ink">
                    {selected.archivePath}
                  </dd>
                </div>
                <div>
                  <dt className="text-ink-3">{t("backups.checksum")}</dt>
                  <dd className="m-0 mt-0.5 font-mono text-[12px] text-ink">
                    {selected.checksum}
                  </dd>
                </div>
              </dl>
            </div>
          </>
        )}
      </section>

      <ConfirmDialog
        open={restoreOpen && selected !== null}
        title={t("backups.restoreTitle", { name: selected?.skillName ?? "" })}
        message={t("backups.restoreMessage")}
        confirmLabel={t("backups.restoreConfirm")}
        busy={restoreBusy}
        onCancel={() => setRestoreOpen(false)}
        onConfirm={() => {
          if (selected) {
            void onRestore(selected.id).then(() => setRestoreOpen(false));
          }
        }}
      />
      <ConfirmDialog
        open={deleteOpen && selected !== null}
        title={t("backups.deleteTitle", { name: selected?.skillName ?? "" })}
        message={t("backups.deleteMessage")}
        confirmLabel={t("backups.deleteConfirm")}
        tone="danger"
        busy={deleteBusy}
        onCancel={() => setDeleteOpen(false)}
        onConfirm={() => {
          if (selected) {
            void onDelete(selected.id).then(() => setDeleteOpen(false));
          }
        }}
      />
      <ConfirmDialog
        open={batchDeleteOpen && checked.size > 0}
        title={t("backups.deleteSelectedTitle", { count: checked.size })}
        message={t("backups.deleteMessage")}
        confirmLabel={t("backups.deleteConfirm")}
        tone="danger"
        busy={batchDeleting || pendingAction !== null}
        onCancel={() => {
          if (!batchDeleting) setBatchDeleteOpen(false);
        }}
        onConfirm={() => {
          const ids = [...checked];
          setBatchDeleting(true);
          void (async () => {
            try {
              for (const id of ids) {
                await onDelete(id);
              }
              setChecked(new Set());
              setBatchDeleteOpen(false);
            } finally {
              setBatchDeleting(false);
            }
          })();
        }}
      />
    </>
  );
}
