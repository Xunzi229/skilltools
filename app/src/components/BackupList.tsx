import { useEffect, useMemo, useState } from "react";
import type { BackupRecord, CommandError } from "../model/skill";
import { ConfirmDialog } from "./ConfirmDialog";
import { SkillCard } from "./SkillCard";

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
      <section
        className="flex h-full min-h-0 min-w-0 w-[340px] flex-col overflow-hidden border-r border-line-strong bg-panel"
        aria-label="备份列表"
      >
        <header className="shrink-0 border-b border-line-strong px-4 pt-5 pb-3">
          <h2 className="m-0 text-[18px] font-semibold text-ink">备份记录</h2>
          <p className="mt-1 text-[12px] text-ink-2">{orderedBackups.length} 条记录</p>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-2 py-2">
          {loading ? (
            <div className="px-3 py-8 text-center text-[13px] text-ink-3">正在加载备份记录…</div>
          ) : error ? (
            <div className="px-3 py-8 text-center text-[13px]" role="alert">
              <strong className="block text-red-600">备份加载失败</strong>
              <span className="text-ink-3">{error.message}</span>
              <button
                type="button"
                className="mt-3 rounded-md bg-brand px-3 py-1.5 text-white"
                onClick={onRetry}
              >
                重试
              </button>
            </div>
          ) : orderedBackups.length === 0 ? (
            <div className="px-3 py-8 text-center text-[13px] text-ink-3">
              <strong className="block text-ink">暂无备份记录</strong>
              <span>手动备份或删除 Skill 后，记录会显示在这里。</span>
            </div>
          ) : (
            <ul className="m-0 flex list-none flex-col gap-0.5 p-0">
              {orderedBackups.map((backup) => (
                <li key={backup.id}>
                  <SkillCard
                    name={backup.skillName}
                    description={`原因：${reasonNames[backup.reason]} · ${formatTime(backup.createdAt)}`}
                    statusLabel={providerNames[backup.provider]}
                    selected={backup.id === selected?.id}
                    onSelect={() => {
                      setSelectedId(backup.id);
                      onClearActionError();
                    }}
                  />
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      <section className="flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-panel">
        {!selected ? (
          <div className="flex flex-1 items-center justify-center text-[13px] text-ink-3">
            <strong className="text-ink">选择一条备份查看详情</strong>
          </div>
        ) : (
          <>
            <header className="shrink-0 border-b border-line-strong px-6 pt-5 pb-4">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <span className="text-[12px] text-ink-3">
                    {providerNames[selected.provider]}
                  </span>
                  <h2 className="m-0 mt-1 text-[28px] font-bold text-ink">
                    {selected.skillName}
                  </h2>
                  <p className="mt-2 text-[14px] text-ink-2">
                    创建于 {formatTime(selected.createdAt)}
                  </p>
                </div>
                <button
                  type="button"
                  className="rounded-lg bg-brand px-3 py-1.5 text-[12px] text-white disabled:opacity-55"
                  disabled={pendingAction !== null}
                  onClick={() => setRestoreOpen(true)}
                >
                  {restoreBusy ? "处理中…" : "恢复备份"}
                </button>
              </div>
            </header>
            <div className="min-h-0 flex-1 overflow-auto px-6 py-4">
              {actionError && (
                <div
                  className="mb-4 flex items-center justify-between gap-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[12px] text-red-700"
                  role="alert"
                >
                  <span>{actionError.message}</span>
                  <button
                    type="button"
                    className="rounded bg-red-100 px-2 py-1"
                    onClick={onClearActionError}
                  >
                    关闭
                  </button>
                </div>
              )}
              <dl className="m-0 grid gap-3 text-[13px]">
                <div>
                  <dt className="text-ink-3">原因</dt>
                  <dd className="m-0 mt-0.5 text-ink">{reasonNames[selected.reason]}</dd>
                </div>
                <div>
                  <dt className="text-ink-3">来源</dt>
                  <dd className="m-0 mt-0.5 text-ink">
                    {providerNames[selected.provider]}
                  </dd>
                </div>
                <div>
                  <dt className="text-ink-3">原路径</dt>
                  <dd className="m-0 mt-0.5 font-mono text-[12px] text-ink">
                    {selected.originalPath}
                  </dd>
                </div>
                <div>
                  <dt className="text-ink-3">归档路径</dt>
                  <dd className="m-0 mt-0.5 font-mono text-[12px] text-ink">
                    {selected.archivePath}
                  </dd>
                </div>
                <div>
                  <dt className="text-ink-3">校验值</dt>
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
