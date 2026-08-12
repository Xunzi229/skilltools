import { useState } from "react";
import type { SkillApi } from "../api/skillApi";
import { useSkillFiles } from "../hooks/useSkillFiles";
import type {
  CommandError,
  LibrarySkillDetail as LibrarySkillDetailModel,
  Provider,
  SkillGroup,
  Tag,
} from "../model/skill";
import { displayDescription, displaySourceLabel } from "../utils/skillDisplay";
import { pickSaveZip } from "../utils/dialogs";
import { ConfirmDialog } from "./ConfirmDialog";
import { FileTree } from "./FileTree";
import { MarkdownViewer } from "./MarkdownViewer";
import { NameDialog } from "./NameDialog";
import { SkillMetaForm } from "./SkillMetaForm";
import { TagColorDot } from "./TagColorPicker";
import { TargetSelector } from "./TargetSelector";
import { TranslatePreviewButton } from "./TranslatePreviewButton";
import { useI18n } from "../i18n";

interface LibraryDetailProps {
  api: SkillApi;
  skill: LibrarySkillDetailModel | null;
  tags: Tag[];
  groups: SkillGroup[];
  loading: boolean;
  detailError: CommandError | null;
  actionError: CommandError | null;
  pendingAction: string | null;
  onSetTags: (id: string, tagIds: string[]) => Promise<void>;
  onSetGroup: (id: string, groupId: string | null) => Promise<void>;
  onCreateTag: (name: string, color?: string | null) => Promise<Tag | undefined>;
  onCreateGroup: (
    name: string,
    color?: string | null,
  ) => Promise<SkillGroup | undefined>;
  onInstall: (id: string, provider: Provider) => Promise<void>;
  onUninstall: (id: string, provider: Provider) => Promise<void>;
  onExportZip: (id: string, destPath: string) => Promise<void>;
  onRename: (id: string, newName: string) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  onClearError: () => void;
  onMetadataSaved?: () => void;
}

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

