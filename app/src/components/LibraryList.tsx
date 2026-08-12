import { useEffect, useMemo, useState } from "react";
import type { SkillApi } from "../api/skillApi";
import type {
  AiTaxonomyApplyItem,
  BatchResult,
  CommandError,
  LibrarySkillSummary,
  Provider,
  SkillGroup,
  Tag,
} from "../model/skill";
import { formatBatchSummary } from "../hooks/useBatchActions";
import {
  rowCheckboxClass,
  useSelectionMode,
} from "../hooks/useSelectionMode";
import type { TaxonomyChip } from "../model/taxonomy";
import { displayDescription, matchesLibrarySkillSearch } from "../utils/skillDisplay";
import { AiGroupButton } from "./AiGroupButton";
import { NameDialog } from "./NameDialog";
import { PanelToggle } from "./PanelToggle";
import { SelectionModeButton } from "./SelectionModeButton";
import { SkillCard } from "./SkillCard";

type StatusTab = "all" | "uninstalled" | "installed" | "custom";

interface LibraryListProps {
  api: SkillApi;
  title: string;
  skills: LibrarySkillSummary[];
  groups: SkillGroup[];
  tags: Tag[];
  queryChips?: TaxonomyChip[];
  selectedId: string | null;
  selectedIds: Set<string>;
  search: string;
  loading: boolean;
  errorMessage: string | null;
  batchBusy: boolean;
  batchResult: BatchResult | null;
  batchError: CommandError | null;
  collapsed?: boolean;
  onToggleCollapse?: () => void;
  onSearchChange: (value: string) => void;
  onSelect: (id: string) => void;
  onToggleSelect: (id: string) => void;
  onSetSelection: (ids: string[]) => void;
  onInvertSelection: (ids: string[]) => void;
  onClearSelection: () => void;
  onRemoveQueryChip?: (chip: TaxonomyChip) => void;
  onClearQuery?: () => void;
  onBatchInstall: (ids: string[], provider: Provider) => void;
  onBatchUninstall: (ids: string[], provider: Provider) => void;
  onBatchSetGroup: (ids: string[], groupId: string | null) => void;
  onBatchAddTag: (ids: string[], tagId: string) => void;
  onBatchRemoveTag: (ids: string[], tagId: string) => void;
  onBatchClearTags: (ids: string[]) => void;
  onApplyAiGroups: (items: AiTaxonomyApplyItem[]) => Promise<void>;
  onCreateSkill: (name: string) => Promise<void>;
  onRetry: () => void;
  onClearBatchResult: () => void;
  onGoToProjects?: () => void;
}

