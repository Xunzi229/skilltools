import { useEffect, useMemo, useState } from "react";
import type {
  BatchResult,
  LibrarySkillSummary,
  Provider,
  SkillGroup,
  Tag,
} from "../model/skill";
import { formatBatchSummary } from "../hooks/useBatchActions";
import { displayDescription } from "../utils/skillDisplay";
import { NameDialog } from "./NameDialog";
import { SkillCard } from "./SkillCard";

type StatusTab = "all" | "uninstalled" | "installed" | "custom";

interface LibraryListProps {
  title: string;
  skills: LibrarySkillSummary[];
  groups: SkillGroup[];
  tags: Tag[];
  selectedId: string | null;
  selectedIds: Set<string>;
  search: string;
  loading: boolean;
  errorMessage: string | null;
  batchBusy: boolean;
  batchResult: BatchResult | null;
  collapsed?: boolean;
  onToggleCollapse?: () => void;
  onSearchChange: (value: string) => void;
  onSelect: (id: string) => void;
  onToggleSelect: (id: string) => void;
  onClearSelection: () => void;
  onBatchInstall: (provider: Provider) => void;
  onBatchUninstall: (provider: Provider) => void;
  onBatchSetGroup: (groupId: string | null) => void;
  onBatchAddTag: (tagId: string) => void;
  onCreateSkill: (name: string) => Promise<void>;
  onRetry: () => void;
  onClearBatchResult: () => void;
  onGoToProjects?: () => void;
}

