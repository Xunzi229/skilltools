import { useState } from "react";
import type { FileNode } from "../model/skill";

interface FileTreeProps {
  nodes: FileNode[];
  selectedPath: string | null;
  loading: boolean;
  errorMessage: string | null;
  onSelect: (relativePath: string) => void;
}

function TreeNodes({
  nodes,
  selectedPath,
  collapsed,
  onToggleDirectory,
  onSelect,
  depth = 0,
}: Pick<FileTreeProps, "nodes" | "selectedPath" | "onSelect"> & {
  collapsed: Set<string>;
  onToggleDirectory: (relativePath: string) => void;
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
  onSelect,
}: FileTreeProps) {
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());

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

  return (
    <section className="flex min-h-0 w-[240px] shrink-0 flex-col overflow-hidden border-r border-line-strong bg-panel">
      <div className="shrink-0 border-b border-line-strong px-3 py-2 text-[12px] font-medium text-ink-2">
        目录结构
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
            />
          </ul>
        )}
      </div>
    </section>
  );
}
