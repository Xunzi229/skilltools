import { useEffect, useRef, useState } from "react";
import { TagColorPicker } from "./TagColorPicker";

interface NameDialogProps {
  open: boolean;
  title: string;
  initialValue?: string;
  initialColor?: string | null;
  showColorPicker?: boolean;
  confirmLabel: string;
  busy?: boolean;
  onConfirm: (name: string, color?: string | null) => void;
  onCancel: () => void;
}

export function NameDialog({
  open,
  title,
  initialValue = "",
  initialColor = null,
  showColorPicker = false,
  confirmLabel,
  busy = false,
  onConfirm,
  onCancel,
}: NameDialogProps) {
  const [value, setValue] = useState(initialValue);
  const [color, setColor] = useState<string | null>(initialColor);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    setValue(initialValue);
    setColor(initialColor);
    window.setTimeout(() => inputRef.current?.select(), 0);
  }, [initialColor, initialValue, open]);

  if (!open) return null;

  const trimmed = value.trim();
  const submit = () => {
    if (!trimmed || busy) return;
    if (showColorPicker) onConfirm(trimmed, color);
    else onConfirm(trimmed);
  };

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/35 p-4">
      <form
        className="w-full max-w-sm rounded-xl border border-line bg-panel p-5 shadow-xl"
        role="dialog"
        aria-modal="true"
        aria-labelledby="name-dialog-title"
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <h2 id="name-dialog-title" className="m-0 text-[16px] font-semibold text-ink">
          {title}
        </h2>
        <label className="mt-3 block">
          <span className="sr-only">名称</span>
          <input
            ref={inputRef}
            className="h-10 w-full rounded-lg border border-line bg-panel px-3 text-[13px] text-ink outline-none focus:border-brand"
            value={value}
            disabled={busy}
            autoFocus
            onChange={(event) => setValue(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape" && !busy) onCancel();
            }}
          />
        </label>
        {showColorPicker ? (
          <TagColorPicker value={color} onChange={setColor} disabled={busy} />
        ) : null}
        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            className="rounded-lg border border-line px-3 py-1.5 text-[13px] text-ink hover:bg-hover disabled:opacity-55"
            disabled={busy}
            onClick={onCancel}
          >
            取消
          </button>
          <button
            type="submit"
            className="rounded-lg bg-brand px-3 py-1.5 text-[13px] text-white hover:bg-blue-700 disabled:opacity-55"
            disabled={busy || !trimmed}
          >
            {busy ? "处理中…" : confirmLabel}
          </button>
        </div>
      </form>
    </div>
  );
}
