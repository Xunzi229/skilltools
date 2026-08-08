import { useState } from "react";
import type {
  LibrarySkillSummary,
  Provider,
  SkillGroup,
  SkillSummary,
  Tag,
} from "../model/skill";
import { ConfirmDialog } from "./ConfirmDialog";
import { NameDialog } from "./NameDialog";

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
  busy?: boolean;
  onFilterChange: (filter: SkillFilter) => void;
  onRefresh: () => void;
  onCreateGroup: (name: string) => Promise<void>;
  onRenameGroup: (id: string, name: string) => Promise<void>;
  onDeleteGroup: (id: string) => Promise<void>;
  onMoveGroup: (id: string, order: number) => Promise<void>;
  onCreateTag: (name: string) => Promise<void>;
  onRenameTag: (id: string, name: string) => Promise<void>;
  onDeleteTag: (id: string) => Promise<void>;
}

const providers: Array<{ id: Provider; label: string }> = [
  { id: "cursor", label: "Cursor" },
  { id: "claude", label: "Claude" },
  { id: "codex", label: "Codex" },
];

type DialogState =
  | { kind: "create-group" }
  | { kind: "rename-group"; id: string; name: string }
  | { kind: "create-tag" }
  | { kind: "rename-tag"; id: string; name: string }
  | null;

type ConfirmState =
  | { kind: "group"; id: string; name: string }
  | { kind: "tag"; id: string; name: string }
  | null;

