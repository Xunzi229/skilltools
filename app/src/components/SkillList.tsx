import { useEffect, useMemo, useState } from "react";
import {
  type CommandError,
  skillMatchesSelection,
  skillMemberIds,
  type BatchResult,
  type SkillSummary,
} from "../model/skill";
import type { TaxonomyChip } from "../model/taxonomy";
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
import { useI18n } from "../i18n";

export type InstalledSkillTaxonomy = {
  librarySkillId: string;
  groupLabel: string | null;
  tagLabels: string[];
};

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
  batchError: CommandError | null;
  collapsed?: boolean;
  taxonomyActive?: boolean;
  queryChips?: TaxonomyChip[];
  resolveTaxonomy?: (skill: SkillSummary) => InstalledSkillTaxonomy | null;
  onToggleCollapse?: () => void;
  onSearchChange: (value: string) => void;
  onSelect: (skillId: string) => void;
  onToggleSelect: (skillIds: string[]) => void;
  onSetSelection: (ids: string[]) => void;
  onInvertSelection: (ids: string[]) => void;
  onClearSelection: () => void;
  onRemoveQueryChip?: (chip: TaxonomyChip) => void;
  onClearQuery?: () => void;
  onOpenLibrarySkill?: (librarySkillId: string) => void;
  onBatchPause: (ids: string[]) => void;
  onBatchResume: (ids: string[]) => void;
  onBatchBackup: (ids: string[]) => void;
  onBatchDelete: (ids: string[]) => void;
  onBatchMigrate: (ids: string[], replaceWithLink: boolean) => void;
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
  batchError,
  collapsed = false,
  taxonomyActive = false,
  queryChips = [],
  resolveTaxonomy,
  onToggleCollapse,
  onSearchChange,
  onSelect,
  onToggleSelect,
  onSetSelection,
  onInvertSelection,
  onClearSelection,
  onRemoveQueryChip,
  onClearQuery,
  onBatchPause,
  onBatchResume,
  onBatchBackup,
  onBatchDelete,
  onBatchMigrate,
  onRetry,
  onClearBatchResult,
}: SkillListProps) {
  const { t } = useI18n();
  const selectableIds = useMemo(
    () => [...new Set(skills.flatMap((skill) => skillMemberIds(skill)))],
    [skills],
  );
  const selectedSelectableIds = useMemo(
    () => selectableIds.filter((id) => selectedIds.has(id)),
    [selectableIds, selectedIds],
  );
  const selectedSelectableSet = useMemo(
    () => new Set(selectedSelectableIds),
    [selectedSelectableIds],
  );

  useEffect(() => {
    if (loading || selectedSelectableIds.length === selectedIds.size) return;
    onSetSelection(selectedSelectableIds);
  }, [
    loading,
    onSetSelection,
    selectedIds.size,
    selectedSelectableIds,
  ]);

  const [deleteTitle, deleteMessage, deleteConfirmLabel] = useMemo(() => {
    let linkCount = 0;
    let bodyCount = 0;
    for (const skill of skills) {
      for (const id of skillMemberIds(skill)) {
        if (!selectedSelectableSet.has(id)) continue;
        if (skill.resolvedPath) linkCount += 1;
        else bodyCount += 1;
      }
    }
    const total = linkCount + bodyCount;
    if (total === 0) {
      return [t("skillList.deleteOneTitle"), "", t("skillList.deleteOneConfirm")] as const;
    }
    if (bodyCount === 0) {
      return [
        t("skillList.removeLinksTitle", { count: linkCount }),
        t("skillList.removeLinksMessage"),
        t("skillList.removeLinksConfirm"),
      ] as const;
    }
    if (linkCount === 0) {
      return [
        t("skillList.deleteBodiesTitle", { count: bodyCount }),
        t("skillList.deleteBodiesMessage"),
        t("skillList.deleteBodiesConfirm"),
      ] as const;
    }
    return [
      t("skillList.deleteMixedTitle", { total }),
      t("skillList.deleteMixedMessage", { linkCount, bodyCount }),
      t("skillList.deleteMixedConfirm"),
    ] as const;
  }, [skills, selectedSelectableSet, t]);
  const [migrateOpen, setMigrateOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [replaceWithLink, setReplaceWithLink] = useState(true);
  const { selectionActive, toggleSelectionMode } = useSelectionMode(
    selectedIds.size,
    onClearSelection,
  );

  if (collapsed) {
    return (
      <section
        className="flex h-full min-h-0 w-full min-w-0 flex-col items-center gap-3 overflow-hidden border-r border-line-strong bg-panel px-1.5 py-4"
        aria-label={t("skillList.regionCollapsed")}
      >
        <PanelToggle
          expanded={false}
          labelExpand={t("common.expandList")}
          labelCollapse={t("common.collapseList")}
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
      <div className="px-3 py-8 text-center text-[13px] text-ink-3">{t("skillList.scanning")}</div>
    );
  } else if (errorMessage) {
    content = (
      <div className="px-3 py-8 text-center text-[13px]" role="alert">
        <strong className="macos-alert-error block">{t("skillList.scanFailed", { message: errorMessage })}</strong>
        <button
          type="button"
          className="macos-btn-primary mt-3"
          onClick={onRetry}
        >
          {t("skillList.retryScan")}
        </button>
      </div>
    );
  } else if (!hasScannedSkills) {
    content = (
      <div className="px-3 py-8 text-center text-[13px] text-ink-3">
        <strong className="block text-ink">{t("skillList.emptyTitle")}</strong>
        <span>{t("skillList.emptyHint")}</span>
      </div>
    );
  } else if (skills.length === 0) {
    content = (
      <div className="px-3 py-8 text-center text-[13px] text-ink-3">
        <strong className="block text-ink">{t("skillList.noMatchTitle")}</strong>
        <span>
          {taxonomyActive
            ? t("skillList.noMatchTaxonomy")
            : t("skillList.noMatchSearch")}
        </span>
      </div>
    );
  } else {
    content = (
      <ul className="m-0 flex list-none flex-col gap-0.5 p-0">
        {skills.map((skill) => {
          const memberIds = skillMemberIds(skill);
          const checked = memberIds.every((id) => selectedSelectableSet.has(id));
          const taxonomy = resolveTaxonomy?.(skill) ?? null;
          return (
            <li key={skill.id} className="group flex items-center gap-1.5">
              <input
                type="checkbox"
                className={rowCheckboxClass(selectionActive)}
                checked={checked}
                tabIndex={selectionActive ? 0 : -1}
                aria-label={t("common.selectItem", { name: skill.name })}
                onChange={() => onToggleSelect(memberIds)}
              />
              <div className="min-w-0 flex-1">
                <SkillCard
                  name={skill.name}
                  description={displayDescription(skill.description, 96)}
                  statusLabel={
                    skill.status === "paused"
                      ? t("skillList.paused")
                      : formatProviderLabels(skill)
                  }
                  selected={skillMatchesSelection(skill, selectedSkillId)}
                  groupLabel={taxonomy?.groupLabel}
                  tagLabels={taxonomy?.tagLabels ?? []}
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
      aria-label={t("skillList.region")}
    >
      <header className="shrink-0 border-b border-line-strong px-4 pt-5 pb-3">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <h2 className="m-0 text-[17px] font-semibold tracking-tight text-ink">{title}</h2>
            <p className="mt-1 text-[12px] text-ink-2">
              {taxonomyActive
                ? t("skillList.subtitleTaxonomy")
                : t("skillList.subtitleBrowse")}
            </p>
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
                labelExpand={t("common.expandList")}
                labelCollapse={t("common.collapseList")}
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
            aria-label={t("skillList.searchAria")}
            placeholder={t("skillList.searchPlaceholder")}
            value={search}
            onChange={(event) => onSearchChange(event.target.value)}
          />
        </label>
        {queryChips.length > 0 && (
          <div className="mt-2 flex flex-wrap items-center gap-1.5" aria-label={t("skillList.filtersAria")}>
            {queryChips.map((chip) => (
              <button
                key={chip.key}
                type="button"
                className="inline-flex items-center gap-1 rounded-full bg-hover px-2 py-0.5 text-[11px] text-ink-2 hover:bg-black/8"
                title={t("common.removeFilter")}
                onClick={() => onRemoveQueryChip?.(chip)}
              >
                <span>{chip.label}</span>
                <span aria-hidden="true">×</span>
              </button>
            ))}
            {onClearQuery && (
              <button
                type="button"
                className="macos-link text-[11px]"
                onClick={onClearQuery}
              >
                {t("common.clearFilters")}
              </button>
            )}
          </div>
        )}
        {selectionActive && (
          <div className="mt-3 flex flex-col gap-1.5">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-[11px] text-ink-2">
                {t("common.selectedCount", { count: selectedSelectableIds.length })}
              </span>
              <button
                type="button"
                className="macos-btn-ghost macos-btn-sm"
                disabled={batchBusy || selectableIds.length === 0}
                title={t("skillList.selectAllTitle")}
                onClick={() => onSetSelection(selectableIds)}
              >
                {t("common.selectAll")}
              </button>
              <button
                type="button"
                className="macos-btn-ghost macos-btn-sm"
                disabled={batchBusy || selectableIds.length === 0}
                title={t("skillList.invertTitle")}
                onClick={() => onInvertSelection(selectableIds)}
              >
                {t("common.invertSelection")}
              </button>
              {selectedSelectableIds.length > 0 ? (
                <button
                  type="button"
                  className="macos-btn-ghost macos-btn-sm"
                  disabled={batchBusy}
                  onClick={onClearSelection}
                >
                  {t("common.clearSelection")}
                </button>
              ) : null}
            </div>
            {selectedSelectableIds.length > 0 ? (
              <div className="flex flex-wrap gap-1.5">
                <button type="button" className="macos-btn-ghost macos-btn-sm" disabled={batchBusy} onClick={() => onBatchPause(selectedSelectableIds)}>{t("skillList.pause")}</button>
                <button type="button" className="macos-btn-ghost macos-btn-sm" disabled={batchBusy} onClick={() => onBatchResume(selectedSelectableIds)}>{t("skillList.resume")}</button>
                <button type="button" className="macos-btn-ghost macos-btn-sm" disabled={batchBusy} onClick={() => onBatchBackup(selectedSelectableIds)}>{t("skillList.backup")}</button>
                <button type="button" className="macos-btn-ghost macos-btn-sm" disabled={batchBusy} onClick={() => setMigrateOpen(true)}>{t("skillList.migrate")}</button>
                <button type="button" className="macos-btn-danger-soft macos-btn-sm" disabled={batchBusy} onClick={() => setDeleteOpen(true)}>{t("skillList.delete")}</button>
              </div>
            ) : null}
          </div>
        )}
        {batchResult && (
          <div className="macos-alert-ok mt-2 flex items-start justify-between gap-2 py-1.5 text-[11px]">
            <span>{formatBatchSummary(batchResult)}</span>
            <button type="button" className="macos-link shrink-0" onClick={onClearBatchResult}>
              {t("common.close")}
            </button>
          </div>
        )}
        {batchError && (
          <div className="macos-alert-error mt-2 flex items-start justify-between gap-2 py-1.5 text-[11px]">
            <span>{batchError.message}</span>
            <button type="button" className="macos-link shrink-0" onClick={onClearBatchResult}>
              {t("common.close")}
            </button>
          </div>
        )}
      </header>
      <ConfirmDialog
        open={migrateOpen}
        title={t("skillList.migrateTitle", { count: selectedSelectableIds.length })}
        message={t("skillList.migrateMessage")}
        confirmLabel={t("skillList.migrateConfirm")}
        busy={batchBusy}
        onCancel={() => setMigrateOpen(false)}
        onConfirm={() => {
          onBatchMigrate(selectedSelectableIds, replaceWithLink);
          setMigrateOpen(false);
        }}
      >
        <label className="flex items-center gap-2 text-[12px] text-ink-2">
          <input
            type="checkbox"
            checked={replaceWithLink}
            onChange={(event) => setReplaceWithLink(event.target.checked)}
          />
          {t("skillList.replaceWithLibraryLink")}
        </label>
      </ConfirmDialog>
      <ConfirmDialog
        open={deleteOpen}
        title={deleteTitle}
        message={deleteMessage}
        confirmLabel={deleteConfirmLabel}
        tone="danger"
        busy={batchBusy}
        onCancel={() => setDeleteOpen(false)}
        onConfirm={() => {
          onBatchDelete(selectedSelectableIds);
          setDeleteOpen(false);
        }}
      />
      {warnings.length > 0 && (
        <aside
          className="macos-alert-warn mx-3 mt-3 max-h-32 shrink-0 overflow-auto"
          aria-label={t("skillList.scanWarningAria")}
        >
          <strong>{t("skillList.partialScan")}</strong>
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
