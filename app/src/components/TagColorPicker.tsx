import { useI18n } from "../i18n";

/** macOS Reminders / Calendar 风格色板 */
export const APPLE_COLORS = [
  "#FF3B30", // Red
  "#FF9500", // Orange
  "#FFCC00", // Yellow
  "#34C759", // Green
  "#00C7BE", // Mint
  "#30B0C7", // Teal
  "#007AFF", // Blue
  "#5856D6", // Indigo
  "#AF52DE", // Purple
  "#FF2D55", // Pink
  "#A2845E", // Brown
  "#8E8E93", // Gray
] as const;

export const DEFAULT_APPLE_COLOR = APPLE_COLORS[6];

interface TagColorPickerProps {
  value: string | null;
  onChange: (color: string | null) => void;
  disabled?: boolean;
  label?: string;
}

export function TagColorPicker({
  value,
  onChange,
  disabled,
  label,
}: TagColorPickerProps) {
  const { t } = useI18n();
  const resolvedLabel = label ?? t("tagColor.label");
  return (
    <div className="mt-3" role="group" aria-label={resolvedLabel}>
      <div className="mb-2 text-[12px] font-medium text-ink-2">{resolvedLabel}</div>
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          className={[
            "macos-chip rounded-full",
            value === null ? "border-brand text-brand" : "",
          ].join(" ")}
          disabled={disabled}
          onClick={() => onChange(null)}
        >
          {t("tagColor.none")}
        </button>
        {APPLE_COLORS.map((color) => (
          <button
            key={color}
            type="button"
            aria-label={t("tagColor.colorAria", { color })}
            className={[
              "size-7 rounded-full border-[2.5px] shadow-sm transition-transform",
              value === color
                ? "scale-110 border-ink"
                : "border-transparent hover:scale-105",
            ].join(" ")}
            style={{ backgroundColor: color }}
            disabled={disabled}
            onClick={() => onChange(color)}
          />
        ))}
      </div>
    </div>
  );
}

/** 列表前彩色圆点（Reminders 风格） */
export function ListColorDot({
  color,
  size = "md",
}: {
  color: string | null | undefined;
  size?: "sm" | "md";
}) {
  const dim = size === "sm" ? "size-2.5" : "size-3.5";
  if (!color) {
    return (
      <span
        className={`${dim} inline-block shrink-0 rounded-full border border-black/15 bg-black/10 dark:border-white/25 dark:bg-white/20`}
        aria-hidden
      />
    );
  }
  return (
    <span
      className={`${dim} inline-block shrink-0 rounded-full shadow-[inset_0_0_0_1px_rgba(0,0,0,0.08)]`}
      style={{ backgroundColor: color }}
      aria-hidden
    />
  );
}

/** 兼容旧名 */
export const TagColorDot = ListColorDot;
