import { useState, type ReactNode } from "react";
import type {
  LibrarySkillSummary,
  Provider,
  SkillGroup,
  SkillSummary,
  Tag,
} from "../model/skill";
import { skillProviders } from "../model/skill";
import { countUniqueSkills } from "../utils/skillDisplay";
import { ConfirmDialog } from "./ConfirmDialog";
import { NameDialog } from "./NameDialog";
import { PanelToggle } from "./PanelToggle";
import { DEFAULT_APPLE_COLOR, ListColorDot } from "./TagColorPicker";

export type SkillFilter =
  | "library"
  | "all"
  | Provider
  | "paused"
  | "installations"
  | "projects"
  | "backups"
  | "settings"
  | `group:${string}`
  | `tag:${string}`;

interface SidebarProps {
  skills: SkillSummary[];
  librarySkills: LibrarySkillSummary[];
  groups: SkillGroup[];
  tags: Tag[];
  projectCount: number;
  backupCount: number;
  installationCount: number;
  activeFilter: SkillFilter;
  loading: boolean;
  busy?: boolean;
  collapsed?: boolean;
  onToggleCollapse?: () => void;
  onFilterChange: (filter: SkillFilter) => void;
  onRefresh: () => void;
  onCreateGroup: (name: string, color: string | null) => Promise<void>;
  onRenameGroup: (id: string, name: string, color: string | null) => Promise<void>;
  onDeleteGroup: (id: string) => Promise<void>;
  onMoveGroup: (id: string, order: number) => Promise<void>;
  onCreateTag: (name: string, color: string | null) => Promise<void>;
  onRenameTag: (id: string, name: string, color: string | null) => Promise<void>;
  onDeleteTag: (id: string) => Promise<void>;
}

const providers: Array<{ id: Provider; label: string }> = [
  { id: "cursor", label: "Cursor" },
  { id: "claude", label: "Claude" },
  { id: "codex", label: "Codex" },
];

type DialogState =
  | { kind: "create-group" }
  | { kind: "rename-group"; id: string; name: string; color: string | null }
  | { kind: "create-tag" }
  | { kind: "rename-tag"; id: string; name: string; color: string | null }
  | null;

type ConfirmState =
  | { kind: "group"; id: string; name: string }
  | { kind: "tag"; id: string; name: string }
  | null;

const rowActive =
  "bg-[var(--sidebar-active-bg)] text-[var(--sidebar-active)] font-medium";
const rowIdle =
  "text-[var(--sidebar-ink)] hover:bg-[var(--sidebar-hover)]";
const countClass = "shrink-0 text-[11px] text-[var(--sidebar-muted)] tabular-nums";

