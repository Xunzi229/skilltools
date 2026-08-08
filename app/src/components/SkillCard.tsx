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
}: SkillCardProps) {
  const hasMeta = Boolean(groupLabel) || tagLabels.length > 0;

  return (
    <button
      type="button"
      className={[
        "flex min-h-20 w-full flex-col justify-center gap-1 rounded-lg border py-2.5 text-left transition-colors",
        indent ? "pl-7 pr-3.5" : "px-3.5",
        selected
          ? "border-brand bg-brand/5"
          : "border-transparent hover:bg-hover",
      ].join(" ")}
      aria-pressed={selected}
      aria-expanded={expandable ? expanded : undefined}
      aria-label={
        expandable
          ? `${expanded ? "收起" : "展开"} ${name} 的子 Skill`
          : undefined
      }
      onClick={onSelect}
    >
      <span className="flex items-center justify-between gap-3">
        <span className="flex min-w-0 items-center gap-2">
          {expandable && (
            <span className="w-3 shrink-0 text-[12px] text-ink-3" aria-hidden="true">
              {expanded ? "▾" : "▸"}
            </span>
          )}
          {subSkill && (
            <span className="shrink-0 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-ink-2">
              子 Skill
            </span>
          )}
          <strong className="truncate text-[14px] font-semibold text-ink">{name}</strong>
          {expandable && childCount > 0 && (
            <span className="shrink-0 text-[11px] text-ink-3">{childCount}</span>
          )}
        </span>
        <span className="shrink-0 text-[12px] text-ink-3">{statusLabel}</span>
      </span>
      {hasMeta && (
        <span className="flex min-w-0 flex-wrap items-center gap-1">
          {groupLabel && (
            <span className="max-w-[120px] truncate rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-ink-2">
              {groupLabel}
            </span>
          )}
          {tagLabels.slice(0, 3).map((tag) => (
            <span
              key={tag}
              className="max-w-[100px] truncate rounded bg-brand/10 px-1.5 py-0.5 text-[10px] font-medium text-brand"
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
    </button>
  );
}
