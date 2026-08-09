interface PanelToggleProps {
  expanded: boolean;
  labelExpand: string;
  labelCollapse: string;
  onToggle?: () => void;
  className?: string;
}

/** 侧栏/列表折叠按钮（macOS 风格轻量 chevron） */
export function PanelToggle({
  expanded,
  labelExpand,
  labelCollapse,
  onToggle,
  className = "",
}: PanelToggleProps) {
  return (
    <button
      type="button"
      className={["macos-icon-btn", className].join(" ")}
      aria-expanded={expanded}
      aria-label={expanded ? labelCollapse : labelExpand}
      title={expanded ? labelCollapse : labelExpand}
      onClick={onToggle}
    >
      <span aria-hidden="true">{expanded ? "‹" : "›"}</span>
    </button>
  );
}