export function LibraryDetail({
  api,
  skill,
  tags,
  groups,
  loading,
  detailError,
  actionError,
  pendingAction,
  onSetTags,
  onSetGroup,
  onCreateTag,
  onCreateGroup,
  onInstall,
  onUninstall,
  onExportZip,
  onRename,
  onDelete,
  onClearError,
  onMetadataSaved,
}: LibraryDetailProps) {
  const { t } = useI18n();
  const [copied, setCopied] = useState(false);
  const [nameDialog, setNameDialog] = useState<"group" | "tag" | "rename" | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const files = useSkillFiles({
    api,
    source: skill ? { kind: "library", skillId: skill.id } : null,
    reloadToken: skill?.skillMarkdown,
  });

  if (loading) {
    return (
      <section className="flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-panel">
        <div className="flex flex-1 items-center justify-center text-[13px] text-ink-3">
          {t("libraryDetail.loading")}
        </div>
      </section>
    );
  }
  if (!skill) {
    return (
      <section className="flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-panel">
        <div className="flex flex-1 items-center justify-center text-[13px] text-ink-3">
          <strong className={detailError ? "macos-alert-error" : "text-ink"}>
            {detailError?.message ?? t("libraryDetail.pickOne")}
          </strong>
        </div>
      </section>
    );
  }

  const busy = pendingAction !== null || files.saving;
  const fileError = files.treeError ?? files.previewError ?? files.openError;

  return (
    <section
      className="flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-panel"
      aria-label={t("libraryDetail.region")}
    >
      <header className="shrink-0 border-b border-line-strong px-6 pt-5 pb-4">
        {skill.parentSkillId && (
          <span className="mb-2 inline-block rounded-full bg-hover px-2 py-0.5 text-[11px] font-medium text-ink-2">
            {t("libraryDetail.childSkill")}
          </span>
        )}
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="macos-page-title leading-tight">{skill.name}</h2>
            <p className="mt-2 max-w-3xl text-[14px] leading-6 text-ink-2">
              {displayDescription(skill.description) || t("common.noDescription")}
            </p>
            <p className="mt-1.5 flex min-w-0 items-center gap-1.5 text-[12px] text-ink-3">
              <span className="shrink-0">{t("libraryDetail.source")}</span>
              {skill.sourceRepo && skill.sourceUrl ? (
                <button
                  type="button"
                  className="macos-link truncate font-mono text-[12px]"
                  title={skill.sourceUrl}
                  onClick={() => {
                    window.open(skill.sourceUrl!, "_blank", "noopener,noreferrer");
                  }}
                >
                  {skill.sourceRepo}
                </button>
              ) : (
                <span className="truncate font-mono text-[12px]">
                  {displaySourceLabel(skill.sourceRepo)}
                </span>
              )}
            </p>
          </div>
          <div className="flex shrink-0 flex-wrap gap-2">
            <TranslatePreviewButton
              api={api}
              source="library"
              skillId={skill.id}
              relativePath={files.preview?.relativePath ?? null}
              disabled={busy}
            />
            <button
              type="button"
              className="macos-btn-ghost"
              disabled={busy}
              onClick={() => setNameDialog("rename")}
            >
              {t("libraryDetail.rename")}
            </button>
            <button
              type="button"
              className="macos-btn-danger-soft"
              disabled={busy}
              onClick={() => setDeleteOpen(true)}
            >
              {t("libraryDetail.delete")}
            </button>
          </div>
        </div>
        <div className="mt-3 flex items-center gap-2">
          <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-ink-3">
            {skill.absolutePath}
          </span>
          <button
            type="button"
            className="macos-btn-ghost macos-btn-sm"
            disabled={busy}
            onClick={() => {
              void pickSaveZip(`${skill.name}.zip`).then((path) => {
                if (path) void onExportZip(skill.id, path);
              });
            }}
          >
            {t("libraryDetail.exportZip")}
          </button>
          <button
            type="button"
            className="macos-btn-ghost macos-btn-sm"
            aria-label={t("libraryDetail.copyPathAria")}
            onClick={() => {
              void copyText(skill.absolutePath).then(() => {
                setCopied(true);
                window.setTimeout(() => setCopied(false), 1500);
              });
            }}
          >
            {copied ? t("common.copied") : t("common.copy")}
          </button>
        </div>
      </header>

      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-6 py-4">
        {actionError && (
          <div
            className="macos-alert-error flex shrink-0 items-center justify-between gap-3"
            role="alert"
          >
            <span>{actionError.message}</span>
            <button
              type="button"
              className="macos-btn-ghost macos-btn-sm"
              onClick={onClearError}
            >
              {t("common.close")}
            </button>
          </div>
        )}

        <div className="grid shrink-0 gap-4 md:grid-cols-[minmax(160px,0.7fr)_1fr]">
          <div className="flex flex-col gap-1.5 text-[12px] text-ink-2">
            <div className="flex items-center justify-between gap-2">
              <span>{t("libraryDetail.group")}</span>
              <button
                type="button"
                className="macos-link"
                disabled={busy}
                onClick={() => setNameDialog("group")}
              >
                {t("libraryDetail.newGroup")}
              </button>
            </div>
            <select
              className="macos-select w-full"
              aria-label={t("libraryDetail.groupAria")}
              value={skill.groupId ?? ""}
              disabled={busy}
              onChange={(event) =>
                void onSetGroup(skill.id, event.target.value || null)
              }
            >
              <option value="">{t("libraryDetail.ungrouped")}</option>
              {[...groups]
                .sort((left, right) => left.order - right.order)
                .map((group) => (
                  <option key={group.id} value={group.id}>
                    {group.name}
                  </option>
                ))}
            </select>
          </div>
          <fieldset className="min-w-0 border-0 p-0">
            <legend className="mb-1.5 flex w-full items-center justify-between px-0 text-[12px] text-ink-2">
              <span>{t("libraryDetail.appTags")}</span>
              <button
                type="button"
                className="macos-link"
                disabled={busy}
                onClick={() => setNameDialog("tag")}
              >
                {t("libraryDetail.newTag")}
              </button>
            </legend>
            <p className="mb-1.5 text-[11px] text-ink-3">
              {t("libraryDetail.tagsHint")}
            </p>
            {tags.length === 0 ? (
              <span className="text-[12px] text-ink-3">{t("libraryDetail.noTags")}</span>
            ) : (
              <div className="flex flex-wrap gap-2">
                {tags.map((tag) => (
                  <label
                    key={tag.id}
                    className="macos-chip"
                  >
                    <input
                      type="checkbox"
                      className="size-3.5 accent-[var(--color-brand)]"
                      aria-label={tag.name}
                      checked={skill.tagIds.includes(tag.id)}
                      disabled={busy}
                      onChange={(event) => {
                        const next = event.target.checked
                          ? [...skill.tagIds, tag.id]
                          : skill.tagIds.filter((id) => id !== tag.id);
                        void onSetTags(skill.id, next);
                      }}
                    />
                    <TagColorDot color={tag.color} />
                    {tag.name}
                  </label>
                ))}
              </div>
            )}
          </fieldset>
        </div>

        <div className="shrink-0">
          <TargetSelector
            installedProviders={skill.installedProviders}
            disabled={busy}
            onApply={async (nextProviders) => {
              const current = new Set(skill.installedProviders);
              const next = new Set(nextProviders);
              for (const provider of nextProviders) {
                if (!current.has(provider)) {
                  await onInstall(skill.id, provider);
                }
              }
              for (const provider of skill.installedProviders) {
                if (!next.has(provider)) {
                  await onUninstall(skill.id, provider);
                }
              }
            }}
          />
        </div>

        {skill.warnings.length > 0 && (
          <aside className="macos-alert-warn shrink-0">
            <ul className="m-0 list-disc pl-4">
              {skill.warnings.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </aside>
        )}

        {files.preview?.relativePath.replace(/\\/g, "/") === "SKILL.md" && (
          <SkillMetaForm
            markdown={files.preview.content ?? skill.skillMarkdown}
            name={skill.name}
            description={skill.description}
            busy={busy}
            onSave={async (fields) => {
              await api.updateLibrarySkillMetadata(skill.id, fields);
              onMetadataSaved?.();
            }}
          />
        )}

        <div className="macos-split flex min-h-[240px] flex-1">
          <FileTree
            nodes={files.tree}
            selectedPath={files.preview?.relativePath ?? null}
            loading={files.treeLoading}
            errorMessage={fileError}
            editors={files.editors}
            onSelect={files.selectFile}
            onOpenWith={files.openWith}
          />
          <MarkdownViewer
            file={files.preview}
            loading={files.previewLoading}
            errorMessage={fileError}
            editable
            saving={files.saving}
            onSave={files.saveFile}
          />
        </div>
      </div>

      <NameDialog
        open={nameDialog !== null}
        title={
          nameDialog === "group"
            ? t("libraryDetail.newGroupTitle")
            : nameDialog === "tag"
              ? t("libraryDetail.newTagTitle")
              : t("libraryDetail.renameTitle")
        }
        initialValue={nameDialog === "rename" ? skill.name : ""}
        confirmLabel={nameDialog === "rename" ? t("common.rename") : t("libraryDetail.createAndApply")}
        showColorPicker={nameDialog === "tag" || nameDialog === "group"}
        initialColor={nameDialog === "tag" || nameDialog === "group" ? "#007AFF" : null}
        busy={busy}
        onCancel={() => setNameDialog(null)}
        onConfirm={(name, color) => {
          const kind = nameDialog;
          const skillId = skill.id;
          const currentTagIds = skill.tagIds;
          setNameDialog(null);
          if (kind === "group") {
            void onCreateGroup(name, color ?? null).then((group) => {
              if (group) void onSetGroup(skillId, group.id);
            });
          } else if (kind === "tag") {
            void onCreateTag(name, color ?? null).then((tag) => {
              if (tag) void onSetTags(skillId, [...currentTagIds, tag.id]);
            });
          } else if (kind === "rename") {
            void onRename(skillId, name);
          }
        }}
      />
      <ConfirmDialog
        open={deleteOpen}
        title={t("libraryDetail.deleteTitle", { name: skill.name })}
        message={t("libraryDetail.deleteMessage")}
        confirmLabel={t("common.delete")}
        tone="danger"
        busy={busy}
        onCancel={() => setDeleteOpen(false)}
        onConfirm={() => {
          void onDelete(skill.id).then(() => setDeleteOpen(false));
        }}
      />
    </section>
  );
}
