import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
} from "react";
import { useLocalStorageBool } from "../hooks/useLocalStorageBool";
import type { ExternalEditor, FileNode } from "../model/skill";

interface FileTreeProps {
  nodes: FileNode[];
  selectedPath: string | null;
  loading: boolean;
  errorMessage: string | null;
  editors?: ExternalEditor[];
  onSelect: (relativePath: string) => void;
  onOpenWith?: (relativePath: string, editorId: string) => void | Promise<void>;
}

interface ContextMenuState {
  x: number;
  y: number;
  relativePath: string;
}

function EditorIcon({ id }: { id: string }) {
  const common = "size-3.5 shrink-0";
  switch (id) {
    case "cursor":
      return (
        <svg className={common} viewBox="0 0 16 16" aria-hidden="true">
          <path fill="currentColor" d="M3 2.2 12.8 8 8.4 9.4 6.7 14.2 3 2.2Z" />
        </svg>
      );
    case "vscode":
    case "vscode-insiders":
      return (
        <svg className={`${common} text-[#007ACC]`} viewBox="0 0 16 16" aria-hidden="true">
          <path
            fill="currentColor"
            d="M11.7 1.4 6.9 5.6 3.6 3.2 2 4.1l3.5 3.9L2 11.9l1.6.9 3.3-2.4 4.8 4.2L14 13.4V2.6l-2.3-1.2Zm0 3.1v7l-3.5-3 1.1-.9-1.1-.9 3.5-2.2Z"
          />
        </svg>
      );
    case "idea":
    case "pycharm":
    case "goland":
    case "webstorm":
    case "clion":
    case "rider":
      return (
        <svg className={`${common} text-[#087CFA]`} viewBox="0 0 16 16" aria-hidden="true">
          <rect width="14" height="14" x="1" y="1" rx="2" fill="currentColor" />
          <path fill="#fff" d="M4 11.2h8v1.2H4v-1.2Zm1.2-7h1.5l2 5.2H7.3L6.9 8H5.1l-.4 1.4H3.3l2-5.2Zm1.3 3.2h1L7 5.2h-.1L6.5 7.4Z" />
        </svg>
      );
    case "notepad":
    case "notepadpp":
    case "notepad3":
      return (
        <svg className={common} viewBox="0 0 16 16" aria-hidden="true">
          <path
            fill="currentColor"
            d="M4 1.5h6.2L13 4.3V14a.5.5 0 0 1-.5.5h-8A.5.5 0 0 1 4 14V1.5Zm6 .7V5h2.7L10 2.2ZM5.5 7h5v1h-5V7Zm0 2.5h5v1h-5v-1Zm0 2.5h3.5v1H5.5v-1Z"
          />
        </svg>
      );
    case "sublime":
      return (
        <svg className={`${common} text-[#FF9800]`} viewBox="0 0 16 16" aria-hidden="true">
          <path fill="currentColor" d="M2 3.2 14 1.5v3.3L2 6.5V3.2Zm0 4.3 12-1.7v3.3L2 10.8V7.5Zm0 4.3 12-1.7v3.4L2 15v-3.2Z" />
        </svg>
      );
    case "reveal":
      return (
        <svg className={common} viewBox="0 0 16 16" aria-hidden="true">
          <path
            fill="currentColor"
            d="M1.5 4.5A1.5 1.5 0 0 1 3 3h3.1l1.2 1.2H13A1.5 1.5 0 0 1 14.5 5.7v6.8A1.5 1.5 0 0 1 13 14H3a1.5 1.5 0 0 1-1.5-1.5v-8Z"
          />
        </svg>
      );
    default:
      return (
        <svg className={common} viewBox="0 0 16 16" aria-hidden="true">
          <path
            fill="currentColor"
            d="M3.5 2.5h5.2L13 6.8v6.7a.5.5 0 0 1-.5.5h-9a.5.5 0 0 1-.5-.5v-11Zm5 .7V7h3.7L8.5 3.2Z"
          />
          <path fill="currentColor" d="M10.2 1.8h1.6v2.2H14v1.6h-2.2V8h-1.6V5.6H8V4h2.2V1.8Z" />
        </svg>
      );
  }
}

