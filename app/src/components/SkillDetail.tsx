import { useState } from "react";
import type { SkillApi } from "../api/skillApi";
import { useSkillFiles } from "../hooks/useSkillFiles";
import type { CommandError, SkillDetail as SkillDetailModel } from "../model/skill";
import { errorMessage } from "../utils/errors";
import { displayDescription } from "../utils/skillDisplay";
import { ConfirmDialog } from "./ConfirmDialog";
import { FileTree } from "./FileTree";
import { MarkdownViewer } from "./MarkdownViewer";
import { SkillMetaForm } from "./SkillMetaForm";
import { TranslatePreviewButton } from "./TranslatePreviewButton";
import { useI18n } from "../i18n";

interface SkillDetailProps {
  api: SkillApi;
  skill: SkillDetailModel | null;
  loading: boolean;
  error: CommandError | null;
  actionError: CommandError | null;
  pendingAction: string | null;
  onPause: (skillId: string) => Promise<void>;
  onResume: (skillId: string) => Promise<void>;
  onBackup: (skillId: string) => Promise<void>;
  onDelete: (skillId: string) => Promise<void>;
  onMigrated: () => void;
  onClearActionError: () => void;
  onMetadataSaved?: () => void;
}

const providerNames = {
  cursor: "Cursor",
  claude: "Claude",
  codex: "Codex",
};

async function copyText(value: string) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value);
    return;
  }
  const input = document.createElement("textarea");
  input.value = value;
  document.body.appendChild(input);
  input.select();
  document.execCommand("copy");
  document.body.removeChild(input);
}

