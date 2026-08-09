import { useState } from "react";
import type { BatchResult, SkillSummary } from "../model/skill";
import { formatBatchSummary } from "../hooks/useBatchActions";
import { displayDescription } from "../utils/skillDisplay";
import { ConfirmDialog } from "./ConfirmDialog";
import { SkillCard } from "./SkillCard";

interface SkillListProps {
  title: string;
  skills: SkillSummary[];
  selectedSkillId: string | null;
  selectedIds: Set<string>;
  search: string;
  loading: boolean;
  errorMessage: string | null;
  warnings: string[];
  hasScannedSkills: boolean;
  batchBusy: boolean;
  batchResult: BatchResult | null;
  onSearchChange: (value: string) => void;
  onSelect: (skillId: string) => void;
  onToggleSelect: (skillId: string) => void;
  onClearSelection: () => void;
  onBatchPause: () => void;
  onBatchResume: () => void;
  onBatchBackup: () => void;
  onBatchDelete: () => void;
  onBatchMigrate: (replaceWithLink: boolean) => void;
  onRetry: () => void;
  onClearBatchResult: () => void;
}

const providerNames = {
  cursor: "Cursor",
  claude: "Claude",
  codex: "Codex",
};

export function SkillList({
  title,
  skills,
  selectedSkillId,
  selectedIds,
  search,
  loading,
  errorMessage,
  warnings,
  hasScannedSkills,
  batchBusy,
  batchResult,
  onSearchChange,
  onSelect,
  onToggleSelect,
  onClearSelection,
  onBatchPause,
  onBatchResume,
  onBatchBackup,
  onBatchDelete,
  onBatchMigrate,
  onRetry,
  onClearBatchResult,
}: SkillListProps) {
  const [migrateOpen, setMigrateOpen] = useState(false);
  const [replaceWithLink, setReplaceWithLink] = useState(true);
  let content;

  if (loading) {
    content = (
      <div className="px-3 py-8 text-center text-[13px] text-ink-3">正在扫描本地 Skill…</div>
    );
  } else if (errorMessage) {
    content = (
      <div className="px-3 py-8 text-center text-[13px]" role="alert">
        <strong className="block text-red-600">扫描失败：{errorMessage}</strong>
        <button
          type="button"
          className="mt-3 rounded-md bg-brand px-3 py-1.5 text-white"
          onClick={onRetry}
        >
          重试扫描
        </button>
      </div>
    );
  } else if (!hasScannedSkills) {
    content = (
      <div className="px-3 py-8 text-center text-[13px] text-ink-3">
        <strong className="block text-ink">未扫描到 Skill</strong>
        <span>请确认本地 Skill 目录中已有内容。</span>
      </div>
    );
  } else if (skills.length === 0) {
    content = (
      <div className="px-3 py-8 text-center text-[13px] text-ink-3">
        <strong className="block text-ink">没有匹配结果</strong>
        <span>请调整筛选条件或搜索关键词。</span>
      </div>
    );
  } else {
    content = (
      <ul className="m-0 flex list-none flex-col gap-0.5 p-0">
        {skills.map((skill) => (
          <li key={skill.id} className="flex items-start gap-1">
            <input
              type="checkbox"
              className="mt-4 ml-1"
              checked={selectedIds.has(skill.id)}
              aria-label={`选择 ${skill.name}`}
              onChange={() => onToggleSelect(skill.id)}
            />
            <div className="min-w-0 flex-1">
              <SkillCard
                name={skill.name}
                description={displayDescription(skill.description, 96)}
                statusLabel={
                  skill.status === "paused"
                    ? "已暂停"
                    : providerNames[skill.provider]
                }
                selected={selectedSkillId === skill.id}
                onSelect={() => onSelect(skill.id)}
              />
            </div>
          </li>
        ))}
      </ul>
    );
  }

  return (
    <section
      className="flex h-full min-h-0 min-w-0 w-[340px] flex-col overflow-hidden border-r border-line-strong bg-panel"
      aria-label="Skill 列表"
    >
      <header className="shrink-0 border-b border-line-strong px-4 pt-5 pb-3">
        <h2 className="m-0 text-[18px] font-semibold text-ink">{title}</h2>
        <p className="mt-1 text-[12px] text-ink-2">浏览本机已安装的 Skills</p>
        <label className="mt-3 flex h-[38px] items-center gap-2 rounded-lg border border-line bg-panel px-3">
          <span className="text-ink-3" aria-hidden="true">
            ⌕
          </span>
          <input
            type="search"
            className="w-full border-0 bg-transparent text-[13px] text-ink outline-none placeholder:text-ink-3"
            aria-label="搜索 Skill"
            placeholder="搜索名称或描述"
            value={search}
            onChange={(event) => onSearchChange(event.target.value)}
          />
        </label>
        {selectedIds.size > 0 && (
          <div className="mt-3 flex flex-wrap gap-1.5">
            <span className="w-full text-[11px] text-ink-2">已选 {selectedIds.size} 项</span>
            <button type="button" className="rounded border border-line px-2 py-1 text-[11px] hover:bg-hover disabled:opacity-55" disabled={batchBusy} onClick={onBatchPause}>暂停</button>
            <button type="button" className="rounded border border-line px-2 py-1 text-[11px] hover:bg-hover disabled:opacity-55" disabled={batchBusy} onClick={onBatchResume}>恢复</button>
            <button type="button" className="rounded border border-line px-2 py-1 text-[11px] hover:bg-hover disabled:opacity-55" disabled={batchBusy} onClick={onBatchBackup}>备份</button>
            <button type="button" className="rounded border border-line px-2 py-1 text-[11px] hover:bg-hover disabled:opacity-55" disabled={batchBusy} onClick={() => setMigrateOpen(true)}>迁入库</button>
            <button type="button" className="rounded border border-red-200 px-2 py-1 text-[11px] text-red-700 hover:bg-red-50 disabled:opacity-55" disabled={batchBusy} onClick={onBatchDelete}>删除</button>
            <button type="button" className="rounded border border-line px-2 py-1 text-[11px] hover:bg-hover" disabled={batchBusy} onClick={onClearSelection}>清除</button>
          </div>
        )}
        {batchResult && (
          <div className="mt-2 flex items-start justify-between gap-2 rounded border border-line bg-hover px-2 py-1.5 text-[11px] text-ink-2">
            <span>{formatBatchSummary(batchResult)}</span>
            <button type="button" className="shrink-0" onClick={onClearBatchResult}>
              关闭
            </button>
          </div>
        )}
      </header>
      <ConfirmDialog
        open={migrateOpen}
        title={`迁入 ${selectedIds.size} 个 Skill 到中央库？`}
        message="将复制真实目录到库中登记为本地项目。冲突时不会覆盖现有内容。"
        confirmLabel="开始迁入"
        busy={batchBusy}
        onCancel={() => setMigrateOpen(false)}
        onConfirm={() => {
          onBatchMigrate(replaceWithLink);
          setMigrateOpen(false);
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
      {warnings.length > 0 && (
        <aside
          className="mx-3 mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[12px] text-amber-800"
          aria-label="扫描目录警告"
        >
          <strong>部分目录未扫描</strong>
          <ul className="mt-1 mb-0 list-disc pl-4">
            {warnings.map((warning) => (
              <li key={warning}>{warning}</li>
            ))}
          </ul>
        </aside>
      )}
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-2 py-2">
        {content}
      </div>
    </section>
  );
}