function TreeNodes({
  nodes,
  selectedPath,
  collapsed,
  onToggleDirectory,
  onSelect,
  onContextMenu,
  depth = 0,
}: Pick<FileTreeProps, "nodes" | "selectedPath" | "onSelect"> & {
  collapsed: Set<string>;
  onToggleDirectory: (relativePath: string) => void;
  onContextMenu: (event: ReactMouseEvent, relativePath: string) => void;
  depth?: number;
}) {
  return (
    <>
      {nodes.map((node) => {
        const isDirectory = node.kind === "directory";
        const isCollapsed = collapsed.has(node.relativePath);
        const hasChildren = node.children.length > 0;

        return (
          <li key={node.relativePath} role="treeitem">
            {isDirectory ? (
              <button
                type="button"
                className="flex w-full items-center gap-1.5 rounded px-1.5 py-1 text-left text-[12px] text-ink-2 hover:bg-hover"
                style={{ paddingLeft: `${8 + depth * 12}px` }}
                aria-expanded={hasChildren ? !isCollapsed : undefined}
                aria-label={`${isCollapsed ? "展开" : "收起"} ${node.name}`}
                onClick={() => onToggleDirectory(node.relativePath)}
              >
                <span className="w-3 shrink-0 text-ink-3" aria-hidden="true">
                  {hasChildren ? (isCollapsed ? "▸" : "▾") : "·"}
                </span>
                <span className="truncate font-medium text-ink">{node.name}</span>
              </button>
            ) : (
              <button
                type="button"
                className={[
                  "flex w-full items-center gap-1.5 rounded px-1.5 py-1 text-left text-[12px]",
                  selectedPath === node.relativePath
                    ? "bg-brand/10 text-brand"
                    : "text-ink-2 hover:bg-hover",
                ].join(" ")}
                style={{ paddingLeft: `${8 + depth * 12}px` }}
                aria-pressed={selectedPath === node.relativePath}
                onClick={() => onSelect(node.relativePath)}
                onContextMenu={(event) => onContextMenu(event, node.relativePath)}
              >
                <span className="w-3 shrink-0 text-ink-3" aria-hidden="true">
                  ◇
                </span>
                <span className="truncate">{node.name}</span>
              </button>
            )}
            {isDirectory && hasChildren && !isCollapsed && (
              <ul role="group" className="m-0 list-none p-0">
                <TreeNodes
                  nodes={node.children}
                  selectedPath={selectedPath}
                  collapsed={collapsed}
                  onToggleDirectory={onToggleDirectory}
                  onSelect={onSelect}
                  onContextMenu={onContextMenu}
                  depth={depth + 1}
                />
              </ul>
            )}
          </li>
        );
      })}
    </>
  );
}