export function Sidebar({
  skills,
  librarySkills,
  groups,
  tags,
  projectCount,
  backupCount,
  activeFilter,
  loading,
  busy = false,
  onFilterChange,
  onRefresh,
  onCreateGroup,
  onRenameGroup,
  onDeleteGroup,
  onMoveGroup,
  onCreateTag,
  onRenameTag,
  onDeleteTag,
}: SidebarProps) {
  const [dialog, setDialog] = useState<DialogState>(null);
  const [confirm, setConfirm] = useState<ConfirmState>(null);
  const [menuKey, setMenuKey] = useState<string | null>(null);

  const sortedGroups = [...groups].sort((left, right) => left.order - right.order);

  const navItem = (id: SkillFilter, label: string, count: number) => (
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
      <span className="truncate">{label}</span>
      <span className="shrink-0 text-[11px] text-slate-400">{count}</span>
    </button>
  );

  const sectionLabel = (text: string, onAdd?: () => void, addLabel?: string) => (
    <div className="mb-1 mt-3 flex items-center justify-between px-3 first:mt-1">
      <span className="text-[11px] font-medium tracking-wide text-slate-500 uppercase">
        {text}
      </span>
      {onAdd && (
        <button
          type="button"
          className="rounded px-1.5 py-0.5 text-[12px] text-slate-400 hover:bg-white/10 hover:text-white disabled:opacity-40"
          aria-label={addLabel}
          disabled={busy}
          onClick={onAdd}
        >
          +
        </button>
      )}
    </div>
  );

  const taxonomyRow = (
    key: string,
    filter: SkillFilter,
    label: string,
    count: number,
    actions: {
      onRename: () => void;
      onDelete: () => void;
      onMoveUp?: () => void;
      onMoveDown?: () => void;
    },
  ) => {
    const active = activeFilter === filter;
    const open = menuKey === key;
    return (
      <div
        key={key}
        className={[
          "group relative flex items-center rounded-lg",
          active ? "bg-white/12" : "hover:bg-white/6",
        ].join(" ")}
      >
        <button
          type="button"
          className={[
            "flex min-w-0 flex-1 items-center justify-between px-3 py-2 text-[13px]",
            active ? "text-white" : "text-slate-300 hover:text-white",
          ].join(" ")}
          aria-pressed={active}
          onClick={() => {
            setMenuKey(null);
            onFilterChange(filter);
          }}
        >
          <span className="truncate">{label}</span>
          <span className="shrink-0 text-[11px] text-slate-400">{count}</span>
        </button>
        <button
          type="button"
          className="mr-1 shrink-0 rounded px-1.5 py-1 text-[12px] text-slate-400 opacity-70 hover:bg-white/10 hover:text-white group-hover:opacity-100"
          aria-label={`管理 ${label}`}
          aria-expanded={open}
          disabled={busy}
          onClick={(event) => {
            event.stopPropagation();
            setMenuKey(open ? null : key);
          }}
        >
          ⋯
        </button>
        {open && (
          <div
            className="absolute top-full right-1 z-20 mt-0.5 min-w-[112px] rounded-lg border border-white/10 bg-slate-800 py-1 shadow-lg"
            role="menu"
          >
            <button
              type="button"
              className="block w-full px-3 py-1.5 text-left text-[12px] text-slate-200 hover:bg-white/10"
              role="menuitem"
              onClick={() => {
                setMenuKey(null);
                actions.onRename();
              }}
            >
              重命名
            </button>
            {actions.onMoveUp && (
              <button
                type="button"
                className="block w-full px-3 py-1.5 text-left text-[12px] text-slate-200 hover:bg-white/10"
                role="menuitem"
                onClick={() => {
                  setMenuKey(null);
                  actions.onMoveUp?.();
                }}
              >
                上移
              </button>
            )}
            {actions.onMoveDown && (
              <button
                type="button"
                className="block w-full px-3 py-1.5 text-left text-[12px] text-slate-200 hover:bg-white/10"
                role="menuitem"
                onClick={() => {
                  setMenuKey(null);
                  actions.onMoveDown?.();
                }}
              >
                下移
              </button>
            )}
            <button
              type="button"
              className="block w-full px-3 py-1.5 text-left text-[12px] text-red-300 hover:bg-white/10"
              role="menuitem"
              onClick={() => {
                setMenuKey(null);
                actions.onDelete();
              }}
            >
              删除
            </button>
          </div>
        )}
      </div>
    );
  };

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

      <nav
        className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-auto"
        aria-label="Skill 分类"
        onClick={() => setMenuKey(null)}
      >
        {sectionLabel("技能库")}
        {navItem("library", "Skill 库", librarySkills.length)}

        {sectionLabel("分组", () => setDialog({ kind: "create-group" }), "新建分组")}
        {sortedGroups.length === 0 ? (
          <p className="px-3 py-1 text-[11px] text-slate-500">暂无分组，点 + 创建</p>
        ) : (
          sortedGroups.map((group, index) =>
            taxonomyRow(
              `group:${group.id}`,
              `group:${group.id}`,
              group.name,
              librarySkills.filter((skill) => skill.groupId === group.id).length,
              {
                onRename: () =>
                  setDialog({ kind: "rename-group", id: group.id, name: group.name }),
                onDelete: () =>
                  setConfirm({ kind: "group", id: group.id, name: group.name }),
                onMoveUp:
                  index > 0
                    ? () => void onMoveGroup(group.id, sortedGroups[index - 1].order - 1)
                    : undefined,
                onMoveDown:
                  index < sortedGroups.length - 1
                    ? () => void onMoveGroup(group.id, sortedGroups[index + 1].order + 1)
                    : undefined,
              },
            ),
          )
        )}

        {sectionLabel("标签", () => setDialog({ kind: "create-tag" }), "新建标签")}
        {tags.length === 0 ? (
          <p className="px-3 py-1 text-[11px] text-slate-500">暂无标签，点 + 创建</p>
        ) : (
          tags.map((tag) =>
            taxonomyRow(
              `tag:${tag.id}`,
              `tag:${tag.id}`,
              tag.name,
              librarySkills.filter((skill) => skill.tagIds.includes(tag.id)).length,
              {
                onRename: () =>
                  setDialog({ kind: "rename-tag", id: tag.id, name: tag.name }),
                onDelete: () => setConfirm({ kind: "tag", id: tag.id, name: tag.name }),
              },
            ),
          )
        )}

        {sectionLabel("本机")}
        {navItem("all", "已安装", skills.filter((skill) => skill.status === "active").length)}
        {providers.map(({ id, label }) =>
          navItem(id, label, skills.filter((skill) => skill.provider === id).length),
        )}
        {navItem(
          "paused",
          "已暂停",
          skills.filter((skill) => skill.status === "paused").length,
        )}

        {sectionLabel("数据")}
        {navItem("projects", "项目", projectCount)}
        {navItem("backups", "备份记录", backupCount)}
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

      <NameDialog
        open={dialog !== null}
        title={
          dialog?.kind === "create-group"
            ? "新建分组"
            : dialog?.kind === "rename-group"
              ? "重命名分组"
              : dialog?.kind === "create-tag"
                ? "新建标签"
                : dialog?.kind === "rename-tag"
                  ? "重命名标签"
                  : ""
        }
        initialValue={
          dialog?.kind === "rename-group" || dialog?.kind === "rename-tag"
            ? dialog.name
            : ""
        }
        confirmLabel={
          dialog?.kind === "create-group" || dialog?.kind === "create-tag"
            ? "创建"
            : "保存"
        }
        busy={busy}
        onCancel={() => setDialog(null)}
        onConfirm={(name) => {
          const current = dialog;
          setDialog(null);
          if (!current) return;
          if (current.kind === "create-group") void onCreateGroup(name);
          if (current.kind === "rename-group") void onRenameGroup(current.id, name);
          if (current.kind === "create-tag") void onCreateTag(name);
          if (current.kind === "rename-tag") void onRenameTag(current.id, name);
        }}
      />

      <ConfirmDialog
        open={confirm !== null}
        title={
          confirm?.kind === "group"
            ? `删除分组「${confirm.name}」？`
            : confirm
              ? `删除标签「${confirm.name}」？`
              : ""
        }
        message="删除后仅清除引用，不会修改 Skill 文件内容。"
        confirmLabel="删除"
        tone="danger"
        busy={busy}
        onCancel={() => setConfirm(null)}
        onConfirm={() => {
          const current = confirm;
          setConfirm(null);
          if (!current) return;
          if (current.kind === "group") void onDeleteGroup(current.id);
          else void onDeleteTag(current.id);
        }}
      />
    </aside>
  );
}
