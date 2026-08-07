import { useEffect, useRef, useState } from "react";
import type { SkillApi } from "../api/skillApi";
import type {
  CommandError,
  FileContent,
  FileNode,
  SkillDetail as SkillDetailModel,
} from "../model/skill";
import { ConfirmDialog } from "./ConfirmDialog";
import { FilePreview } from "./FilePreview";
import { FileTree } from "./FileTree";

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
  onClearActionError: () => void;
}

const providerNames = {
  cursor: "Cursor",
  claude: "Claude",
  codex: "Codex",
};

function errorMessage(error: unknown): string {
  if (typeof error === "object" && error !== null) {
    const candidate = error as Record<string, unknown>;
    if (typeof candidate.message === "string") {
      return candidate.message;
    }
  }
  return "文件加载失败，请重试";
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
  onClearActionError,
}: SkillDetailProps) {
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [tree, setTree] = useState<FileNode[]>([]);
  const [treeLoading, setTreeLoading] = useState(false);
  const [treeError, setTreeError] = useState<string | null>(null);
  const [preview, setPreview] = useState<FileContent | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const treeRequest = useRef(0);
  const previewRequest = useRef(0);

  const loadPreview = (skillId: string, relativePath: string) => {
    const requestId = ++previewRequest.current;
    setPreviewLoading(true);
    setPreviewError(null);
    void api
      .readSkillFile(skillId, relativePath)
      .then((content) => {
        if (requestId === previewRequest.current) {
          setPreview(content);
        }
      })
      .catch((previewFailure: unknown) => {
        if (requestId === previewRequest.current) {
          setPreview(null);
          setPreviewError(errorMessage(previewFailure));
        }
      })
      .finally(() => {
        if (requestId === previewRequest.current) {
          setPreviewLoading(false);
        }
      });
  };

  useEffect(() => {
    const skillId = skill?.id;
    const requestId = ++treeRequest.current;
    previewRequest.current += 1;
    setTree([]);
    setPreview(null);
    setTreeError(null);
    setPreviewError(null);
    if (!skillId) {
      setTreeLoading(false);
      setPreviewLoading(false);
      return;
    }

    setTreeLoading(true);
    void api
      .listSkillTree(skillId)
      .then((nodes) => {
        if (requestId === treeRequest.current) {
          setTree(nodes);
        }
      })
      .catch((treeFailure: unknown) => {
        if (requestId === treeRequest.current) {
          setTreeError(errorMessage(treeFailure));
        }
      })
      .finally(() => {
        if (requestId === treeRequest.current) {
          setTreeLoading(false);
        }
      });
    loadPreview(skillId, "SKILL.md");
  }, [api, skill?.id, skill?.skillMarkdown]);

  if (loading) {
    return (
      <section className="detail-panel">
        <div className="detail-state">正在加载 Skill 详情…</div>
      </section>
    );
  }

  if (error) {
    return (
      <section className="detail-panel">
        <div className="detail-state error-state" role="alert">
          <strong>详情加载失败</strong>
          <span>{error.message}</span>
        </div>
      </section>
    );
  }

  if (!skill) {
    return (
      <section className="detail-panel">
        <div className="detail-state">
          <strong>选择一个 Skill 查看详情</strong>
          <span>可在左侧筛选，再从列表中选择。</span>
        </div>
      </section>
    );
  }

  const busy = pendingAction !== null;
  const deleteBusy = pendingAction === `delete:${skill.id}`;

  return (
    <section className="detail-panel">
      <header className="detail-header">
        <div className="detail-title-row">
          <div>
            <div className="detail-meta">
              <span className={`provider-badge provider-${skill.provider}`}>
                {providerNames[skill.provider]}
              </span>
              <span className={`status-label status-${skill.status}`}>
                <i aria-hidden="true" />
                {skill.status === "active" ? "已启用" : "已暂停"}
              </span>
            </div>
            <h2>{skill.name}</h2>
            <p>{skill.description || "暂无描述"}</p>
          </div>
          <div className="detail-actions" role="group" aria-label="Skill 操作">
            <button
              type="button"
              disabled={busy}
              onClick={() =>
                void (skill.status === "active"
                  ? onPause(skill.id)
                  : onResume(skill.id))
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
              disabled={busy}
              onClick={() => void onBackup(skill.id)}
            >
              {pendingAction === `backup:${skill.id}` ? "处理中…" : "备份"}
            </button>
            <button
              className="danger-action"
              type="button"
              disabled={busy}
              onClick={() => setDeleteOpen(true)}
            >
              {deleteBusy ? "处理中…" : "删除"}
            </button>
          </div>
        </div>

        <dl className="path-list">
          <div>
            <dt>原始路径</dt>
            <dd>{skill.originalPath}</dd>
          </div>
          {skill.currentPath !== skill.originalPath && (
            <div>
              <dt>当前位置</dt>
              <dd>{skill.currentPath}</dd>
            </div>
          )}
        </dl>
      </header>

      <div className="detail-scroll">
        {actionError && (
          <div className="action-error" role="alert">
            <span>{actionError.message}</span>
            <button type="button" onClick={onClearActionError}>
              关闭
            </button>
          </div>
        )}
        {skill.warnings.length > 0 && (
          <aside className="warning-block" aria-label="扫描警告">
            <strong>需要注意</strong>
            <ul>
              {skill.warnings.map((warning) => <li key={warning}>{warning}</li>)}
            </ul>
          </aside>
        )}

        <div className="file-browser">
          <FileTree
            nodes={tree}
            selectedPath={preview?.relativePath ?? null}
            loading={treeLoading}
            errorMessage={treeError}
            onSelect={(relativePath) => loadPreview(skill.id, relativePath)}
          />
          <FilePreview
            file={preview}
            loading={previewLoading}
            errorMessage={previewError}
          />
        </div>
      </div>
      <ConfirmDialog
        open={deleteOpen}
        title={`删除 ${skill.name}？`}
        message="此操作会先自动备份再删除 Skill，删除后可从备份记录恢复。"
        confirmLabel="备份并删除"
        tone="danger"
        busy={deleteBusy}
        onCancel={() => setDeleteOpen(false)}
        onConfirm={() => {
          void onDelete(skill.id).then(() => setDeleteOpen(false));
        }}
      />
    </section>
  );
}