export function FileTree({
  nodes,
  selectedPath,
  loading,
  errorMessage,
  editors = [],
  onSelect,
  onOpenWith,
}: FileTreeProps) {
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const [panelCollapsed, setPanelCollapsed] = useLocalStorageBool(
    "skilltools.ui.fileTreeCollapsed",
    false,
  );
  const [menu, setMenu] = useState<ContextMenuState | null>(null);
  const [openSubmenu, setOpenSubmenu] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const hideSubmenuTimer = useRef<number | null>(null);

  const openEditors = useMemo(
    () => editors.filter((editor) => editor.id !== "reveal"),
    [editors],
  );
  const revealEditor = useMemo(
    () => editors.find((editor) => editor.id === "reveal") ?? null,
    [editors],
  );

  const clearHideSubmenuTimer = () => {
    if (hideSubmenuTimer.current !== null) {
      window.clearTimeout(hideSubmenuTimer.current);
      hideSubmenuTimer.current = null;
    }
  };

  const showSubmenu = () => {
    clearHideSubmenuTimer();
    setOpenSubmenu(true);
  };

  const scheduleHideSubmenu = () => {
    clearHideSubmenuTimer();
    hideSubmenuTimer.current = window.setTimeout(() => {
      setOpenSubmenu(false);
      hideSubmenuTimer.current = null;
    }, 120);
  };

  const onToggleDirectory = (relativePath: string) => {
    setCollapsed((current) => {
      const next = new Set(current);
      if (next.has(relativePath)) {
        next.delete(relativePath);
      } else {
        next.add(relativePath);
      }
      return next;
    });
  };

  const onContextMenu = (event: ReactMouseEvent, relativePath: string) => {
    if (!onOpenWith || openEditors.length === 0) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    onSelect(relativePath);
    clearHideSubmenuTimer();
    setOpenSubmenu(false);
    setMenu({ x: event.clientX, y: event.clientY, relativePath });
  };

  const chooseEditor = (editorId: string) => {
    if (!menu || !onOpenWith) {
      return;
    }
    const relativePath = menu.relativePath;
    clearHideSubmenuTimer();
    setMenu(null);
    setOpenSubmenu(false);
    void onOpenWith(relativePath, editorId);
  };

  useEffect(() => {
    if (!menu) {
      return;
    }
    const closeMenu = () => {
      clearHideSubmenuTimer();
      setMenu(null);
      setOpenSubmenu(false);
    };
    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as Node | null;
      if (target && menuRef.current?.contains(target)) {
        return;
      }
      closeMenu();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        closeMenu();
      }
    };
    const timer = window.setTimeout(() => {
      window.addEventListener("mousedown", onPointerDown);
      window.addEventListener("contextmenu", onPointerDown);
      window.addEventListener("keydown", onKeyDown);
    }, 0);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("mousedown", onPointerDown);
      window.removeEventListener("contextmenu", onPointerDown);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [menu]);

  useEffect(
    () => () => {
      clearHideSubmenuTimer();
    },
    [],
  );

  if (panelCollapsed) {
    return (
      <section
        className="relative flex min-h-0 w-10 shrink-0 flex-col items-center gap-2 overflow-hidden border-r border-line-strong bg-panel py-2"
        aria-label="目录结构（已折叠）"
      >
        <button
          type="button"
          className="rounded-md border border-line px-1.5 py-1 text-[11px] text-ink-2 hover:bg-hover"
          aria-expanded={false}
          aria-label="展开目录结构"
          title="展开目录结构"
          onClick={() => setPanelCollapsed(false)}
        >
          »»
        </button>
        <span
          className="text-[11px] font-medium text-ink-3"
          style={{ writingMode: "vertical-rl" }}
        >
          目录结构
        </span>
      </section>
    );
  }

  return (
    <section className="relative flex min-h-0 w-[240px] shrink-0 flex-col overflow-hidden border-r border-line-strong bg-panel">
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-line-strong px-3 py-2 text-[12px] font-medium text-ink-2">
        <button
          type="button"
          className="min-w-0 flex-1 truncate text-left hover:text-ink"
          aria-expanded={true}
          aria-label="折叠目录结构"
          title="折叠目录结构"
          onClick={() => setPanelCollapsed(true)}
        >
          目录结构
        </button>
        <button
          type="button"
          className="shrink-0 rounded border border-line px-1.5 py-0.5 text-[11px] text-ink-3 hover:bg-hover"
          aria-label="折叠目录结构"
          title="折叠目录结构"
          onClick={() => setPanelCollapsed(true)}
        >
          ««
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-auto px-1 py-1">
        {loading ? (
          <p className="px-2 py-2 text-[12px] text-ink-3">正在加载目录…</p>
        ) : errorMessage ? (
          <p className="px-2 py-2 text-[12px] text-red-600">{errorMessage}</p>
        ) : nodes.length === 0 ? (
          <p className="px-2 py-2 text-[12px] text-ink-3">目录为空</p>
        ) : (
          <ul className="m-0 list-none p-0" role="tree" aria-label="Skill 目录结构">
            <TreeNodes
              nodes={nodes}
              selectedPath={selectedPath}
              collapsed={collapsed}
              onToggleDirectory={onToggleDirectory}
              onSelect={onSelect}
              onContextMenu={onContextMenu}
            />
          </ul>
        )}
      </div>
      {menu && onOpenWith && openEditors.length > 0 && (
        <div
          ref={menuRef}
          role="menu"
          aria-label="文件菜单"
          className="fixed z-50 min-w-[168px] rounded-lg border border-line-strong bg-panel py-1 shadow-lg"
          style={{ left: menu.x, top: menu.y }}
          onMouseLeave={() => {
            scheduleHideSubmenu();
          }}
        >
          <div
            className="relative"
            onMouseEnter={showSubmenu}
            onMouseLeave={scheduleHideSubmenu}
          >
            <button
              type="button"
              role="menuitem"
              aria-haspopup="menu"
              aria-expanded={openSubmenu}
              className={[
                "flex w-full items-center justify-between gap-4 px-3 py-1.5 text-left text-[12px] text-ink",
                openSubmenu ? "bg-hover" : "hover:bg-hover",
              ].join(" ")}
              onMouseEnter={showSubmenu}
              onFocus={showSubmenu}
            >
              <span className="inline-flex items-center gap-2">
                <EditorIcon id="default" />
                打开
              </span>
              <span className="text-ink-3" aria-hidden="true">
                ▸
              </span>
            </button>
            {openSubmenu && (
              <div
                role="menu"
                aria-label="选择应用"
                className="absolute top-0 left-full z-50 min-w-[168px] rounded-lg border border-line-strong bg-panel py-1 shadow-lg"
                style={{ marginLeft: "-1px" }}
                onMouseEnter={showSubmenu}
                onMouseLeave={scheduleHideSubmenu}
              >
                {openEditors.map((editor) => (
                  <button
                    key={editor.id}
                    type="button"
                    role="menuitem"
                    className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[12px] text-ink hover:bg-hover"
                    onClick={() => chooseEditor(editor.id)}
                  >
                    <EditorIcon id={editor.id} />
                    <span>{editor.name}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
          {revealEditor && (
            <button
              type="button"
              role="menuitem"
              className="flex w-full items-center gap-2 border-t border-line px-3 py-1.5 text-left text-[12px] text-ink hover:bg-hover"
              onMouseEnter={scheduleHideSubmenu}
              onClick={() => chooseEditor(revealEditor.id)}
            >
              <EditorIcon id={revealEditor.id} />
              <span>{revealEditor.name}</span>
            </button>
          )}
        </div>
      )}
    </section>
  );
}