export function LibraryList({
  title,
  skills,
  groups,
  tags,
  selectedId,
  selectedIds,
  search,
  loading,
  errorMessage,
  batchBusy,
  batchResult,
  collapsed: panelCollapsed = false,
  onToggleCollapse,
  onSearchChange,
  onSelect,
  onToggleSelect,
  onClearSelection,
  onBatchInstall,
  onBatchUninstall,
  onBatchSetGroup,
  onBatchAddTag,
  onCreateSkill,
  onRetry,
  onClearBatchResult,
  onGoToProjects,
}: LibraryListProps) {
  const [statusTab, setStatusTab] = useState<StatusTab>("all");
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const [createOpen, setCreateOpen] = useState(false);
  const [createBusy, setCreateBusy] = useState(false);

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

  // 搜索时自动展开匹配到子 Skill 的父节点
  useEffect(() => {
    const query = search.trim().toLocaleLowerCase();
    if (!query) return;
    const parentsToExpand = filtered
      .filter(
        (skill) =>
          skill.parentSkillId &&
          (skill.name.toLocaleLowerCase().includes(query) ||
            skill.description.toLocaleLowerCase().includes(query)),
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
  }, [filtered, search]);

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
        <button
          type="button"
          className="rounded-md border border-line px-2 py-1.5 text-[11px] text-ink-2 hover:bg-hover"
          aria-expanded={false}
          aria-label="展开列表"
          title="展开列表"
          onClick={onToggleCollapse}
        >
          »»
        </button>
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
            <h2 className="m-0 text-[18px] font-semibold text-ink">{title}</h2>
            <p className="mt-1 text-[12px] text-ink-2">浏览和管理可用的 Skills</p>
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            <button
              type="button"
              className="rounded-lg border border-line px-2.5 py-1 text-[12px] hover:bg-hover disabled:opacity-55"
              disabled={batchBusy || createBusy}
              onClick={() => setCreateOpen(true)}
            >
              新建
            </button>
            {onToggleCollapse && (
              <button
                type="button"
                className="rounded-md border border-line px-2 py-1 text-[11px] text-ink-2 hover:bg-hover"
                aria-expanded={true}
                aria-label="折叠列表"
                title="折叠列表"
                onClick={onToggleCollapse}
              >
                ««
              </button>
            )}
          </div>
        </div>
        <label className="mt-3 flex h-[38px] items-center gap-2 rounded-lg border border-line bg-panel px-3">
          <span className="text-ink-3" aria-hidden="true">
            ⌕
          </span>
          <input
            type="search"
            className="w-full border-0 bg-transparent text-[13px] text-ink outline-none placeholder:text-ink-3"
            aria-label="搜索库 Skill"
            placeholder="搜索名称或描述"
            value={search}
            onChange={(event) => onSearchChange(event.target.value)}
          />
        </label>
        <div className="mt-3 flex flex-wrap gap-1.5" role="tablist" aria-label="安装状态过滤">
          {tabs.map((tab) => {
            const active = statusTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                role="tab"
                aria-selected={active}
                className={[
                  "inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[12px]",
                  active
                    ? "bg-brand/10 font-medium text-brand"
                    : "text-ink-2 hover:bg-hover",
                ].join(" ")}
                onClick={() => setStatusTab(tab.id)}
              >
                {tab.label}
                <span
                  className={[
                    "rounded-full px-1.5 py-px text-[10px] font-semibold",
                    active ? "bg-brand text-white" : "bg-slate-100 text-ink-3",
                  ].join(" ")}
                >
                  {counts[tab.id]}
                </span>
              </button>
            );
          })}
        </div>
        {selectedIds.size > 0 && (
          <div className="mt-3 flex flex-col gap-1.5">
            <span className="text-[11px] text-ink-2">已选 {selectedIds.size} 项</span>
            <div className="flex flex-wrap gap-1.5">
              {(["cursor", "claude", "codex"] as const).map((provider) => (
                <button
                  key={`install-${provider}`}
                  type="button"
                  className="rounded border border-line px-2 py-1 text-[11px] hover:bg-hover disabled:opacity-55"
                  disabled={batchBusy}
                  onClick={() => onBatchInstall(provider)}
                >
                  安装 {provider}
                </button>
              ))}
              {(["cursor", "claude", "codex"] as const).map((provider) => (
                <button
                  key={`uninstall-${provider}`}
                  type="button"
                  className="rounded border border-line px-2 py-1 text-[11px] hover:bg-hover disabled:opacity-55"
                  disabled={batchBusy}
                  onClick={() => onBatchUninstall(provider)}
                >
                  卸载 {provider}
                </button>
              ))}
            </div>
            <div className="flex flex-wrap gap-1.5">
              <select
                className="h-7 rounded border border-line px-1 text-[11px]"
                aria-label="批量设置分组"
                disabled={batchBusy}
                defaultValue=""
                onChange={(event) => {
                  const value = event.target.value;
                  onBatchSetGroup(value === "" ? null : value === "__none__" ? null : value);
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
              <select
                className="h-7 rounded border border-line px-1 text-[11px]"
                aria-label="批量追加标签"
                disabled={batchBusy || tags.length === 0}
                defaultValue=""
                onChange={(event) => {
                  if (event.target.value) onBatchAddTag(event.target.value);
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
              <button
                type="button"
                className="rounded border border-line px-2 py-1 text-[11px] hover:bg-hover"
                disabled={batchBusy}
                onClick={onClearSelection}
              >
                清除
              </button>
            </div>
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

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-2 py-2">
        {loading ? (
          <div className="px-3 py-8 text-center text-[13px] text-ink-3">正在加载 Skill 库…</div>
        ) : errorMessage ? (
          <div className="px-3 py-8 text-center text-[13px]" role="alert">
            <strong className="block text-red-600">{errorMessage}</strong>
            <button
              type="button"
              className="mt-3 rounded-md bg-brand px-3 py-1.5 text-white"
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
                className="mt-3 rounded-md bg-brand px-3 py-1.5 text-white"
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
                        skill.installedProviders.length > 0 ? "已安装" : "未安装"
                      }
                      selected={selectedId === skill.id}
                      onSelect={() => {
                        onSelect(skill.id);
                        if (expandable) {
                          toggleParent(skill.id);
                        }
                      }}
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
