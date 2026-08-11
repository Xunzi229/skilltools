import {
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { createPortal } from "react-dom";
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

const DROPDOWN_MAX_HEIGHT = 224; // max-h-56
const DROPDOWN_GAP = 4;
const VIEWPORT_PAD = 8;

export function FontFamilyPicker({
  value,
  options,
  disabled = false,
  onChange,
}: FontFamilyPickerProps) {
  const listId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [highlight, setHighlight] = useState(0);
  const [dropdownStyle, setDropdownStyle] = useState<CSSProperties>({});

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

  const updateDropdownPosition = () => {
    const input = inputRef.current;
    if (!input) return;
    const rect = input.getBoundingClientRect();
    const spaceBelow = window.innerHeight - rect.bottom - VIEWPORT_PAD;
    const spaceAbove = rect.top - VIEWPORT_PAD;
    const openUp = spaceBelow < 160 && spaceAbove > spaceBelow;
    const available = Math.max(openUp ? spaceAbove : spaceBelow, 96);
    const maxHeight = Math.min(DROPDOWN_MAX_HEIGHT, available);
    const left = Math.min(
      Math.max(VIEWPORT_PAD, rect.left),
      Math.max(VIEWPORT_PAD, window.innerWidth - VIEWPORT_PAD - rect.width),
    );

    if (openUp) {
      setDropdownStyle({
        position: "fixed",
        left,
        width: rect.width,
        bottom: window.innerHeight - rect.top + DROPDOWN_GAP,
        maxHeight,
        zIndex: 80,
      });
    } else {
      setDropdownStyle({
        position: "fixed",
        left,
        width: rect.width,
        top: rect.bottom + DROPDOWN_GAP,
        maxHeight,
        zIndex: 80,
      });
    }
  };

  useLayoutEffect(() => {
    if (!open || disabled) return;
    updateDropdownPosition();
    const onReposition = () => updateDropdownPosition();
    window.addEventListener("resize", onReposition);
    window.addEventListener("scroll", onReposition, true);
    return () => {
      window.removeEventListener("resize", onReposition);
      window.removeEventListener("scroll", onReposition, true);
    };
  }, [open, disabled, filtered.length]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as Node | null;
      if (
        (target && rootRef.current?.contains(target)) ||
        (target && listRef.current?.contains(target))
      ) {
        return;
      }
      setOpen(false);
      setQuery("");
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

  const dropdown =
    open && !disabled ? (
      <ul
        ref={listRef}
        id={listId}
        role="listbox"
        aria-label="字体搜索结果"
        className="overflow-auto rounded-[8px] border border-line bg-panel py-1 shadow-sm"
        style={dropdownStyle}
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
    ) : null;

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
      {dropdown ? createPortal(dropdown, document.body) : null}
    </div>
  );
}
