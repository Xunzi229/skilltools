import { useState } from "react";
import type {
  CommandError,
  GitImportItem,
  Project,
  ProjectPullResult,
} from "../model/skill";
import { pickDirectory, pickSaveZip, pickZipFile } from "../utils/dialogs";
import { ConfirmDialog } from "./ConfirmDialog";
import { getLocale, useI18n } from "../i18n";

interface ProjectPanelProps {
  projects: Project[];
  gitImports: GitImportItem[];
  loading: boolean;
  error: CommandError | null;
  pendingAction: string | null;
  onAddLocal: (path: string) => Promise<void>;
  onAddGit: (url: string) => Promise<void>;
  onRetryGitImport: (tempId: string) => Promise<void>;
  onDismissGitImport: (tempId: string) => void;
  onPull: (id: string) => Promise<ProjectPullResult | undefined>;
  onRemove: (id: string) => Promise<void>;
  onImportZip: (zipPath: string) => Promise<void>;
  onExportZip: (projectId: string, destPath: string) => Promise<void>;
  onClearError: () => void;
}

function formatDateTime(value: string | null): string {
  if (!value) {
    return "—";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "—";
  }
  const locale = getLocale() === "en" ? "en-US" : "zh-CN";
  return new Intl.DateTimeFormat(locale, {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

export function ProjectPanel({
  projects,
  gitImports,
  loading,
  error,
  pendingAction,
  onAddLocal,
  onAddGit,
  onRetryGitImport,
  onDismissGitImport,
  onPull,
  onRemove,
  onImportZip,
  onExportZip,
  onClearError,
}: ProjectPanelProps) {
  const { t } = useI18n();
  const [localPath, setLocalPath] = useState("");
  const [gitUrl, setGitUrl] = useState("");
  const [pullSummary, setPullSummary] = useState<string | null>(null);
  const [removeTarget, setRemoveTarget] = useState<Project | null>(null);
  const busy = pendingAction !== null;
  const removeBusy =
    removeTarget !== null && pendingAction === `project:remove:${removeTarget.id}`;
  const hasRows = projects.length > 0 || gitImports.length > 0;

  return (
    <>
    <section
      className="col-span-2 flex h-full min-h-0 min-w-0 flex-col overflow-hidden bg-panel"
      aria-label={t("projects.region")}
    >
      <header className="shrink-0 border-b border-line-strong px-6 pt-5 pb-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="macos-page-title">{t("projects.title")}</h2>
            <p className="macos-page-sub">{t("projects.subtitle")}</p>
          </div>
          <button
            type="button"
            className="macos-btn-ghost"
            disabled={busy}
            onClick={() => {
              void pickZipFile(t("projects.importZipTitle")).then((path) => {
                if (path) void onImportZip(path);
              });
            }}
          >
            {t("projects.importZip")}
          </button>
        </div>
      </header>
      <div className="min-h-0 flex-1 overflow-auto px-6 py-5">
        {error && (
          <div
            className="macos-alert-error mb-4 flex items-center justify-between gap-3"
            role="alert"
          >
            <span>{error.message}</span>
            <button type="button" className="macos-btn-ghost" onClick={onClearError}>
              {t("common.close")}
            </button>
          </div>
        )}
        {pullSummary && (
          <div className="macos-alert-ok mb-4 flex items-center justify-between gap-3">
            <span>{pullSummary}</span>
            <button
              type="button"
              className="macos-btn-ghost"
              onClick={() => setPullSummary(null)}
            >
              {t("common.close")}
            </button>
          </div>
        )}
        <div className="mb-6 grid gap-4 md:grid-cols-2">
          <form
            className="flex flex-col gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              if (localPath.trim()) void onAddLocal(localPath.trim());
            }}
          >
            <label htmlFor="local-project-path" className="text-[12px] text-ink-2">
              {t("projects.localPath")}
            </label>
            <div className="flex gap-2">
              <input
                id="local-project-path"
                className="macos-input min-w-0 flex-1"
                aria-label={t("projects.localPathAria")}
                value={localPath}
                onChange={(event) => setLocalPath(event.target.value)}
                placeholder="/Users/me/skills"
              />
              <button
                type="button"
                className="macos-btn-ghost shrink-0"
                disabled={busy}
                onClick={() => {
                  void pickDirectory(t("projects.pickDirectoryTitle")).then((path) => {
                    if (path) setLocalPath(path);
                  });
                }}
              >
                {t("projects.pickDirectory")}
              </button>
              <button
                type="submit"
                className="macos-btn-primary shrink-0"
                disabled={busy || !localPath.trim()}
              >
                {t("projects.addLocal")}
              </button>
            </div>
          </form>
          <form
            className="flex flex-col gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              const url = gitUrl.trim();
              if (!url) return;
              setGitUrl("");
              void onAddGit(url);
            }}
          >
            <label htmlFor="git-project-url" className="text-[12px] text-ink-2">
              {t("projects.gitUrl")}
            </label>
            <div className="flex gap-2">
              <input
                id="git-project-url"
                className="macos-input min-w-0 flex-1"
                aria-label={t("projects.gitUrlAria")}
                value={gitUrl}
                onChange={(event) => setGitUrl(event.target.value)}
                placeholder="https://example.com/team/skills.git"
              />
              <button
                type="submit"
                className="macos-btn-primary shrink-0"
                disabled={!gitUrl.trim()}
              >
                {t("projects.addGit")}
              </button>
            </div>
          </form>
        </div>
        {loading && !hasRows ? (
          <div className="py-10 text-center text-[13px] text-ink-3">{t("projects.loading")}</div>
        ) : !hasRows ? (
          <div className="py-10 text-center text-[13px] text-ink-3">
            <strong className="text-ink">{t("projects.empty")}</strong>
          </div>
        ) : (
          <ul className="m-0 flex list-none flex-col gap-2 p-0">
            {gitImports.map((item) => (
              <li
                key={item.tempId}
                className="macos-card flex items-center justify-between gap-4 px-4 py-3"
                data-import-status={item.status}
              >
                <div className="min-w-0">
                  <strong className="block text-[14px] text-ink">{item.name}</strong>
                  <span className="mt-1 block truncate font-mono text-[10px] text-ink-3">
                    {item.url}
                  </span>
                  {item.status === "importing" ? (
                    <span className="project-meta mt-1 block text-[11px] text-ink-3">
                      {t("projects.importing")}
                    </span>
                  ) : (
                    <span
                      className="project-meta mt-1 block text-[11px] text-[#c41e16]"
                      role="alert"
                    >
                      {t("projects.importFailed", { message: item.error?.message ?? t("common.unknownError") })}
                    </span>
                  )}
                </div>
                <div className="flex shrink-0 items-center gap-1.5">
                  {item.status === "importing" ? (
                    <span className="macos-badge">{t("projects.importingBadge")}</span>
                  ) : (
                    <>
                      <button
                        type="button"
                        className="macos-btn-primary macos-btn-sm"
                        onClick={() => void onRetryGitImport(item.tempId)}
                      >
                        {t("projects.retry")}
                      </button>
                      <button
                        type="button"
                        className="macos-btn-danger-soft macos-btn-sm"
                        aria-label={t("projects.deleteFailedAria", { name: item.name })}
                        onClick={() => onDismissGitImport(item.tempId)}
                      >
                        {t("projects.delete")}
                      </button>
                    </>
                  )}
                </div>
              </li>
            ))}
            {projects.map((project) => (
              <li
                key={project.id}
                className="macos-card flex items-center justify-between gap-4 px-4 py-3"
              >
                <div className="min-w-0">
                  <strong className="block text-[14px] text-ink">{project.name}</strong>
                  <span className="mt-1 block truncate font-mono text-[10px] text-ink-3">
                    {project.remoteUrl ?? project.localPath}
                  </span>
                  <span className="project-meta mt-1 block text-[11px] text-ink-3">
                    {t("projects.lastUpdated", { time: formatDateTime(project.lastUpdatedAt) })}
                    {" · "}
                    {t("projects.lastPulled", { time: formatDateTime(project.lastSyncedAt) })}
                  </span>
                </div>
                <div className="flex shrink-0 gap-1.5">
                  {project.sourceType === "git" && (
                    <button
                      type="button"
                      className="macos-btn-primary macos-btn-sm"
                      aria-label={t("projects.pullAria", { name: project.name })}
                      disabled={busy}
                      onClick={() => {
                        void onPull(project.id).then((result) => {
                          if (!result) return;
                          const names = (skills: { name: string }[]) =>
                            skills
                              .slice(0, 5)
                              .map((skill) => skill.name)
                              .join("、");
                          setPullSummary(
                            t("projects.pullResult", {
                              added: result.added.length,
                              addedNames: names(result.added) || t("common.none"),
                              removed: result.removed.length,
                              changed: result.changed.length,
                            }),
                          );
                        });
                      }}
                    >
                      {pendingAction === `project:pull:${project.id}` ? t("projects.pulling") : t("projects.pull")}
                    </button>
                  )}
                  <button
                    type="button"
                    className="macos-btn-ghost macos-btn-sm"
                    disabled={busy}
                    onClick={() => {
                      void pickSaveZip(`${project.name}.zip`).then((path) => {
                        if (path) void onExportZip(project.id, path);
                      });
                    }}
                  >
                    {t("projects.export")}
                  </button>
                  <button
                    type="button"
                    className="macos-btn-danger-soft macos-btn-sm"
                    aria-label={t("projects.removeAria", { name: project.name })}
                    disabled={busy}
                    onClick={() => setRemoveTarget(project)}
                  >
                    {t("projects.remove")}
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
    <ConfirmDialog
      open={removeTarget !== null}
      title={t("projects.removeTitle", { name: removeTarget?.name ?? "" })}
      message={t("projects.removeMessage")}
      confirmLabel={t("projects.removeConfirm")}
      tone="danger"
      busy={removeBusy}
      onCancel={() => setRemoveTarget(null)}
      onConfirm={() => {
        if (!removeTarget) return;
        void onRemove(removeTarget.id).then(() => setRemoveTarget(null));
      }}
    />
    </>
  );
}
