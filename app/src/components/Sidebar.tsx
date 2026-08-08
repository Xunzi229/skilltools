import type {
  LibrarySkillSummary,
  Provider,
  SkillGroup,
  SkillSummary,
  Tag,
} from "../model/skill";

export type SkillFilter =
  | "library"
  | "all"
  | Provider
  | "paused"
  | "projects"
  | "backups"
  | `group:${string}`
  | `tag:${string}`;

interface SidebarProps {
  skills: SkillSummary[];
  librarySkills: LibrarySkillSummary[];
  groups: SkillGroup[];
  tags: Tag[];
  projectCount: number;
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
  librarySkills,
  groups,
  tags,
  projectCount,
  backupCount,
  activeFilter,
  loading,
  onFilterChange,
  onRefresh,
}: SidebarProps) {
  const item = (id: SkillFilter, label: string, count: number) => (
    <button
      key={id}
      className={[
        "flex w-full items-center justify-between rounded-lg px-3 py-2 text-[13px] transition-colors",
        activeFilter === id
          ? "bg-white/12 text-white"
          : "text-slate-300 hover:bg-white/6 hover:text-white",
      ].join(" ")}
      type="button"
      aria-pressed={activeFilter === id}
      onClick={() => onFilterChange(id)}
    >
      <span>{label}</span>
      <span className="text-[11px] text-slate-400">{count}</span>
    </button>
  );

  return (
    <aside className="flex h-full min-h-0 min-w-0 w-[240px] flex-col overflow-hidden bg-sidebar px-3.5 pb-4 pt-6 text-slate-300">
      <header className="mb-6 flex items-center gap-3 px-2">
        <div
          className="grid size-10 shrink-0 place-items-center rounded-[10px] bg-slate-700 text-[17px] font-bold text-white"
          aria-hidden="true"
        >
          S
        </div>
        <div className="min-w-0">
          <h1 className="m-0 text-[16px] font-semibold leading-tight text-white">
            Skill Manager
          </h1>
          <p className="m-0 mt-0.5 text-[12px] text-slate-400">本地 Skill 管理工具</p>
        </div>
      </header>

      <nav className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-auto" aria-label="Skill 分类">
        <span
          key="label-library"
          className="mb-1 px-3 pt-1 text-[11px] font-medium tracking-wide text-slate-500 uppercase"
        >
          技能库
        </span>
        {item("library", "Skill 库", librarySkills.length)}
        {groups.map((group) =>
          item(
            `group:${group.id}`,
            group.name,
            librarySkills.filter((skill) => skill.groupId === group.id).length,
          ),
        )}
        {tags.map((tag) =>
          item(
            `tag:${tag.id}`,
            tag.name,
            librarySkills.filter((skill) => skill.tagIds.includes(tag.id)).length,
          ),
        )}

        <span
          key="label-local"
          className="mb-1 mt-4 px-3 text-[11px] font-medium tracking-wide text-slate-500 uppercase"
        >
          本机
        </span>
        {item("all", "已安装", skills.filter((skill) => skill.status === "active").length)}
        {providers.map(({ id, label }) =>
          item(id, label, skills.filter((skill) => skill.provider === id).length),
        )}
        {item(
          "paused",
          "已暂停",
          skills.filter((skill) => skill.status === "paused").length,
        )}

        <span
          key="label-data"
          className="mb-1 mt-4 px-3 text-[11px] font-medium tracking-wide text-slate-500 uppercase"
        >
          数据
        </span>
        {item("projects", "项目", projectCount)}
        {item("backups", "备份记录", backupCount)}
      </nav>

      <div className="mt-auto flex flex-col gap-2 pt-4">
        <button
          className="flex items-center justify-center gap-2 rounded-lg border border-white/10 px-3 py-2 text-[12px] text-slate-300 transition-colors hover:bg-white/8 disabled:opacity-55"
          type="button"
          onClick={onRefresh}
          disabled={loading}
        >
          <span aria-hidden="true">↻</span>
          {loading ? "正在扫描…" : "刷新扫描"}
        </button>
        <button
          className="rounded-lg px-3 py-2 text-left text-[13px] text-slate-400 hover:bg-white/6 hover:text-white"
          type="button"
          disabled
          title="即将支持"
        >
          设置
        </button>
      </div>
    </aside>
  );
}
