import { useEffect, useId, useMemo, useRef, useState } from "react";
import {
  filterFontOptions,
  type PreviewFontOption,
} from "../utils/previewTypography";

interface FontFamilyPickerProps {
  value: string;
  options: readonly PreviewFontOption[];
  disabled?: boolean;
  onChange: (family: string) => void;
}

export function FontFamilyPicker({
  value,
  options,
  disabled = false,
  onChange,
}: FontFamilyPickerProps) {
  const listId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [highlight, setHighlight] = useState(0);

  const mergedOptions = useMemo(() => {
    if (!value || options.some((font) => font.family === value)) {
      return options;
    }
    return [{ label: value, family: value }, ...options];
  }, [options, value]);

  const filtered = useMemo(
    () => filterFontOptions(mergedOptions, open ? query : ""),
    [mergedOptions, open, query],
  );

  useEffect(() => {
    if (!open) return;
    setHighlight(0);
  }, [query, open]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
        setQuery("");
      }
    };
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [open]);

  const pick = (family: string) => {
    onChange(family);
    setOpen(false);
    setQuery("");
    inputRef.current?.blur();
  };

  return (
    <div ref={rootRef} className="relative min-w-[240px]">
      <input
        ref={inputRef}
        type="text"
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-label="字体类型"
        className="macos-input w-full min-w-[240px]"
        disabled={disabled}
        placeholder="搜索字体…"
        value={open ? query : value}
        style={{ fontFamily: `"${value}"` }}
        onFocus={() => {
          setOpen(true);
          setQuery("");
          setHighlight(0);
        }}
        onChange={(event) => {
          setOpen(true);
          setQuery(event.target.value);
        }}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            setOpen(false);
            setQuery("");
            inputRef.current?.blur();
            return;
          }
          if (!open && (event.key === "ArrowDown" || event.key === "Enter")) {
            setOpen(true);
            return;
          }
          if (event.key === "ArrowDown") {
            event.preventDefault();
            setHighlight((index) =>
              filtered.length === 0 ? 0 : Math.min(index + 1, filtered.length - 1),
            );
            return;
          }
          if (event.key === "ArrowUp") {
            event.preventDefault();
            setHighlight((index) => Math.max(index - 1, 0));
            return;
          }
          if (event.key === "Enter") {
            event.preventDefault();
            const selected = filtered[highlight];
            if (selected) pick(selected.family);
          }
        }}
      />
      {open && !disabled && (
        <ul
          id={listId}
          role="listbox"
          aria-label="字体搜索结果"
          className="absolute z-20 mt-1 max-h-56 w-full overflow-auto rounded-[8px] border border-line bg-panel py-1 shadow-sm"
        >
          {filtered.length === 0 ? (
            <li className="px-3 py-2 text-[12px] text-ink-3">无匹配字体</li>
          ) : (
            filtered.map((font, index) => (
              <li key={font.family} role="presentation">
                <button
                  type="button"
                  role="option"
                  aria-selected={font.family === value}
                  className={[
                    "flex w-full items-center px-3 py-1.5 text-left text-[13px]",
                    index === highlight ? "bg-hover text-ink" : "text-ink-2",
                    font.family === value ? "font-medium text-ink" : "",
                  ].join(" ")}
                  style={{ fontFamily: `"${font.family}"` }}
                  onMouseEnter={() => setHighlight(index)}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => pick(font.family)}
                >
                  {font.label}
                </button>
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  );
}
