import type { Provider, SkillSummary } from "../model/skill";

export type SkillFilter = "all" | Provider | "paused" | "backups";

interface SidebarProps {
  skills: SkillSummary[];
  backupCount: number;
  activeFilter: SkillFilter;
  loading: boolean;
  onFilterChange: (filter: SkillFilter) => void;
  onRefresh: () => void;
}

const providers: Array<{ id: Provider; label: string }> = [
  { id: "cursor", label: "Cursor" },
  { id: "claude", label: "Claude" },
  { id: "codex", label: "Codex" },
];

export function Sidebar({
  skills,
  backupCount,
  activeFilter,
  loading,
  onFilterChange,
  onRefresh,
}: SidebarProps) {
  const item = (id: SkillFilter, label: string, count: number) => (
    <button
      className={`sidebar-filter${activeFilter === id ? " is-active" : ""}`}
      type="button"
      aria-pressed={activeFilter === id}
      onClick={() => onFilterChange(id)}
    >
      <span>{label}</span>
      <span className="filter-count">{count}</span>
    </button>
  );

  return (
    <aside className="sidebar">
      <header className="brand">
        <div className="brand-mark" aria-hidden="true">S</div>
        <div>
          <h1>Skill Manager</h1>
          <p>本地 Skill 管理工具</p>
        </div>
      </header>

      <nav className="sidebar-nav" aria-label="Skill 分类">
        <span className="nav-label">技能库</span>
        {item("all", "全部", skills.length)}
        {providers.map(({ id, label }) =>
          item(id, label, skills.filter((skill) => skill.provider === id).length),
        )}
        {item(
          "paused",
          "已暂停",
          skills.filter((skill) => skill.status === "paused").length,
        )}

        <span className="nav-label nav-label-secondary">数据</span>
        {item("backups", "备份记录", backupCount)}
      </nav>

      <button
        className="refresh-button"
        type="button"
        onClick={onRefresh}
        disabled={loading}
      >
        <span aria-hidden="true">↻</span>
        {loading ? "正在扫描…" : "刷新扫描"}
      </button>
    </aside>
  );
}
