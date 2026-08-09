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
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/30 p-4 backdrop-blur-[2px]">
      <form
        className="macos-sheet w-full max-w-sm p-5"
        role="dialog"
        aria-modal="true"
        aria-labelledby="name-dialog-title"
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <h2
          id="name-dialog-title"
          className="m-0 text-center text-[15px] font-semibold tracking-tight text-ink"
        >
          {title}
        </h2>
        <label className="mt-4 block">
          <span className="sr-only">名称</span>
          <input
            ref={inputRef}
            className="macos-input h-10 w-full"
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
            className="macos-btn-ghost h-8 px-3.5 text-[13px]"
            disabled={busy}
            onClick={onCancel}
          >
            取消
          </button>
          <button
            type="submit"
            className="macos-btn-primary h-8 px-3.5 text-[13px]"
            disabled={busy || !trimmed}
          >
            {busy ? "处理中…" : confirmLabel}
          </button>
        </div>
      </form>
    </div>
  );
}
