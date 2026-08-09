interface SelectionModeButtonProps {
  selectionActive: boolean;
  disabled?: boolean;
  onToggle: () => void;
}

export function SelectionModeButton({
  selectionActive,
  disabled,
  onToggle,
}: SelectionModeButtonProps) {
  return (
    <button
      type="button"
      className="macos-btn-ghost macos-btn-sm"
      aria-pressed={selectionActive}
      disabled={disabled}
      onClick={onToggle}
    >
      {selectionActive ? "完成" : "选择"}
    </button>
  );
}