export function LibraryList({
  api,
  title,
  skills,
  groups,
  tags,
  queryChips = [],
  selectedId,
  selectedIds,
  search,
  loading,
  errorMessage,
  batchBusy,
  batchResult,
  batchError,
  collapsed: panelCollapsed = false,
  onToggleCollapse,
  onSearchChange,
  onSelect,
  onToggleSelect,
  onSetSelection,
  onInvertSelection,
  onClearSelection,
  onRemoveQueryChip,
  onClearQuery,
  onBatchInstall,
  onBatchUninstall,
  onBatchSetGroup,
  onBatchAddTag,
  onBatchRemoveTag,
  onBatchClearTags,
  onApplyAiGroups,
  onCreateSkill,
  onRetry,
  onClearBatchResult,
  onGoToProjects,
}: LibraryListProps) {
  const [statusTab, setStatusTab] = useState<StatusTab>("all");
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const [createOpen, setCreateOpen] = useState(false);
  const [createBusy, setCreateBusy] = useState(false);
  const { selectionActive, toggleSelectionMode } = useSelectionMode(
    selectedIds.size,
    onClearSelection,
  );

  const filtered = useMemo(() => {
    return skills.filter((skill) => {
      if (statusTab === "installed") return skill.installedProviders.length > 0;
      if (statusTab === "uninstalled") return skill.installedProviders.length === 0;
      if (statusTab === "custom") {
        return skill.groupId !== null || skill.tagIds.length > 0;
      }
      return true;
    });
  }, [skills, statusTab]);

  const childrenByParent = useMemo(() => {
    const map = new Map<string, LibrarySkillSummary[]>();
    for (const skill of filtered) {
      if (!skill.parentSkillId) continue;
      const list = map.get(skill.parentSkillId) ?? [];
      list.push(skill);
      map.set(skill.parentSkillId, list);
    }
    for (const list of map.values()) {
      list.sort((left, right) => left.name.localeCompare(right.name, "zh-CN"));
    }
    return map;
  }, [filtered]);

  const parents = useMemo(
    () =>
      filtered
        .filter((skill) => !skill.parentSkillId)
        .sort((left, right) => left.name.localeCompare(right.name, "zh-CN")),
    [filtered],
  );

  const counts = useMemo(() => {
    const installed = skills.filter((skill) => skill.installedProviders.length > 0);
    const uninstalled = skills.filter((skill) => skill.installedProviders.length === 0);
    const custom = skills.filter(
      (skill) => skill.groupId !== null || skill.tagIds.length > 0,
    );
    return {
      all: skills.length,
      uninstalled: uninstalled.length,
      installed: installed.length,
      custom: custom.length,
    };
  }, [skills]);

  const searchTaxonomy = useMemo(
    () => ({ groups, tags }),
    [groups, tags],
  );

  // 搜索时自动展开匹配到子 Skill 的父节点
  useEffect(() => {
    if (!search.trim()) return;
    const parentsToExpand = filtered
      .filter(
        (skill) =>
          skill.parentSkillId &&
          matchesLibrarySkillSearch(skill, search, searchTaxonomy),
      )
      .map((skill) => skill.parentSkillId as string);
    if (parentsToExpand.length === 0) return;
    setCollapsed((current) => {
      const next = new Set(current);
      let changed = false;
      for (const parentId of parentsToExpand) {
        if (next.delete(parentId)) changed = true;
      }
      return changed ? next : current;
    });
  }, [filtered, search, searchTaxonomy]);

  const visible = useMemo(() => {
    const ordered: LibrarySkillSummary[] = [];
    const parentIds = new Set(parents.map((parent) => parent.id));
    for (const parent of parents) {
      ordered.push(parent);
      if (collapsed.has(parent.id)) continue;
      ordered.push(...(childrenByParent.get(parent.id) ?? []));
    }
    // 父节点被当前 Tab 过滤掉时，仍展示孤儿子 Skill
    for (const skill of filtered) {
      if (
        skill.parentSkillId &&
        !parentIds.has(skill.parentSkillId) &&
        !ordered.some((item) => item.id === skill.id)
      ) {
        ordered.push(skill);
      }
    }
    return ordered;
  }, [childrenByParent, collapsed, filtered, parents]);

  const selectableIds = useMemo(() => visible.map((skill) => skill.id), [visible]);
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

  const tabs: Array<{ id: StatusTab; label: string }> = [
    { id: "all", label: "全部" },
    { id: "uninstalled", label: "未安装" },
    { id: "installed", label: "已安装" },
    { id: "custom", label: "自定义" },
  ];

  const toggleParent = (parentId: string) => {
    setCollapsed((current) => {
      const next = new Set(current);
      if (next.has(parentId)) {
        next.delete(parentId);
      } else {
        next.add(parentId);
      }
      return next;
    });
  };

  if (panelCollapsed) {
    return (
      <section
        className="flex h-full min-h-0 w-full min-w-0 flex-col items-center gap-3 overflow-hidden border-r border-line-strong bg-panel px-1.5 py-4"
        aria-label="库 Skill 列表（已折叠）"
      >
        <PanelToggle
          expanded={false}
          labelExpand="展开列表"
          labelCollapse="折叠列表"
          onToggle={onToggleCollapse}
        />
        <span
          className="mt-2 text-[11px] font-medium text-ink-3"
          style={{ writingMode: "vertical-rl" }}
        >
          {title}
        </span>
      </section>
    );
  }

  return (
    <section
      className="flex h-full min-h-0 w-full min-w-0 flex-col overflow-hidden border-r border-line-strong bg-panel"
      aria-label="库 Skill 列表"
    >
      <header className="shrink-0 border-b border-line-strong px-4 pt-5 pb-3">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <h2 className="m-0 text-[17px] font-semibold tracking-tight text-ink">{title}</h2>
            <p className="mt-1 text-[12px] text-ink-2">浏览和管理可用的 Skills</p>
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            <SelectionModeButton
              selectionActive={selectionActive}
              disabled={batchBusy}
              onToggle={toggleSelectionMode}
            />
            <button
              type="button"
              className="macos-btn-primary"
              disabled={batchBusy || createBusy}
              onClick={() => setCreateOpen(true)}
            >
              新建
            </button>
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
            aria-label="搜索库 Skill"
            placeholder="搜索名称、描述、来源、分组或标签"
            value={search}
            onChange={(event) => onSearchChange(event.target.value)}
          />
        </label>
        {queryChips.length > 0 && (
          <div className="mt-2 flex flex-wrap items-center gap-1.5" aria-label="当前筛选条件">
            {queryChips.map((chip) => (
              <button
                key={chip.key}
                type="button"
                className="inline-flex items-center gap-1 rounded-full bg-hover px-2 py-0.5 text-[11px] text-ink-2 hover:bg-black/8"
                title="移除该条件"
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
                清除筛选
              </button>
            )}
          </div>
        )}
        <div
          className="macos-seg mt-3 w-full"
          role="tablist"
          aria-label="安装状态过滤"
        >
          {tabs.map((tab) => {
            const active = statusTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                role="tab"
                aria-selected={active}
                className="macos-seg-item"
                onClick={() => setStatusTab(tab.id)}
              >
                {tab.label}
                <span className="macos-badge">{counts[tab.id]}</span>
              </button>
            );
          })}
        </div>
        {selectionActive && (
          <div className="library-batch mt-3">
            <section className="library-batch-block" aria-label="选择">
              <div className="library-batch-actions">
                <span className="library-batch-count">
                  已选 {selectedSelectableIds.length} 项
                </span>
                <button
                  type="button"
                  className="macos-btn-ghost"
                  disabled={batchBusy || selectableIds.length === 0}
                  title="选中当前列表中的全部 Skill"
                  onClick={() => onSetSelection(selectableIds)}
                >
                  全选
                </button>
                <button
                  type="button"
                  className="macos-btn-ghost"
                  disabled={batchBusy || selectableIds.length === 0}
                  title="反转当前列表中的勾选状态"
                  onClick={() => onInvertSelection(selectableIds)}
                >
                  反选
                </button>
                {selectedSelectableIds.length > 0 ? (
                  <button
                    type="button"
                    className="macos-btn-ghost"
                    disabled={batchBusy}
                    onClick={onClearSelection}
                  >
                    清除
                  </button>
                ) : null}
              </div>
            </section>
            {selectedSelectableIds.length > 0 ? (
              <>
                <section className="library-batch-block" aria-label="安装">
                  <div className="library-batch-actions">
                    {(["cursor", "claude", "codex"] as const).map((provider) => (
                      <button
                        key={`install-${provider}`}
                        type="button"
                        className="macos-btn-ghost"
                        disabled={batchBusy}
                        onClick={() => onBatchInstall(selectedSelectableIds, provider)}
                      >
                        安装 {provider}
                      </button>
                    ))}
                    {(["cursor", "claude", "codex"] as const).map((provider) => (
                      <button
                        key={`uninstall-${provider}`}
                        type="button"
                        className="macos-btn-ghost"
                        disabled={batchBusy}
                        onClick={() => onBatchUninstall(selectedSelectableIds, provider)}
                      >
                        卸载 {provider}
                      </button>
                    ))}
                  </div>
                </section>
                <section className="library-batch-block" aria-label="分组">
                  <div className="library-batch-actions">
                    <select
                      className="macos-select"
                      aria-label="批量设置分组"
                      disabled={batchBusy}
                      defaultValue=""
                      onChange={(event) => {
                        const value = event.target.value;
                        onBatchSetGroup(
                          selectedSelectableIds,
                          value === "" ? null : value === "__none__" ? null : value,
                        );
                        event.target.value = "";
                      }}
                    >
                      <option value="">设置分组…</option>
                      <option value="__none__">未分组</option>
                      {[...groups]
                        .sort((a, b) => a.order - b.order)
                        .map((group) => (
                          <option key={group.id} value={group.id}>
                            {group.name}
                          </option>
                        ))}
                    </select>
                    <AiGroupButton
                      api={api}
                      skills={skills}
                      groups={groups}
                      tags={tags}
                      selectedIds={selectedSelectableSet}
                      disabled={batchBusy}
                      onApply={onApplyAiGroups}
                    />
                    <select
                      className="macos-select"
                      aria-label="批量追加标签"
                      disabled={batchBusy || tags.length === 0}
                      defaultValue=""
                      onChange={(event) => {
                        if (event.target.value) {
                          onBatchAddTag(selectedSelectableIds, event.target.value);
                        }
                        event.target.value = "";
                      }}
                    >
                      <option value="">追加标签…</option>
                      {tags.map((tag) => (
                        <option key={tag.id} value={tag.id}>
                          {tag.name}
                        </option>
                      ))}
                    </select>
                    <select
                      className="macos-select"
                      aria-label="批量移除标签"
                      disabled={batchBusy || tags.length === 0}
                      defaultValue=""
                      onChange={(event) => {
                        if (event.target.value) {
                          onBatchRemoveTag(selectedSelectableIds, event.target.value);
                        }
                        event.target.value = "";
                      }}
                    >
                      <option value="">移除标签…</option>
                      {tags.map((tag) => (
                        <option key={tag.id} value={tag.id}>
                          {tag.name}
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      className="macos-btn-ghost"
                      disabled={batchBusy}
                      onClick={() => onBatchClearTags(selectedSelectableIds)}
                    >
                      清空标签
                    </button>
                  </div>
                </section>
              </>
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
        {batchError && (
          <div className="macos-alert-error mt-2 flex items-start justify-between gap-2 py-1.5 text-[11px]">
            <span>{batchError.message}</span>
            <button type="button" className="macos-link shrink-0" onClick={onClearBatchResult}>
              关闭
            </button>
          </div>
        )}
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-2 py-2">
        {loading ? (
          <div className="px-3 py-8 text-center text-[13px] text-ink-3">正在加载 Skill 库…</div>
        ) : errorMessage ? (
          <div className="px-3 py-8 text-center text-[13px]" role="alert">
            <strong className="macos-alert-error block">{errorMessage}</strong>
            <button
              type="button"
              className="macos-btn-primary mt-3"
              onClick={onRetry}
            >
              重试
            </button>
          </div>
        ) : visible.length === 0 ? (
          <div className="px-3 py-8 text-center text-[13px] text-ink-3">
            <strong className="block text-ink">暂无库 Skill</strong>
            <span className="block">
              {skills.length === 0
                ? "请添加包含 SKILL.md 的项目。"
                : "没有符合当前过滤条件的 Skill。"}
            </span>
            {skills.length === 0 && onGoToProjects && (
              <button
                type="button"
                className="macos-btn-primary mt-3"
                onClick={onGoToProjects}
              >
                去项目管理
              </button>
            )}
          </div>
        ) : (
          <ul className="m-0 flex list-none flex-col gap-0.5 p-0">
            {visible.map((skill) => {
              const childCount = childrenByParent.get(skill.id)?.length ?? 0;
              const expandable = childCount > 0;
              const expanded = expandable && !collapsed.has(skill.id);
              return (
                <li key={skill.id} className="group flex items-center gap-1.5">
                  <input
                    type="checkbox"
                    className={rowCheckboxClass(selectionActive)}
                    checked={selectedSelectableSet.has(skill.id)}
                    tabIndex={selectionActive ? 0 : -1}
                    aria-label={`选择 ${skill.name}`}
                    onChange={() => onToggleSelect(skill.id)}
                  />
                  <div className="min-w-0 flex-1">
                    <SkillCard
                      name={skill.name}
                      description={displayDescription(skill.description, 96)}
                      statusLabel={
                        skill.installedProviders.length > 0 ? "已安装" : "未安装"
                      }
                      selected={selectedId === skill.id}
                      onSelect={() => onSelect(skill.id)}
                      onToggleExpand={
                        expandable ? () => toggleParent(skill.id) : undefined
                      }
                      subSkill={skill.parentSkillId !== null}
                      indent={skill.parentSkillId !== null}
                      expandable={expandable}
                      expanded={expanded}
                      childCount={childCount}
                      groupLabel={
                        groups.find((group) => group.id === skill.groupId)?.name ?? null
                      }
                      tagLabels={skill.tagIds
                        .map((id) => tags.find((tag) => tag.id === id)?.name)
                        .filter((name): name is string => Boolean(name))}
                    />
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
      <NameDialog
        open={createOpen}
        title="新建库 Skill"
        confirmLabel="创建"
        busy={createBusy}
        onCancel={() => setCreateOpen(false)}
        onConfirm={(name) => {
          setCreateBusy(true);
          void onCreateSkill(name)
            .then(() => setCreateOpen(false))
            .finally(() => setCreateBusy(false));
        }}
      />
    </section>
  );
}
