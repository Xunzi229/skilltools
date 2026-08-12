import { useI18n } from "../i18n";

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
  const { t } = useI18n();
  return (
    <button
      type="button"
      className="macos-btn-ghost macos-btn-sm"
      aria-pressed={selectionActive}
      disabled={disabled}
      onClick={onToggle}
    >
      {selectionActive ? t("selection.done") : t("selection.select")}
    </button>
  );
}