export function SkillDetail({
  api,
  skill,
  loading,
  error,
  actionError,
  pendingAction,
  onPause,
  onResume,
  onBackup,
  onDelete,
  onMigrated,
  onClearActionError,
  onMetadataSaved,
}: SkillDetailProps) {
  const { t } = useI18n();
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [migrateOpen, setMigrateOpen] = useState(false);
  const [replaceWithLink, setReplaceWithLink] = useState(true);
  const [migrateBusy, setMigrateBusy] = useState(false);
  const [migrateError, setMigrateError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const files = useSkillFiles({
    api,
    source: skill ? { kind: "provider", skillId: skill.id } : null,
    reloadToken: skill?.skillMarkdown,
  });

  if (loading) {
    return (
      <section className="flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-panel">
        <div className="flex flex-1 items-center justify-center text-[13px] text-ink-3">
          {t("skillDetail.loading")}
        </div>
      </section>
    );
  }

  if (error) {
    return (
      <section className="flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-panel">
        <div className="flex flex-1 flex-col items-center justify-center gap-1 text-[13px]" role="alert">
          <strong className="macos-alert-error block">{t("skillDetail.loadFailed")}</strong>
          <span className="text-ink-3">{error.message}</span>
        </div>
      </section>
    );
  }

  if (!skill) {
    return (
      <section className="flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-panel">
        <div className="flex flex-1 flex-col items-center justify-center gap-1 text-[13px] text-ink-3">
          <strong className="text-ink">{t("skillDetail.pickTitle")}</strong>
          <span>{t("skillDetail.pickHint")}</span>
        </div>
      </section>
    );
  }

  const busy = pendingAction !== null || files.saving || migrateBusy;
  const deleteBusy = pendingAction === `delete:${skill.id}`;
  const fileError = files.treeError ?? files.previewError ?? files.openError;

  return (
    <section className="flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-panel">
      <header className="shrink-0 border-b border-line-strong px-6 pt-5 pb-4">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="mb-2 flex flex-wrap items-center gap-2 text-[12px]">
              {(skill.providers && skill.providers.length > 0
                ? skill.providers
                : [skill.provider]
              ).map((provider) => (
                <span
                  key={provider}
                  className="rounded-full bg-hover px-2 py-0.5 text-ink-2"
                >
                  {providerNames[provider]}
                </span>
              ))}
              <span className="text-ink-3">
                {skill.status === "active" ? t("skillDetail.active") : t("skillDetail.paused")}
              </span>
            </div>
            <h2 className="macos-page-title leading-tight">{skill.name}</h2>
            <p className="macos-page-sub max-w-3xl leading-6">
              {displayDescription(skill.description) || t("common.noDescription")}
            </p>
          </div>
          <div className="flex shrink-0 gap-1.5" role="group" aria-label={t("skillDetail.actionsAria")}>
            <TranslatePreviewButton
              api={api}
              source="provider"
              skillId={skill.id}
              relativePath={files.preview?.relativePath ?? null}
              disabled={busy}
            />
            <button
              type="button"
              className="macos-btn-ghost"
              disabled={busy}
              onClick={() =>
                void (skill.status === "active" ? onPause(skill.id) : onResume(skill.id))
              }
            >
              {pendingAction === `pause:${skill.id}` ||
              pendingAction === `resume:${skill.id}`
                ? t("common.processing")
                : skill.status === "active"
                  ? t("skillDetail.pause")
                  : t("skillDetail.resume")}
            </button>
            <button
              type="button"
              className="macos-btn-ghost"
              disabled={busy}
              onClick={() => void onBackup(skill.id)}
            >
              {pendingAction === `backup:${skill.id}` ? t("common.processing") : t("skillDetail.backup")}
            </button>
            {skill.status === "active" && !skill.resolvedPath && (
              <button
                type="button"
                className="macos-btn-ghost"
                disabled={busy}
                onClick={() => {
                  setMigrateError(null);
                  setMigrateOpen(true);
                }}
              >
                {t("skillDetail.migrate")}
              </button>
            )}
            <button
              type="button"
              className="macos-btn-danger-soft"
              disabled={busy}
              onClick={() => setDeleteOpen(true)}
            >
              {deleteBusy ? t("common.processing") : t("skillDetail.delete")}
            </button>
          </div>
        </div>
        <div className="mt-3 space-y-1.5">
          <div className="flex items-center gap-2">
            <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-ink-3">
              {skill.resolvedPath ?? skill.originalPath}
            </span>
            <button
              type="button"
              className="macos-btn-ghost macos-btn-sm"
              aria-label={t("skillDetail.copyPathAria")}
              onClick={() => {
                void copyText(skill.resolvedPath ?? skill.originalPath).then(() => {
                  setCopied(true);
                  window.setTimeout(() => setCopied(false), 1500);
                });
              }}
            >
              {copied ? t("common.copied") : t("common.copy")}
            </button>
          </div>
          {skill.resolvedPath && (
            <p className="m-0 truncate font-mono text-[11px] text-ink-3">
              {t("skillDetail.linkLocation", { path: skill.currentPath })}
            </p>
          )}
          {!skill.resolvedPath && skill.currentPath !== skill.originalPath && (
            <p className="m-0 truncate font-mono text-[11px] text-ink-3">
              {t("skillDetail.currentLocation", { path: skill.currentPath })}
            </p>
          )}
        </div>
      </header>

      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-6 py-4">
        {(actionError || migrateError) && (
          <div
            className="macos-alert-error flex shrink-0 items-center justify-between gap-3"
            role="alert"
          >
            <span>{migrateError ?? actionError?.message}</span>
            <button
              type="button"
              className="macos-btn-ghost macos-btn-sm"
              onClick={() => {
                setMigrateError(null);
                onClearActionError();
              }}
            >
              {t("common.close")}
            </button>
          </div>
        )}
        {skill.warnings.length > 0 && (
          <aside
            className="macos-alert-warn shrink-0"
            aria-label={t("skillDetail.warningsAria")}
          >
            <strong>{t("skillDetail.warningsTitle")}</strong>
            <ul className="mt-1 mb-0 list-disc pl-4">
              {skill.warnings.map((warning) => (
                <li key={warning}>{warning}</li>
              ))}
            </ul>
          </aside>
        )}
        {fileError && (
          <div
            className="macos-alert-error flex shrink-0 items-center justify-between gap-3"
            role="alert"
          >
            <span>{fileError}</span>
            <button
              type="button"
              className="macos-btn-ghost macos-btn-sm"
              onClick={files.clearOpenError}
            >
              {t("common.close")}
            </button>
          </div>
        )}
        {files.preview?.relativePath.replace(/\\/g, "/") === "SKILL.md" && (
          <SkillMetaForm
            markdown={files.preview.content ?? skill.skillMarkdown}
            name={skill.name}
            description={skill.description}
            busy={busy}
            onSave={async (fields) => {
              await api.updateSkillMetadata(skill.id, fields);
              onMetadataSaved?.();
            }}
          />
        )}
        <div className="macos-split flex min-h-[240px] flex-1">
          <FileTree
            nodes={files.tree}
            selectedPath={files.preview?.relativePath ?? null}
            loading={files.treeLoading}
            errorMessage={files.treeError}
            editors={files.editors}
            onSelect={files.selectFile}
            onOpenWith={files.openWith}
          />
          <MarkdownViewer
            file={files.preview}
            loading={files.previewLoading}
            errorMessage={files.previewError}
            editable
            saving={files.saving}
            onSave={files.saveFile}
          />
        </div>
      </div>
      <ConfirmDialog
        open={deleteOpen}
        title={t("skillDetail.deleteTitle", { name: skill.name })}
        message={
          skill.resolvedPath
            ? t("skillDetail.deleteLinkMessage")
            : t("skillDetail.deleteBodyMessage")
        }
        confirmLabel={skill.resolvedPath ? t("skillDetail.removeLink") : t("skillDetail.backupAndDelete")}
        tone="danger"
        busy={deleteBusy}
        onCancel={() => setDeleteOpen(false)}
        onConfirm={() => {
          void onDelete(skill.id).then(() => setDeleteOpen(false));
        }}
      />
      <ConfirmDialog
        open={migrateOpen}
        title={t("skillDetail.migrateTitle", { name: skill.name })}
        message={t("skillDetail.migrateMessage")}
        confirmLabel={t("skillDetail.migrateConfirm")}
        busy={migrateBusy}
        onCancel={() => setMigrateOpen(false)}
        onConfirm={() => {
          setMigrateBusy(true);
          setMigrateError(null);
          void api
            .migrateProviderSkill(skill.id, replaceWithLink)
            .then(() => {
              setMigrateOpen(false);
              onMigrated();
            })
            .catch((failure: unknown) => {
              setMigrateError(errorMessage(failure));
            })
            .finally(() => setMigrateBusy(false));
        }}
      >
        <label className="flex items-center gap-2 text-[12px] text-ink-2">
          <input
            type="checkbox"
            checked={replaceWithLink}
            onChange={(event) => setReplaceWithLink(event.target.checked)}
          />
          {t("skillDetail.replaceWithLibraryLink")}
        </label>
      </ConfirmDialog>
    </section>
  );
}
