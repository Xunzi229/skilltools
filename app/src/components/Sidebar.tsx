import { useState, type ReactNode } from "react";
import { useI18n } from "../i18n";
import type {
  LibrarySkillSummary,
  Provider,
  SkillGroup,
  SkillSummary,
  Tag,
} from "../model/skill";
import { skillProviders } from "../model/skill";
import {
  EMPTY_LIBRARY_QUERY,
  getTemplateGroups,
  getTemplateTags,
  type LibraryTaxonomyQuery,
  isLibraryQueryActive,
} from "../model/taxonomy";
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
  | "settings";

interface SidebarProps {
  skills: SkillSummary[];
  librarySkills: LibrarySkillSummary[];
  groups: SkillGroup[];
  tags: Tag[];
  projectCount: number;
  backupCount: number;
  installationCount: number;
  activeFilter: SkillFilter;
  libraryQuery: LibraryTaxonomyQuery;
  loading: boolean;
  busy?: boolean;
  collapsed?: boolean;
  onToggleCollapse?: () => void;
  onFilterChange: (filter: SkillFilter) => void;
  onLibraryQueryChange: (query: LibraryTaxonomyQuery) => void;
  onRefresh: () => void;
  onCreateGroup: (name: string, color: string | null) => Promise<void>;
  onRenameGroup: (id: string, name: string, color: string | null) => Promise<void>;
  onDeleteGroup: (id: string) => Promise<void>;
  onMoveGroup: (id: string, order: number) => Promise<void>;
  onCreateTag: (name: string, color: string | null) => Promise<void>;
  onRenameTag: (id: string, name: string, color: string | null) => Promise<void>;
  onDeleteTag: (id: string) => Promise<void>;
  onApplyTaxonomyTemplate?: () => Promise<void>;
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

function isProviderLikeFilter(filter: SkillFilter): boolean {
  return (
    filter === "all" ||
    filter === "paused" ||
    filter === "cursor" ||
    filter === "claude" ||
    filter === "codex"
  );
}

export function Sidebar({
  skills,
  librarySkills,
  groups,
  tags,
  projectCount,
  backupCount,
  installationCount,
  activeFilter,
  libraryQuery,
  loading,
  busy = false,
  collapsed = false,
  onToggleCollapse,
  onFilterChange,
  onLibraryQueryChange,
  onRefresh,
  onCreateGroup,
  onRenameGroup,
  onDeleteGroup,
  onMoveGroup,
  onCreateTag,
  onRenameTag,
  onDeleteTag,
  onApplyTaxonomyTemplate,
}: SidebarProps) {
  const { t, locale } = useI18n();
  const [dialog, setDialog] = useState<DialogState>(null);
  const [confirm, setConfirm] = useState<ConfirmState>(null);
  const [menuKey, setMenuKey] = useState<string | null>(null);
  const [templateBusy, setTemplateBusy] = useState(false);

  const sortedGroups = [...groups].sort((left, right) => left.order - right.order);

  const ensureLibraryOrKeepProvider = () => {
    if (isProviderLikeFilter(activeFilter)) return;
    if (activeFilter !== "library") onFilterChange("library");
  };

  const selectLibraryHome = () => {
    onLibraryQueryChange(EMPTY_LIBRARY_QUERY);
    onFilterChange("library");
  };

  if (collapsed) {
    const railItem = (id: SkillFilter, label: string, title: string) => (
      <button
        key={id}
        type="button"
        className={[
          "flex w-full flex-col items-center rounded-[8px] px-1 py-2 text-[11px] leading-tight transition-colors",
          activeFilter === id && !isLibraryQueryActive(libraryQuery)
            ? rowActive
            : rowIdle,
        ].join(" ")}
        aria-pressed={activeFilter === id}
        aria-label={title}
        title={title}
        onClick={() => {
          if (id === "library") selectLibraryHome();
          else {
            onLibraryQueryChange(EMPTY_LIBRARY_QUERY);
            onFilterChange(id);
          }
        }}
      >
        <span className="font-medium">{label}</span>
      </button>
    );

    return (
      <aside
        className="flex h-full min-h-0 w-full min-w-0 flex-col items-center gap-1 overflow-hidden border-r border-line bg-sidebar px-1 py-3"
        aria-label={t("sidebar.railCollapsed")}
      >
        <div
          className="mb-1 grid size-8 place-items-center rounded-[9px] bg-brand text-[13px] font-bold text-white"
          aria-hidden="true"
        >
          S
        </div>
        <nav className="flex w-full min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto">
          {railItem("library", t("nav.libraryShort"), t("nav.libraryTitle"))}
          {railItem("all", t("nav.localShort"), t("nav.installedTitle"))}
          {railItem("installations", t("nav.installShort"), t("nav.installationsTitle"))}
          {railItem("projects", t("nav.projects"), t("nav.projects"))}
          {railItem("backups", t("nav.backupShort"), t("nav.backups"))}
          {railItem("settings", t("nav.settings"), t("nav.settings"))}
        </nav>
        <PanelToggle
          expanded={false}
          labelExpand={t("sidebar.expandSidebar")}
          labelCollapse={t("sidebar.collapseSidebar")}
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
        activeFilter === id &&
        (id !== "library" || !isLibraryQueryActive(libraryQuery))
          ? rowActive
          : rowIdle,
      ].join(" ")}
      type="button"
      aria-pressed={
        activeFilter === id &&
        (id !== "library" || !isLibraryQueryActive(libraryQuery))
      }
      onClick={() => {
        if (id === "library") selectLibraryHome();
        else {
          onLibraryQueryChange(EMPTY_LIBRARY_QUERY);
          onFilterChange(id);
        }
      }}
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

  const simpleTaxonomyRow = (
    key: string,
    label: string,
    count: number,
    active: boolean,
    onClick: () => void,
    leading?: ReactNode,
  ) => (
    <button
      key={key}
      type="button"
      className={[
        "flex w-full items-center justify-between rounded-[8px] px-3 py-[7px] text-[13px] transition-colors",
        active ? rowActive : rowIdle,
      ].join(" ")}
      aria-pressed={active}
      onClick={() => {
        setMenuKey(null);
        onClick();
      }}
    >
      <span className="flex min-w-0 items-center gap-2.5">
        {leading}
        <span className="truncate">{label}</span>
      </span>
      <span className={countClass}>{count}</span>
    </button>
  );

  const taxonomyRow = (
    key: string,
    label: string,
    count: number,
    active: boolean,
    onSelect: () => void,
    actions: {
      onRename: () => void;
      onDelete: () => void;
      onMoveUp?: () => void;
      onMoveDown?: () => void;
    },
    leading?: ReactNode,
  ) => {
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
            onSelect();
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
          aria-label={t("sidebar.manageItem", { label })}
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
              {t("sidebar.edit")}
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
                {t("sidebar.moveUp")}
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
                {t("sidebar.moveDown")}
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
              {t("common.delete")}
            </button>
          </div>
        )}
      </div>
    );
  };

  const ungroupedCount = librarySkills.filter((s) => s.groupId == null).length;
  const untaggedCount = librarySkills.filter((s) => s.tagIds.length === 0).length;

  return (
    <aside
      className="flex h-full min-h-0 w-full min-w-0 flex-col overflow-hidden border-r border-line bg-sidebar px-3 pb-4 pt-5"
      aria-label={t("sidebar.navLabel")}
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
            {t("sidebar.subtitle")}
          </p>
        </div>
        {onToggleCollapse && (
          <PanelToggle
            expanded
            labelExpand={t("sidebar.expandSidebar")}
            labelCollapse={t("sidebar.collapseSidebar")}
            onToggle={onToggleCollapse}
            className="mt-0.5"
          />
        )}
      </header>

      <nav
        className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-auto"
        aria-label={t("sidebar.categories")}
        onClick={() => setMenuKey(null)}
      >
        {sectionLabel(t("sidebar.sectionLibrary"))}
        {navItem("library", t("nav.library"), librarySkills.length)}

        {sectionLabel(t("sidebar.sectionGroups"), () => setDialog({ kind: "create-group" }), t("sidebar.newGroup"))}
        {simpleTaxonomyRow(
          "ungrouped",
          t("sidebar.ungrouped"),
          ungroupedCount,
          libraryQuery.groupScope === "ungrouped",
          () => {
            ensureLibraryOrKeepProvider();
            onLibraryQueryChange({
              ...libraryQuery,
              groupScope: "ungrouped",
            });
          },
        )}
        {sortedGroups.length === 0 ? (
          <div className="px-3 py-1">
            <p className="m-0 text-[11px] text-[var(--sidebar-muted)]">
              {t("sidebar.noGroupsHint", {
                examples: getTemplateGroups()
                  .slice(0, 3)
                  .join(locale === "en" ? ", " : "、"),
              })}
            </p>
            {onApplyTaxonomyTemplate && (
              <button
                type="button"
                className="macos-link mt-1 text-[11px]"
                disabled={busy || templateBusy}
                onClick={() => {
                  setTemplateBusy(true);
                  void onApplyTaxonomyTemplate().finally(() => setTemplateBusy(false));
                }}
              >
                {t("sidebar.applyGroupTemplate")}
              </button>
            )}
          </div>
        ) : (
          sortedGroups.map((group, index) =>
            taxonomyRow(
              `group:${group.id}`,
              group.name,
              librarySkills.filter((skill) => skill.groupId === group.id).length,
              typeof libraryQuery.groupScope === "object" &&
                libraryQuery.groupScope.groupId === group.id,
              () => {
                ensureLibraryOrKeepProvider();
                onLibraryQueryChange({
                  ...libraryQuery,
                  groupScope: { groupId: group.id },
                });
              },
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

        {sectionLabel(t("sidebar.sectionTags"), () => setDialog({ kind: "create-tag" }), t("sidebar.newTag"))}
        <p className="mb-1 px-3 text-[10px] leading-snug text-[var(--sidebar-muted)]">
          {t("sidebar.tagsHint")}
        </p>
        {simpleTaxonomyRow(
          "untagged",
          t("sidebar.noTags"),
          untaggedCount,
          libraryQuery.untaggedOnly,
          () => {
            ensureLibraryOrKeepProvider();
            onLibraryQueryChange({
              ...libraryQuery,
              untaggedOnly: true,
              tagIds: [],
            });
          },
        )}
        {tags.length === 0 ? (
          <div className="px-3 py-1">
            <p className="m-0 text-[11px] text-[var(--sidebar-muted)]">
              {t("sidebar.noTagsHint", {
                examples: getTemplateTags()
                  .slice(0, 3)
                  .join(locale === "en" ? ", " : "、"),
              })}
            </p>
            {onApplyTaxonomyTemplate && groups.length > 0 && (
              <button
                type="button"
                className="macos-link mt-1 text-[11px]"
                disabled={busy || templateBusy}
                onClick={() => {
                  setTemplateBusy(true);
                  void onApplyTaxonomyTemplate().finally(() => setTemplateBusy(false));
                }}
              >
                {t("sidebar.applyTagTemplate")}
              </button>
            )}
          </div>
        ) : (
          tags.map((tag) =>
            taxonomyRow(
              `tag:${tag.id}`,
              tag.name,
              librarySkills.filter((skill) => skill.tagIds.includes(tag.id)).length,
              !libraryQuery.untaggedOnly && libraryQuery.tagIds.includes(tag.id),
              () => {
                ensureLibraryOrKeepProvider();
                const has = libraryQuery.tagIds.includes(tag.id);
                const tagIds = has
                  ? libraryQuery.tagIds.filter((id) => id !== tag.id)
                  : [...libraryQuery.tagIds, tag.id];
                onLibraryQueryChange({
                  ...libraryQuery,
                  tagIds,
                  untaggedOnly: false,
                });
              },
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

        {sectionLabel(t("sidebar.sectionLocal"))}
        {navItem(
          "all",
          t("nav.installed"),
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
          t("nav.paused"),
          countUniqueSkills(skills, (skill) => skill.status === "paused"),
        )}

        {sectionLabel(t("sidebar.sectionData"))}
        {navItem("installations", t("nav.installations"), installationCount)}
        {navItem("projects", t("nav.projects"), projectCount)}
        {navItem("backups", t("nav.backups"), backupCount)}
      </nav>

      <div className="mt-auto flex flex-col gap-1.5 border-t border-line pt-3">
        <button
          className="macos-btn-ghost h-8 w-full gap-2 text-[12px]"
          type="button"
          onClick={onRefresh}
          disabled={loading}
        >
          <span aria-hidden="true">↻</span>
          {loading ? t("sidebar.scanning") : t("sidebar.refreshScan")}
        </button>
        <button
          className={[
            "rounded-[8px] px-3 py-2 text-left text-[13px] transition-colors",
            activeFilter === "settings" ? rowActive : rowIdle,
          ].join(" ")}
          type="button"
          onClick={() => {
            onLibraryQueryChange(EMPTY_LIBRARY_QUERY);
            onFilterChange("settings");
          }}
        >
          {t("nav.settings")}
        </button>
      </div>

      <NameDialog
        open={dialog !== null}
        title={
          dialog?.kind === "create-group"
            ? t("sidebar.newGroup")
            : dialog?.kind === "rename-group"
              ? t("sidebar.editGroup")
              : dialog?.kind === "create-tag"
                ? t("sidebar.newTag")
                : dialog?.kind === "rename-tag"
                  ? t("sidebar.editTag")
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
            ? t("common.create")
            : t("common.save")
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
            ? t("sidebar.deleteGroupTitle", { name: confirm.name })
            : confirm
              ? t("sidebar.deleteTagTitle", { name: confirm.name })
              : ""
        }
        message={t("sidebar.deleteTaxonomyMessage")}
        confirmLabel={t("common.delete")}
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
