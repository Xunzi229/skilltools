import { useMemo, useState } from "react";
import {
  skillMatchesSelection,
  skillMemberIds,
  type BatchResult,
  type SkillSummary,
} from "../model/skill";
import { formatBatchSummary } from "../hooks/useBatchActions";
import {
  rowCheckboxClass,
  useSelectionMode,
} from "../hooks/useSelectionMode";
import { displayDescription, formatProviderLabels } from "../utils/skillDisplay";
import { ConfirmDialog } from "./ConfirmDialog";
import { PanelToggle } from "./PanelToggle";
import { SelectionModeButton } from "./SelectionModeButton";
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
  collapsed?: boolean;
  onToggleCollapse?: () => void;
  onSearchChange: (value: string) => void;
  onSelect: (skillId: string) => void;
  onToggleSelect: (skillIds: string[]) => void;
  onSetSelection: (ids: string[]) => void;
  onInvertSelection: (ids: string[]) => void;
  onClearSelection: () => void;
  onBatchPause: () => void;
  onBatchResume: () => void;
  onBatchBackup: () => void;
  onBatchDelete: () => void;
  onBatchMigrate: (replaceWithLink: boolean) => void;
  onRetry: () => void;
  onClearBatchResult: () => void;
}

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
  collapsed = false,
  onToggleCollapse,
  onSearchChange,
  onSelect,
  onToggleSelect,
  onSetSelection,
  onInvertSelection,
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
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [replaceWithLink, setReplaceWithLink] = useState(true);
  const { selectionActive, toggleSelectionMode } = useSelectionMode(
    selectedIds.size,
    onClearSelection,
  );

  const selectableIds = useMemo(
    () => skills.flatMap((skill) => skillMemberIds(skill)),
    [skills],
  );

  if (collapsed) {
    return (
      <section
        className="flex h-full min-h-0 w-full min-w-0 flex-col items-center gap-3 overflow-hidden border-r border-line-strong bg-panel px-1.5 py-4"
        aria-label="Skill 列表（已折叠）"
      >
        <PanelToggle
          expanded={false}
          labelExpand="展开列表"
          labelCollapse="折叠列表"
          onToggle={onToggleCollapse}
        />
        <span
          className="mt-2 write-vertical-right text-[11px] font-medium text-ink-3"
          style={{ writingMode: "vertical-rl" }}
        >
          {title}
        </span>
      </section>
    );
  }

  let content;

  if (loading) {
    content = (
      <div className="px-3 py-8 text-center text-[13px] text-ink-3">正在扫描本地 Skill…</div>
    );
  } else if (errorMessage) {
    content = (
      <div className="px-3 py-8 text-center text-[13px]" role="alert">
        <strong className="macos-alert-error block">扫描失败：{errorMessage}</strong>
        <button
          type="button"
          className="macos-btn-primary mt-3"
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
        {skills.map((skill) => {
          const memberIds = skillMemberIds(skill);
          const checked = memberIds.every((id) => selectedIds.has(id));
          return (
            <li key={skill.id} className="group flex items-center gap-1.5">
              <input
                type="checkbox"
                className={rowCheckboxClass(selectionActive)}
                checked={checked}
                tabIndex={selectionActive ? 0 : -1}
                aria-label={`选择 ${skill.name}`}
                onChange={() => onToggleSelect(memberIds)}
              />
              <div className="min-w-0 flex-1">
                <SkillCard
                  name={skill.name}
                  description={displayDescription(skill.description, 96)}
                  statusLabel={
                    skill.status === "paused"
                      ? "已暂停"
                      : formatProviderLabels(skill)
                  }
                  selected={skillMatchesSelection(skill, selectedSkillId)}
                  onSelect={() => onSelect(skill.id)}
                />
              </div>
            </li>
          );
        })}
      </ul>
    );
  }

  return (
    <section
      className="flex h-full min-h-0 w-full min-w-0 flex-col overflow-hidden border-r border-line-strong bg-panel"
      aria-label="Skill 列表"
    >
      <header className="shrink-0 border-b border-line-strong px-4 pt-5 pb-3">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <h2 className="m-0 text-[17px] font-semibold tracking-tight text-ink">{title}</h2>
            <p className="mt-1 text-[12px] text-ink-2">浏览本机已安装的 Skills</p>
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            <SelectionModeButton
              selectionActive={selectionActive}
              disabled={batchBusy}
              onToggle={toggleSelectionMode}
            />
            {onToggleCollapse && (
              <PanelToggle
                expanded
                labelExpand="展开列表"
                labelCollapse="折叠列表"
                onToggle={onToggleCollapse}
              />
            )}
          </div>
        </div>
        <label className="macos-search mt-3">
          <span className="text-[13px] text-ink-3" aria-hidden="true">
            ⌕
          </span>
          <input
            type="search"
            aria-label="搜索 Skill"
            placeholder="搜索名称或描述"
            value={search}
            onChange={(event) => onSearchChange(event.target.value)}
          />
        </label>
        {selectionActive && (
          <div className="mt-3 flex flex-col gap-1.5">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-[11px] text-ink-2">已选 {selectedIds.size} 项</span>
              <button
                type="button"
                className="macos-btn-ghost macos-btn-sm"
                disabled={batchBusy || selectableIds.length === 0}
                title="选中当前列表中的全部 Skill"
                onClick={() => onSetSelection(selectableIds)}
              >
                全选
              </button>
              <button
                type="button"
                className="macos-btn-ghost macos-btn-sm"
                disabled={batchBusy || selectableIds.length === 0}
                title="反转当前列表中的勾选状态"
                onClick={() => onInvertSelection(selectableIds)}
              >
                反选
              </button>
              {selectedIds.size > 0 ? (
                <button
                  type="button"
                  className="macos-btn-ghost macos-btn-sm"
                  disabled={batchBusy}
                  onClick={onClearSelection}
                >
                  清除
                </button>
              ) : null}
            </div>
            {selectedIds.size > 0 ? (
              <div className="flex flex-wrap gap-1.5">
                <button type="button" className="macos-btn-ghost macos-btn-sm" disabled={batchBusy} onClick={onBatchPause}>暂停</button>
                <button type="button" className="macos-btn-ghost macos-btn-sm" disabled={batchBusy} onClick={onBatchResume}>恢复</button>
                <button type="button" className="macos-btn-ghost macos-btn-sm" disabled={batchBusy} onClick={onBatchBackup}>备份</button>
                <button type="button" className="macos-btn-ghost macos-btn-sm" disabled={batchBusy} onClick={() => setMigrateOpen(true)}>迁入库</button>
                <button type="button" className="macos-btn-danger-soft macos-btn-sm" disabled={batchBusy} onClick={() => setDeleteOpen(true)}>删除</button>
              </div>
            ) : null}
          </div>
        )}
        {batchResult && (
          <div className="macos-alert-ok mt-2 flex items-start justify-between gap-2 py-1.5 text-[11px]">
            <span>{formatBatchSummary(batchResult)}</span>
            <button type="button" className="macos-link shrink-0" onClick={onClearBatchResult}>
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
      <ConfirmDialog
        open={deleteOpen}
        title={`删除 ${selectedIds.size} 个 Skill？`}
        message="将逐项先备份再删除。单项失败不会中断其余项。"
        confirmLabel="备份并删除"
        tone="danger"
        busy={batchBusy}
        onCancel={() => setDeleteOpen(false)}
        onConfirm={() => {
          onBatchDelete();
          setDeleteOpen(false);
        }}
      />
      {warnings.length > 0 && (
        <aside
          className="macos-alert-warn mx-3 mt-3 max-h-32 shrink-0 overflow-auto"
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
