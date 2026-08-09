import { useState } from "react";
import type { CommandError, Project, ProjectPullResult } from "../model/skill";
import { pickDirectory, pickSaveZip, pickZipFile } from "../utils/dialogs";
import { ConfirmDialog } from "./ConfirmDialog";

interface ProjectPanelProps {
  projects: Project[];
  loading: boolean;
  error: CommandError | null;
  pendingAction: string | null;
  onAddLocal: (path: string) => Promise<void>;
  onAddGit: (url: string) => Promise<void>;
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
  return new Intl.DateTimeFormat("zh-CN", {
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
  loading,
  error,
  pendingAction,
  onAddLocal,
  onAddGit,
  onPull,
  onRemove,
  onImportZip,
  onExportZip,
  onClearError,
}: ProjectPanelProps) {
  const [localPath, setLocalPath] = useState("");
  const [gitUrl, setGitUrl] = useState("");
  const [pullSummary, setPullSummary] = useState<string | null>(null);
  const [removeTarget, setRemoveTarget] = useState<Project | null>(null);
  const busy = pendingAction !== null;
  const removeBusy =
    removeTarget !== null && pendingAction === `project:remove:${removeTarget.id}`;

  return (
    <>
    <section
      className="col-span-2 flex h-full min-h-0 min-w-0 flex-col overflow-hidden bg-panel"
      aria-label="项目管理"
    >
      <header className="shrink-0 border-b border-line-strong px-6 pt-5 pb-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="macos-page-title">项目</h2>
            <p className="macos-page-sub">
              添加本地 Skill 目录，或克隆并维护 Git Skill 仓库。
            </p>
          </div>
          <button
            type="button"
            className="macos-btn-ghost"
            disabled={busy}
            onClick={() => {
              void pickZipFile("导入 Skill ZIP").then((path) => {
                if (path) void onImportZip(path);
              });
            }}
          >
            导入 ZIP
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
              关闭
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
              关闭
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
              本地项目路径
            </label>
            <div className="flex gap-2">
              <input
                id="local-project-path"
                className="macos-input min-w-0 flex-1"
                aria-label="本地项目路径"
                value={localPath}
                onChange={(event) => setLocalPath(event.target.value)}
                placeholder="/Users/me/skills"
              />
              <button
                type="button"
                className="macos-btn-ghost shrink-0"
                disabled={busy}
                onClick={() => {
                  void pickDirectory("选择本地项目目录").then((path) => {
                    if (path) setLocalPath(path);
                  });
                }}
              >
                选择目录
              </button>
              <button
                type="submit"
                className="macos-btn-primary shrink-0"
                disabled={busy || !localPath.trim()}
              >
                添加本地项目
              </button>
            </div>
          </form>
          <form
            className="flex flex-col gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              if (gitUrl.trim()) void onAddGit(gitUrl.trim());
            }}
          >
            <label htmlFor="git-project-url" className="text-[12px] text-ink-2">
              Git 仓库 URL
            </label>
            <div className="flex gap-2">
              <input
                id="git-project-url"
                className="macos-input min-w-0 flex-1"
                aria-label="Git 仓库 URL"
                value={gitUrl}
                onChange={(event) => setGitUrl(event.target.value)}
                placeholder="https://example.com/team/skills.git"
              />
              <button
                type="submit"
                className="macos-btn-primary shrink-0"
                disabled={busy || !gitUrl.trim()}
              >
                添加 Git 项目
              </button>
            </div>
          </form>
        </div>
        {loading ? (
          <div className="py-10 text-center text-[13px] text-ink-3">正在加载项目…</div>
        ) : projects.length === 0 ? (
          <div className="py-10 text-center text-[13px] text-ink-3">
            <strong className="text-ink">暂无项目</strong>
          </div>
        ) : (
          <ul className="m-0 flex list-none flex-col gap-2 p-0">
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
                    最后更新 {formatDateTime(project.lastUpdatedAt)}
                    {" · "}
                    拉取 {formatDateTime(project.lastSyncedAt)}
                  </span>
                </div>
                <div className="flex shrink-0 gap-1.5">
                  {project.sourceType === "git" && (
                    <button
                      type="button"
                      className="macos-btn-primary macos-btn-sm"
                      aria-label={`拉取 ${project.name}`}
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
                            `拉取完成：新增 ${result.added.length}（${names(result.added) || "无"}），移除 ${result.removed.length}，变更 ${result.changed.length}`,
                          );
                        });
                      }}
                    >
                      {pendingAction === `project:pull:${project.id}` ? "拉取中…" : "拉取"}
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
                    导出
                  </button>
                  <button
                    type="button"
                    className="macos-btn-danger-soft macos-btn-sm"
                    aria-label={`移除 ${project.name}`}
                    disabled={busy}
                    onClick={() => setRemoveTarget(project)}
                  >
                    移除
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
      title={`移除项目「${removeTarget?.name ?? ""}」？`}
      message="仅从 Skill Manager 移除引用，不会删除磁盘上的项目目录。"
      confirmLabel="确认移除"
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
