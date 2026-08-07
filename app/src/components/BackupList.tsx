import { useEffect, useMemo, useState } from "react";
import type { BackupRecord, CommandError } from "../model/skill";
import { ConfirmDialog } from "./ConfirmDialog";

interface BackupListProps {
  backups: BackupRecord[];
  loading: boolean;
  error: CommandError | null;
  actionError: CommandError | null;
  pendingAction: string | null;
  onRetry: () => void;
  onRestore: (backupId: string) => Promise<void>;
  onClearActionError: () => void;
}

const providerNames = {
  cursor: "Cursor",
  claude: "Claude",
  codex: "Codex",
};

const reasonNames = {
  manual: "手动",
  beforeDelete: "删除前",
};

function formatTime(createdAt: string) {
  return new Intl.DateTimeFormat("zh-CN", {
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
  onClearActionError,
}: BackupListProps) {
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

  useEffect(() => {
    setSelectedId((current) =>
      current && orderedBackups.some((backup) => backup.id === current)
        ? current
        : orderedBackups[0]?.id ?? null,
    );
  }, [orderedBackups]);

  const selected =
    orderedBackups.find((backup) => backup.id === selectedId) ?? null;
  const restoreBusy =
    selected !== null && pendingAction === `restore:${selected.id}`;

  return (
    <>
      <section className="skill-list-panel" aria-label="备份列表">
        <header className="list-header">
          <div>
            <p className="eyebrow">Backup Center</p>
            <h2>备份记录</h2>
          </div>
          <span className="result-count">{orderedBackups.length} 条</span>
        </header>
        <div className="list-content">
          {loading ? (
            <div className="list-state">正在加载备份记录…</div>
          ) : error ? (
            <div className="list-state error-state" role="alert">
              <strong>备份加载失败</strong>
              <span>{error.message}</span>
              <button type="button" onClick={onRetry}>
                重试
              </button>
            </div>
          ) : orderedBackups.length === 0 ? (
            <div className="list-state">
              <strong>暂无备份记录</strong>
              <span>手动备份或删除 Skill 后，记录会显示在这里。</span>
            </div>
          ) : (
            <ul className="skill-items backup-items">
              {orderedBackups.map((backup) => (
                <li key={backup.id}>
                  <button
                    type="button"
                    className={`skill-card backup-card ${
                      backup.id === selected?.id ? "is-selected" : ""
                    }`}
                    aria-pressed={backup.id === selected?.id}
                    onClick={() => {
                      setSelectedId(backup.id);
                      onClearActionError();
                    }}
                  >
                    <span className="skill-card-top">
                      <strong>{backup.skillName}</strong>
                      <span className={`provider-badge provider-${backup.provider}`}>
                        {providerNames[backup.provider]}
                      </span>
                    </span>
                    <span className="skill-description">
                      原因：{reasonNames[backup.reason]}
                    </span>
                    <span className="backup-time">{formatTime(backup.createdAt)}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      <section className="detail-panel backup-detail">
        {!selected ? (
          <div className="detail-state">
            <strong>选择一条备份查看详情</strong>
          </div>
        ) : (
          <>
            <header className="detail-header">
              <div className="detail-title-row">
                <div>
                  <div className="detail-meta">
                    <span className={`provider-badge provider-${selected.provider}`}>
                      {providerNames[selected.provider]}
                    </span>
                  </div>
                  <h2>{selected.skillName}</h2>
                  <p>创建于 {formatTime(selected.createdAt)}</p>
                </div>
                <div className="detail-actions">
                  <button
                    type="button"
                    disabled={pendingAction !== null}
                    onClick={() => setRestoreOpen(true)}
                  >
                    {restoreBusy ? "处理中…" : "恢复备份"}
                  </button>
                </div>
              </div>
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
              <dl className="backup-fields">
                <div>
                  <dt>原因</dt>
                  <dd>{reasonNames[selected.reason]}</dd>
                </div>
                <div>
                  <dt>来源</dt>
                  <dd>{providerNames[selected.provider]}</dd>
                </div>
                <div>
                  <dt>原路径</dt>
                  <dd>{selected.originalPath}</dd>
                </div>
                <div>
                  <dt>归档路径</dt>
                  <dd>{selected.archivePath}</dd>
                </div>
                <div>
                  <dt>校验值</dt>
                  <dd>{selected.checksum}</dd>
                </div>
              </dl>
            </div>
          </>
        )}
      </section>

      <ConfirmDialog
        open={restoreOpen && selected !== null}
        title={`恢复 ${selected?.skillName ?? ""}？`}
        message="将恢复到原路径；目标已存在时不会覆盖，现有目录会保持不变。"
        confirmLabel="确认恢复"
        busy={restoreBusy}
        onCancel={() => setRestoreOpen(false)}
        onConfirm={() => {
          if (selected) {
            void onRestore(selected.id).then(() => setRestoreOpen(false));
          }
        }}
      />
    </>
  );
}
