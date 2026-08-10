interface SkillCardProps {
  name: string;
  description: string;
  statusLabel: string;
  selected: boolean;
  onSelect: () => void;
  subSkill?: boolean;
  indent?: boolean;
  expandable?: boolean;
  expanded?: boolean;
  childCount?: number;
  groupLabel?: string | null;
  tagLabels?: string[];
  /** 与选中分离：仅折叠/展开子节点 */
  onToggleExpand?: () => void;
}

export function SkillCard({
  name,
  description,
  statusLabel,
  selected,
  onSelect,
  subSkill = false,
  indent = false,
  expandable = false,
  expanded = true,
  childCount = 0,
  groupLabel = null,
  tagLabels = [],
  onToggleExpand,
}: SkillCardProps) {
  const hasMeta = Boolean(groupLabel) || tagLabels.length > 0;

  return (
    <div
      role="button"
      tabIndex={0}
      className={["macos-list-item", indent ? "macos-list-item-indent" : ""].join(" ")}
      aria-pressed={selected}
      data-selected={selected ? "true" : undefined}
      onClick={onSelect}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onSelect();
        }
      }}
    >
      <span className="flex items-center justify-between gap-3">
        <span className="flex min-w-0 items-center gap-2">
          {expandable && (
            <button
              type="button"
              className="grid size-6 shrink-0 place-items-center rounded-[6px] text-[14px] leading-none text-ink-3 hover:bg-black/6 hover:text-ink"
              aria-expanded={expanded}
              aria-label={`${expanded ? "收起" : "展开"} ${name} 的子 Skill`}
              onClick={(event) => {
                event.stopPropagation();
                onToggleExpand?.();
              }}
            >
              {expanded ? "▾" : "▸"}
            </button>
          )}
          {subSkill && (
            <span className="shrink-0 rounded-full bg-hover px-1.5 py-0.5 text-[10px] font-medium text-ink-2">
              子 Skill
            </span>
          )}
          <strong className="truncate text-[14px] font-semibold tracking-tight text-ink">
            {name}
          </strong>
          {expandable && childCount > 0 && (
            <span className="shrink-0 text-[11px] text-ink-3 tabular-nums">{childCount}</span>
          )}
        </span>
        <span className="shrink-0 rounded-full bg-hover px-2 py-0.5 text-[11px] font-medium text-ink-2">
          {statusLabel}
        </span>
      </span>
      {hasMeta && (
        <span className="flex min-w-0 flex-wrap items-center gap-1">
          {groupLabel && (
            <span className="max-w-[120px] truncate rounded-full bg-hover px-2 py-0.5 text-[10px] font-medium text-ink-2">
              {groupLabel}
            </span>
          )}
          {tagLabels.slice(0, 3).map((tag) => (
            <span
              key={tag}
              className="macos-tag"
            >
              {tag}
            </span>
          ))}
          {tagLabels.length > 3 && (
            <span className="text-[10px] text-ink-3">+{tagLabels.length - 3}</span>
          )}
        </span>
      )}
      <span className="line-clamp-2 text-[12px] leading-4 text-ink-2">
        {description || "暂无描述"}
      </span>
    </div>
  );
}
