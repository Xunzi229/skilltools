import { useState } from "react";

/** 行首多选：工具栏「选择」或已有勾选时进入常显；「完成」退出并清空。 */
export function useSelectionMode(
  selectedCount: number,
  clearSelection: () => void,
) {
  const [selectionMode, setSelectionMode] = useState(false);
  const selectionActive = selectionMode || selectedCount > 0;

  const toggleSelectionMode = () => {
    if (selectionActive) {
      setSelectionMode(false);
      clearSelection();
    } else {
      setSelectionMode(true);
    }
  };

  return { selectionActive, toggleSelectionMode };
}

/** 默认占位隐藏，行悬停显示；selectionActive 时全部常显。li 需带 group。 */
export function rowCheckboxClass(selectionActive: boolean): string {
  return [
    "ml-1.5 size-3.5 shrink-0 accent-[var(--color-brand)] transition-opacity",
    selectionActive
      ? "opacity-100"
      : "pointer-events-none opacity-0 group-hover:pointer-events-auto group-hover:opacity-100 focus-visible:pointer-events-auto focus-visible:opacity-100",
  ].join(" ");
}