export function Sidebar({
  skills,
  librarySkills,
  groups,
  tags,
  projectCount,
  backupCount,
  installationCount,
  activeFilter,
  loading,
  busy = false,
  collapsed = false,
  onToggleCollapse,
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

  if (collapsed) {
    const railItem = (id: SkillFilter, label: string, title: string) => (
      <button
        key={id}
        type="button"
        className={[
          "flex w-full flex-col items-center rounded-[8px] px-1 py-2 text-[11px] leading-tight transition-colors",
          activeFilter === id ? rowActive : rowIdle,
        ].join(" ")}
        aria-pressed={activeFilter === id}
        aria-label={title}
        title={title}
        onClick={() => onFilterChange(id)}
      >
        <span className="font-medium">{label}</span>
      </button>
    );

    return (
      <aside
        className="flex h-full min-h-0 w-full min-w-0 flex-col items-center gap-1 overflow-hidden border-r border-line bg-sidebar px-1 py-3"
        aria-label="导航栏（已折叠）"
      >
        <div
          className="mb-1 grid size-8 place-items-center rounded-[9px] bg-brand text-[13px] font-bold text-white"
          aria-hidden="true"
        >
          S
        </div>
        <nav className="flex w-full min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto">
          {railItem("library", "库", "Skill 库")}
          {railItem("all", "本机", "已安装")}
          {railItem("installations", "安装", "安装总览")}
          {railItem("projects", "项目", "项目")}
          {railItem("backups", "备份", "备份记录")}
          {railItem("settings", "设置", "设置")}
        </nav>
        <PanelToggle
          expanded={false}
          labelExpand="展开侧边栏"
          labelCollapse="折叠侧边栏"
          onToggle={onToggleCollapse}
          className="mt-1"
        />
      </aside>
    );
  }

  const navItem = (id: SkillFilter, label: string, count: number) => (
    <button
      key={id}
      className={[
        "flex w-full items-center justify-between rounded-[8px] px-3 py-[7px] text-[13px] transition-colors",
        activeFilter === id ? rowActive : rowIdle,
      ].join(" ")}
      type="button"
      aria-pressed={activeFilter === id}
      onClick={() => onFilterChange(id)}
    >
      <span className="truncate">{label}</span>
      <span className={countClass}>{count}</span>
    </button>
  );

  const sectionLabel = (text: string, onAdd?: () => void, addLabel?: string) => (
    <div className="mb-1 mt-3.5 flex items-center justify-between px-3 first:mt-0.5">
      <span className="text-[11px] font-semibold tracking-wide text-[var(--sidebar-muted)]">
        {text}
      </span>
      {onAdd && (
        <button
          type="button"
          className="grid size-5 place-items-center rounded-full text-[14px] leading-none text-brand hover:bg-[var(--sidebar-active-bg)] disabled:opacity-40"
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
    leading?: ReactNode,
  ) => {
    const active = activeFilter === filter;
    const open = menuKey === key;
    return (
      <div
        key={key}
        className={[
          "group relative flex items-center rounded-[8px]",
          active ? "bg-[var(--sidebar-active-bg)]" : "hover:bg-[var(--sidebar-hover)]",
        ].join(" ")}
      >
        <button
          type="button"
          className={[
            "flex min-w-0 flex-1 items-center justify-between px-3 py-[7px] text-[13px]",
            active
              ? "font-medium text-[var(--sidebar-active)]"
              : "text-[var(--sidebar-ink)]",
          ].join(" ")}
          aria-pressed={active}
          onClick={() => {
            setMenuKey(null);
            onFilterChange(filter);
          }}
        >
          <span className="flex min-w-0 items-center gap-2.5">
            {leading}
            <span className="truncate">{label}</span>
          </span>
          <span className={countClass}>{count}</span>
        </button>
        <button
          type="button"
          className="mr-1 shrink-0 rounded-[6px] px-1.5 py-1 text-[12px] text-[var(--sidebar-muted)] opacity-0 hover:bg-black/5 group-hover:opacity-100"
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
            className="macos-menu absolute top-full right-1 z-20 mt-1 min-w-[124px]"
            role="menu"
          >
            <button
              type="button"
              className="macos-menu-item"
              role="menuitem"
              onClick={() => {
                setMenuKey(null);
                actions.onRename();
              }}
            >
              编辑
            </button>
            {actions.onMoveUp && (
              <button
                type="button"
                className="macos-menu-item"
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
                className="macos-menu-item"
                role="menuitem"
                onClick={() => {
                  setMenuKey(null);
                  actions.onMoveDown?.();
                }}
              >
                下移
              </button>
            )}
            <div className="my-1 border-t border-line" />
            <button
              type="button"
              className="macos-menu-item macos-menu-item-danger"
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
    <aside
      className="flex h-full min-h-0 w-full min-w-0 flex-col overflow-hidden border-r border-line bg-sidebar px-3 pb-4 pt-5"
      aria-label="导航栏"
    >
      <header className="mb-3 flex items-start gap-2.5 px-2">
        <div
          className="grid size-9 shrink-0 place-items-center rounded-[10px] bg-brand text-[15px] font-bold text-white shadow-sm"
          aria-hidden="true"
        >
          S
        </div>
        <div className="min-w-0 flex-1">
          <h1 className="m-0 text-[15px] font-semibold tracking-tight text-[var(--sidebar-ink)]">
            Skill Manager
          </h1>
          <p className="m-0 mt-0.5 text-[11px] text-[var(--sidebar-muted)]">
            本地 Skill 管理工具
          </p>
        </div>
        {onToggleCollapse && (
          <PanelToggle
            expanded
            labelExpand="展开侧边栏"
            labelCollapse="折叠侧边栏"
            onToggle={onToggleCollapse}
            className="mt-0.5"
          />
        )}
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
          <p className="px-3 py-1 text-[11px] text-[var(--sidebar-muted)]">
            暂无分组，点 + 创建
          </p>
        ) : (
          sortedGroups.map((group, index) =>
            taxonomyRow(
              `group:${group.id}`,
              `group:${group.id}`,
              group.name,
              librarySkills.filter((skill) => skill.groupId === group.id).length,
              {
                onRename: () =>
                  setDialog({
                    kind: "rename-group",
                    id: group.id,
                    name: group.name,
                    color: group.color,
                  }),
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
              <ListColorDot color={group.color ?? DEFAULT_APPLE_COLOR} />,
            ),
          )
        )}

        {sectionLabel("标签", () => setDialog({ kind: "create-tag" }), "新建标签")}
        {tags.length === 0 ? (
          <p className="px-3 py-1 text-[11px] text-[var(--sidebar-muted)]">
            暂无标签，点 + 创建
          </p>
        ) : (
          tags.map((tag) =>
            taxonomyRow(
              `tag:${tag.id}`,
              `tag:${tag.id}`,
              tag.name,
              librarySkills.filter((skill) => skill.tagIds.includes(tag.id)).length,
              {
                onRename: () =>
                  setDialog({
                    kind: "rename-tag",
                    id: tag.id,
                    name: tag.name,
                    color: tag.color,
                  }),
                onDelete: () => setConfirm({ kind: "tag", id: tag.id, name: tag.name }),
              },
              <ListColorDot color={tag.color} size="sm" />,
            ),
          )
        )}

        {sectionLabel("本机")}
        {navItem(
          "all",
          "已安装",
          countUniqueSkills(skills, (skill) => skill.status === "active"),
        )}
        {providers.map(({ id, label }) =>
          navItem(
            id,
            label,
            countUniqueSkills(skills, (skill) =>
              skillProviders(skill).includes(id),
            ),
          ),
        )}
        {navItem(
          "paused",
          "已暂停",
          countUniqueSkills(skills, (skill) => skill.status === "paused"),
        )}

        {sectionLabel("数据")}
        {navItem("installations", "安装", installationCount)}
        {navItem("projects", "项目", projectCount)}
        {navItem("backups", "备份记录", backupCount)}
      </nav>

      <div className="mt-auto flex flex-col gap-1.5 border-t border-line pt-3">
        <button
          className="macos-btn-ghost h-8 w-full gap-2 text-[12px]"
          type="button"
          onClick={onRefresh}
          disabled={loading}
        >
          <span aria-hidden="true">↻</span>
          {loading ? "正在扫描…" : "刷新扫描"}
        </button>
        <button
          className={[
            "rounded-[8px] px-3 py-2 text-left text-[13px] transition-colors",
            activeFilter === "settings" ? rowActive : rowIdle,
          ].join(" ")}
          type="button"
          onClick={() => onFilterChange("settings")}
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
              ? "编辑分组"
              : dialog?.kind === "create-tag"
                ? "新建标签"
                : dialog?.kind === "rename-tag"
                  ? "编辑标签"
                  : ""
        }
        initialValue={
          dialog?.kind === "rename-group" || dialog?.kind === "rename-tag"
            ? dialog.name
            : ""
        }
        initialColor={
          dialog?.kind === "rename-group" || dialog?.kind === "rename-tag"
            ? dialog.color
            : dialog?.kind === "create-group" || dialog?.kind === "create-tag"
              ? DEFAULT_APPLE_COLOR
              : null
        }
        showColorPicker={
          dialog?.kind === "create-group" ||
          dialog?.kind === "rename-group" ||
          dialog?.kind === "create-tag" ||
          dialog?.kind === "rename-tag"
        }
        confirmLabel={
          dialog?.kind === "create-group" || dialog?.kind === "create-tag"
            ? "创建"
            : "保存"
        }
        busy={busy}
        onCancel={() => setDialog(null)}
        onConfirm={(name, color) => {
          const current = dialog;
          setDialog(null);
          if (!current) return;
          if (current.kind === "create-group") void onCreateGroup(name, color ?? null);
          if (current.kind === "rename-group")
            void onRenameGroup(current.id, name, color ?? null);
          if (current.kind === "create-tag") void onCreateTag(name, color ?? null);
          if (current.kind === "rename-tag")
            void onRenameTag(current.id, name, color ?? null);
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
