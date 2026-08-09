const PRESET_COLORS = [
  "#315fb5",
  "#0f766e",
  "#b45309",
  "#be123c",
  "#7c3aed",
  "#15803d",
  "#0369a1",
  "#c2410c",
];

interface TagColorPickerProps {
  value: string | null;
  onChange: (color: string | null) => void;
  disabled?: boolean;
}

export function TagColorPicker({ value, onChange, disabled }: TagColorPickerProps) {
  return (
    <div className="mt-3 flex flex-wrap items-center gap-2" role="group" aria-label="标签颜色">
      <button
        type="button"
        className={[
          "h-6 rounded border px-2 text-[11px]",
          value === null
            ? "border-brand bg-brand/10 text-brand"
            : "border-line text-ink-2 hover:bg-hover",
        ].join(" ")}
        disabled={disabled}
        onClick={() => onChange(null)}
      >
        无色
      </button>
      {PRESET_COLORS.map((color) => (
        <button
          key={color}
          type="button"
          aria-label={`颜色 ${color}`}
          className={[
            "h-6 w-6 rounded-full border-2",
            value === color ? "border-ink" : "border-transparent",
          ].join(" ")}
          style={{ backgroundColor: color }}
          disabled={disabled}
          onClick={() => onChange(color)}
        />
      ))}
    </div>
  );
}

export function TagColorDot({ color }: { color: string | null | undefined }) {
  if (!color) {
    return (
      <span
        className="inline-block h-2.5 w-2.5 rounded-full border border-white/30 bg-white/20"
        aria-hidden
      />
    );
  }
  return (
    <span
      className="inline-block h-2.5 w-2.5 rounded-full"
      style={{ backgroundColor: color }}
      aria-hidden
    />
  );
}
