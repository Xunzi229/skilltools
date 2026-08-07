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
  onSelect,
}: Pick<FileTreeProps, "nodes" | "selectedPath" | "onSelect">) {
  return (
    <>
      {nodes.map((node) => (
        <li key={node.relativePath} role="treeitem">
          {node.kind === "directory" ? (
            <div className="tree-directory">
              <span aria-hidden="true">▾</span>
              <span>{node.name}</span>
            </div>
          ) : (
            <button
              type="button"
              className={selectedPath === node.relativePath ? "is-selected" : ""}
              aria-pressed={selectedPath === node.relativePath}
              onClick={() => onSelect(node.relativePath)}
            >
              <span aria-hidden="true">◇</span>
              <span>{node.name}</span>
            </button>
          )}
          {node.children.length > 0 && (
            <ul role="group">
              <TreeNodes
                nodes={node.children}
                selectedPath={selectedPath}
                onSelect={onSelect}
              />
            </ul>
          )}
        </li>
      ))}
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
  return (
    <section className="file-tree-panel">
      <div className="section-heading">目录结构</div>
      {loading ? (
        <p className="file-browser-state">正在加载目录…</p>
      ) : errorMessage ? (
        <p className="file-browser-state error-text">{errorMessage}</p>
      ) : nodes.length === 0 ? (
        <p className="file-browser-state">目录为空</p>
      ) : (
        <ul className="file-tree" role="tree" aria-label="Skill 目录结构">
          <TreeNodes
            nodes={nodes}
            selectedPath={selectedPath}
            onSelect={onSelect}
          />
        </ul>
      )}
    </section>
  );
}
