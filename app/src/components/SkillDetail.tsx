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
          正在加载 Skill 详情…
        </div>
      </section>
    );
  }

  if (error) {
    return (
      <section className="flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-panel">
        <div className="flex flex-1 flex-col items-center justify-center gap-1 text-[13px]" role="alert">
          <strong className="macos-alert-error block">详情加载失败</strong>
          <span className="text-ink-3">{error.message}</span>
        </div>
      </section>
    );
  }

  if (!skill) {
    return (
      <section className="flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-panel">
        <div className="flex flex-1 flex-col items-center justify-center gap-1 text-[13px] text-ink-3">
          <strong className="text-ink">选择一个 Skill 查看详情</strong>
          <span>可在左侧筛选，再从列表中选择。</span>
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
                {skill.status === "active" ? "已启用" : "已暂停"}
              </span>
            </div>
            <h2 className="macos-page-title leading-tight">{skill.name}</h2>
            <p className="macos-page-sub max-w-3xl leading-6">
              {displayDescription(skill.description) || "暂无描述"}
            </p>
          </div>
          <div className="flex shrink-0 gap-1.5" role="group" aria-label="Skill 操作">
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
                ? "处理中…"
                : skill.status === "active"
                  ? "暂停"
                  : "恢复"}
            </button>
            <button
              type="button"
              className="macos-btn-ghost"
              disabled={busy}
              onClick={() => void onBackup(skill.id)}
            >
              {pendingAction === `backup:${skill.id}` ? "处理中…" : "备份"}
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
                迁入库
              </button>
            )}
            <button
              type="button"
              className="macos-btn-danger-soft"
              disabled={busy}
              onClick={() => setDeleteOpen(true)}
            >
              {deleteBusy ? "处理中…" : "删除"}
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
              aria-label="复制路径"
              onClick={() => {
                void copyText(skill.resolvedPath ?? skill.originalPath).then(() => {
                  setCopied(true);
                  window.setTimeout(() => setCopied(false), 1500);
                });
              }}
            >
              {copied ? "已复制" : "复制"}
            </button>
          </div>
          {skill.resolvedPath && (
            <p className="m-0 truncate font-mono text-[11px] text-ink-3">
              链接位置：{skill.currentPath}
            </p>
          )}
          {!skill.resolvedPath && skill.currentPath !== skill.originalPath && (
            <p className="m-0 truncate font-mono text-[11px] text-ink-3">
              当前位置：{skill.currentPath}
            </p>
          )}
        </div>
      </header>

      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-hidden px-6 py-4">
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
              关闭
            </button>
          </div>
        )}
        {skill.warnings.length > 0 && (
          <aside
            className="macos-alert-warn shrink-0"
            aria-label="扫描警告"
          >
            <strong>需要注意</strong>
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
              关闭
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
        <div className="macos-split flex min-h-0 flex-1">
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
        title={`删除 ${skill.name}？`}
        message={
          skill.resolvedPath
            ? "该 Skill 是符号链接，删除只会移除链接，不会删除原始目录中的文件。"
            : "此操作会先自动备份再删除 Skill，删除后可从备份记录恢复。"
        }
        confirmLabel={skill.resolvedPath ? "移除链接" : "备份并删除"}
        tone="danger"
        busy={deleteBusy}
        onCancel={() => setDeleteOpen(false)}
        onConfirm={() => {
          void onDelete(skill.id).then(() => setDeleteOpen(false));
        }}
      />
      <ConfirmDialog
        open={migrateOpen}
        title={`迁入 ${skill.name} 到中央库？`}
        message="将复制该 Skill 目录到库中并登记为本地项目。冲突时不会覆盖。"
        confirmLabel="开始迁入"
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
          迁移后替换为库链接安装
        </label>
      </ConfirmDialog>
    </section>
  );
}
