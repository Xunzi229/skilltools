import { useEffect, useMemo, useState, type Dispatch, type SetStateAction } from "react";
import type { SkillApi } from "./api/skillApi";
import { tauriSkillApi } from "./api/skillApi";
import { BackupList } from "./components/BackupList";
import { InstallationsPanel } from "./components/InstallationsPanel";
import { LibraryDetail } from "./components/LibraryDetail";
import { LibraryList } from "./components/LibraryList";
import { ProjectPanel } from "./components/ProjectPanel";
import { SettingsPanel } from "./components/SettingsPanel";
import { Sidebar, type SkillFilter } from "./components/Sidebar";
import { SkillDetail } from "./components/SkillDetail";
import { SkillList } from "./components/SkillList";
import { useBatchActions } from "./hooks/useBatchActions";
import { useInstallations } from "./hooks/useInstallations";
import { useLocalStorageBool } from "./hooks/useLocalStorageBool";
import { useSkills } from "./hooks/useSkills";
import { useLibrary } from "./hooks/useLibrary";
import {
  skillIdForProviderFilter,
  skillMemberIds,
  skillProviders,
  type Provider,
} from "./model/skill";
import {
  EMPTY_LIBRARY_QUERY,
  TEMPLATE_GROUPS,
  TEMPLATE_TAGS,
  buildPathTaxonomyIndex,
  isLibraryQueryActive,
  joinSkillTaxonomy,
  libraryQueryChips,
  libraryQueryTitle,
  matchesLibraryTaxonomy,
  removeDeletedGroupFromQuery,
  removeDeletedTagFromQuery,
  removeGroupScope,
  removeTagFromQuery,
  type LibraryTaxonomyQuery,
} from "./model/taxonomy";
import { applyPreviewTypography } from "./utils/previewTypography";
import { matchesLibrarySkillSearch } from "./utils/skillDisplay";
import "./styles.css";

interface AppProps {
  api?: SkillApi;
}

const filterTitles: Record<string, string> = {
  library: "Skill 库",
  all: "全部 Skill",
  cursor: "Cursor",
  claude: "Claude",
  codex: "Codex",
  paused: "已暂停",
  installations: "安装",
  projects: "项目",
  backups: "备份记录",
  settings: "设置",
};

function App({ api = tauriSkillApi }: AppProps) {
  const [filter, setFilter] = useState<SkillFilter>("library");
  const [libraryQuery, setLibraryQuery] =
    useState<LibraryTaxonomyQuery>(EMPTY_LIBRARY_QUERY);
  const [search, setSearch] = useState("");
  const [skillSelectedIds, setSkillSelectedIds] = useState<Set<string>>(new Set());
  const [librarySelectedIds, setLibrarySelectedIds] = useState<Set<string>>(
    new Set(),
  );
  const [sidebarCollapsed, setSidebarCollapsed] = useLocalStorageBool(
    "skilltools.ui.sidebarCollapsed",
    false,
  );
  const [listCollapsed, setListCollapsed] = useLocalStorageBool(
    "skilltools.ui.listCollapsed",
    false,
  );
  const {
    batchBusy,
    batchResult,
    clearBatchResult,
    batchPauseSkills,
    batchResumeSkills,
    batchBackupSkills,
    batchDeleteSkills,
    batchInstallSkills,
    batchUninstallSkills,
    batchSetSkillGroup,
    batchApplySkillGroups,
    batchAddSkillTags,
    batchRemoveSkillTags,
    batchSetSkillTags,
    batchMigrateProviderSkills,
  } = useBatchActions(api);
  const {
    skills,
    selectedSkillId,
    selectedSkill,
    listLoading,
    detailLoading,
    scanError,
    scanWarnings,
    detailError,
    pendingAction,
    actionError,
    backups,
    backupsLoading,
    backupsError,
    refresh,
    selectSkill,
    pauseSkill,
    resumeSkill,
    createBackup,
    deleteSkill,
    loadBackups,
    restoreBackup,
    deleteBackup,
    clearActionError,
  } = useSkills(api);
  const library = useLibrary(api);
  const installations = useInstallations(api);

  /** 库/安装/Provider 任一源变更后静默同步：侧栏计数、列表徽章、安装总览等，不闪整页 loading */
  const syncAfterLibraryChange = () => {
    void library.refresh({ silent: true });
    void refresh({ silent: true });
    void installations.refresh({ silent: true });
  };

  useEffect(() => {
    void api
      .getSettings()
      .then((settings) => {
        document.documentElement.dataset.theme = settings.theme;
        applyPreviewTypography(settings);
      })
      .catch(() => {
        document.documentElement.dataset.theme = "light";
        applyPreviewTypography({
          previewFontFamily: "Microsoft YaHei",
          previewFontSize: 14,
        });
      });
  }, [api]);

  const pathTaxonomyIndex = useMemo(
    () =>
      buildPathTaxonomyIndex(
        library.librarySkills,
        installations.overview?.managed ?? [],
      ),
    [installations.overview?.managed, library.librarySkills],
  );

  const taxonomyActive = isLibraryQueryActive(libraryQuery);

  const visibleSkills = useMemo(() => {
    if (
      filter === "backups" ||
      filter === "settings" ||
      filter === "projects" ||
      filter === "installations" ||
      filter === "library"
    ) {
      return [];
    }

    const query = search.trim().toLocaleLowerCase();
    return skills.filter((skill) => {
      const matchesFilter =
        filter === "all" ||
        (filter === "paused" && skill.status === "paused") ||
        ((filter === "cursor" || filter === "claude" || filter === "codex") &&
          skillProviders(skill).includes(filter));
      if (!matchesFilter) return false;
      const matchesSearch =
        !query ||
        skill.name.toLocaleLowerCase().includes(query) ||
        skill.description.toLocaleLowerCase().includes(query);
      if (!matchesSearch) return false;
      if (!taxonomyActive) return true;
      const joined = joinSkillTaxonomy(skill, pathTaxonomyIndex);
      if (!joined) return false;
      return matchesLibraryTaxonomy(joined, libraryQuery);
    });
  }, [
    filter,
    libraryQuery,
    pathTaxonomyIndex,
    search,
    skills,
    taxonomyActive,
  ]);

  const visibleLibrarySkills = useMemo(() => {
    return library.librarySkills.filter((skill) => {
      if (!matchesLibraryTaxonomy(skill, libraryQuery)) return false;
      return matchesLibrarySkillSearch(skill, search, {
        groups: library.groups,
        tags: library.tags,
      });
    });
  }, [
    library.groups,
    library.librarySkills,
    library.tags,
    libraryQuery,
    search,
  ]);

  const libraryMode = filter === "library";

  const libraryTitle = libraryQueryTitle(
    libraryQuery,
    library.groups,
    library.tags,
  );
  const queryChips = libraryQueryChips(
    libraryQuery,
    library.groups,
    library.tags,
  );

  // 当前筛选列表变化时：选中项不在列表中则改选第一项；列表为空则清空详情
  useEffect(() => {
    if (libraryMode) {
      const selectedId = library.selectedLibrarySkillId;
      const inView =
        selectedId !== null &&
        visibleLibrarySkills.some((skill) => skill.id === selectedId);
      if (inView) return;
      if (visibleLibrarySkills.length === 0) {
        if (selectedId !== null) {
          library.selectLibrarySkill(null);
        }
        return;
      }
      library.selectLibrarySkill(visibleLibrarySkills[0]!.id);
      return;
    }

    if (
      filter === "backups" ||
      filter === "settings" ||
      filter === "installations" ||
      filter === "projects"
    ) {
      return;
    }

    if (selectedSkillId !== null && visibleSkills.length === 0) {
      selectSkill(null);
      return;
    }
    if (
      selectedSkillId !== null &&
      visibleSkills.length > 0 &&
      !visibleSkills.some((skill) =>
        skillMemberIds(skill).includes(selectedSkillId),
      )
    ) {
      selectSkill(skillIdForProviderFilter(visibleSkills[0]!, filter));
      return;
    }
    if (
      (filter === "cursor" || filter === "claude" || filter === "codex") &&
      selectedSkillId !== null
    ) {
      const current = skills.find((skill) =>
        skillMemberIds(skill).includes(selectedSkillId),
      );
      if (!current) return;
      const nextId = skillIdForProviderFilter(current, filter);
      if (nextId !== selectedSkillId) {
        selectSkill(nextId);
      }
    }
  }, [
    filter,
    library.selectLibrarySkill,
    library.selectedLibrarySkillId,
    libraryMode,
    selectSkill,
    selectedSkillId,
    skills,
    visibleLibrarySkills,
    visibleSkills,
  ]);

  useEffect(() => {
    void loadBackups();
  }, [loadBackups]);

  const toggleSet = (
    setter: Dispatch<SetStateAction<Set<string>>>,
    ids: string | string[],
  ) => {
    const list = Array.isArray(ids) ? ids : [ids];
    setter((current) => {
      const next = new Set(current);
      const allSelected = list.every((id) => next.has(id));
      for (const id of list) {
        if (allSelected) next.delete(id);
        else next.add(id);
      }
      return next;
    });
  };

  const invertSet = (
    setter: Dispatch<SetStateAction<Set<string>>>,
    ids: string[],
  ) => {
    setter((current) => {
      const next = new Set(current);
      for (const id of ids) {
        if (next.has(id)) next.delete(id);
        else next.add(id);
      }
      return next;
    });
  };

  const sidebarWidth = sidebarCollapsed ? 52 : 240;
  const listWidth = listCollapsed ? 44 : 340;

  return (
    <main
      className="grid h-screen min-h-[600px] w-screen grid-rows-[minmax(0,1fr)] overflow-hidden bg-panel"
      style={{
        gridTemplateColumns: `${sidebarWidth}px ${listWidth}px minmax(0,1fr)`,
      }}
    >
      <Sidebar
        skills={skills}
        librarySkills={library.librarySkills}
        groups={library.groups}
        tags={library.tags}
        projectCount={library.projects.length}
        backupCount={backups.length}
        installationCount={installations.installationCount}
        activeFilter={filter}
        libraryQuery={libraryQuery}
        loading={listLoading || library.loading}
        busy={library.pendingAction !== null}
        collapsed={sidebarCollapsed}
        onToggleCollapse={() => setSidebarCollapsed((value) => !value)}
        onFilterChange={(nextFilter) => {
          setFilter(nextFilter);
          setSearch("");
          setSkillSelectedIds(new Set());
          // 安装预设依赖库勾选：切到「安装」时保留
          if (nextFilter !== "installations") {
            setLibrarySelectedIds(new Set());
          }
          clearBatchResult();
        }}
        onLibraryQueryChange={setLibraryQuery}
        onRefresh={() => {
          void refresh();
          void library.refresh();
          void installations.refresh();
        }}
        onCreateGroup={async (name, color) => {
          await library.createGroup(name, color);
        }}
        onRenameGroup={async (id, name, color) => {
          await library.updateGroup(id, name, color);
        }}
        onDeleteGroup={async (id) => {
          await library.deleteGroup(id);
          setLibraryQuery((q) => removeDeletedGroupFromQuery(q, id));
        }}
        onMoveGroup={async (id, order) => {
          await library.updateGroupOrder(id, order);
        }}
        onCreateTag={async (name, color) => {
          await library.createTag(name, color);
        }}
        onRenameTag={async (id, name, color) => {
          await library.renameTag(id, name, color);
        }}
        onDeleteTag={async (id) => {
          await library.deleteTag(id);
          setLibraryQuery((q) => removeDeletedTagFromQuery(q, id));
        }}
        onApplyTaxonomyTemplate={async () => {
          const existingGroupNames = new Set(
            library.groups.map((g) => g.name.toLocaleLowerCase()),
          );
          const existingTagNames = new Set(
            library.tags.map((t) => t.name.toLocaleLowerCase()),
          );
          for (const name of TEMPLATE_GROUPS) {
            if (!existingGroupNames.has(name.toLocaleLowerCase())) {
              await library.createGroup(name);
            }
          }
          for (const name of TEMPLATE_TAGS) {
            if (!existingTagNames.has(name.toLocaleLowerCase())) {
              await library.createTag(name);
            }
          }
        }}
      />

      {filter === "settings" ? (
        <SettingsPanel
          api={api}
          onSettingsSaved={() => {
            syncAfterLibraryChange();
          }}
          onBackupsChanged={() => {
            void loadBackups();
          }}
        />
      ) : filter === "installations" ? (
        <InstallationsPanel
          installations={installations}
          librarySkills={library.librarySkills}
          selectedSkillIds={[...librarySelectedIds]}
          onChanged={() => {
            syncAfterLibraryChange();
          }}
        />
      ) : filter === "projects" ? (
        <ProjectPanel
          projects={library.projects}
          gitImports={library.gitImports}
          loading={library.loading}
          error={library.actionError ?? library.loadError}
          pendingAction={library.pendingAction}
          onAddLocal={library.addLocalProject}
          onAddGit={library.addGitProject}
          onRetryGitImport={library.retryGitImport}
          onDismissGitImport={library.dismissGitImport}
          onPull={async (id) => {
            const result = await library.pullGitProject(id);
            if (result !== undefined) {
              syncAfterLibraryChange();
            }
            return result;
          }}
          onRemove={async (id) => {
            await library.removeProject(id);
            syncAfterLibraryChange();
          }}
          onImportZip={library.importSkillZip}
          onExportZip={library.exportProjectZip}
          onClearError={library.clearActionError}
        />
      ) : filter === "backups" ? (
        <BackupList
          backups={backups}
          loading={backupsLoading}
          error={backupsError}
          actionError={actionError}
          pendingAction={pendingAction}
          onRetry={() => void loadBackups()}
          onRestore={async (id) => {
            await restoreBackup(id);
            // restoreBackup 已 refresh skills + loadBackups；补齐库/安装索引
            void library.refresh({ silent: true });
            void installations.refresh({ silent: true });
          }}
          onDelete={deleteBackup}
          onClearActionError={clearActionError}
        />
      ) : libraryMode ? (
        <>
          <LibraryList
            api={api}
            title={libraryTitle}
            skills={visibleLibrarySkills}
            groups={library.groups}
            tags={library.tags}
            queryChips={queryChips}
            selectedId={library.selectedLibrarySkillId}
            selectedIds={librarySelectedIds}
            search={search}
            loading={library.loading}
            errorMessage={library.loadError?.message ?? null}
            batchBusy={batchBusy}
            batchResult={batchResult}
            collapsed={listCollapsed}
            onToggleCollapse={() => setListCollapsed((value) => !value)}
            onSearchChange={setSearch}
            onSelect={library.selectLibrarySkill}
            onToggleSelect={(id) => toggleSet(setLibrarySelectedIds, id)}
            onSetSelection={(ids) => setLibrarySelectedIds(new Set(ids))}
            onInvertSelection={(ids) => invertSet(setLibrarySelectedIds, ids)}
            onClearSelection={() => setLibrarySelectedIds(new Set())}
            onRemoveQueryChip={(chip) => {
              if (chip.kind === "group" || chip.kind === "ungrouped") {
                setLibraryQuery((q) => removeGroupScope(q));
              } else if (chip.kind === "untagged") {
                setLibraryQuery((q) => ({ ...q, untaggedOnly: false }));
              } else if (chip.kind === "tag" && chip.key.startsWith("tag:")) {
                setLibraryQuery((q) => removeTagFromQuery(q, chip.key.slice(4)));
              }
            }}
            onClearQuery={() => setLibraryQuery(EMPTY_LIBRARY_QUERY)}
            onBatchInstall={(provider: Provider) => {
              const ids = [...librarySelectedIds];
              if (batchBusy || ids.length === 0) return;
              void batchInstallSkills(ids, provider).then(() => {
                syncAfterLibraryChange();
              });
            }}
            onBatchUninstall={(provider: Provider) => {
              const ids = [...librarySelectedIds];
              if (batchBusy || ids.length === 0) return;
              void batchUninstallSkills(ids, provider).then(() => {
                syncAfterLibraryChange();
              });
            }}
            onBatchSetGroup={(groupId) => {
              const ids = [...librarySelectedIds];
              if (batchBusy || ids.length === 0) return;
              void batchSetSkillGroup(ids, groupId).then(() =>
                void library.refresh({ silent: true }),
              );
            }}
            onApplyAiGroups={async (items) => {
              if (batchBusy || items.length === 0) return;
              const groupNameToId = new Map(
                library.groups.map((g) => [g.name, g.id]),
              );
              const tagNameToId = new Map(
                library.tags.map((t) => [t.name, t.id]),
              );
              for (const item of items) {
                const name = item.newGroupName?.trim();
                if (name && !groupNameToId.has(name)) {
                  const created = await library.createGroup(name);
                  if (created) groupNameToId.set(created.name, created.id);
                }
                for (const tagName of item.newTagNames) {
                  const trimmed = tagName.trim();
                  if (trimmed && !tagNameToId.has(trimmed)) {
                    const created = await library.createTag(trimmed);
                    if (created) tagNameToId.set(created.name, created.id);
                  }
                }
              }
              const assignments = items.map((item) => {
                let groupId = item.groupId;
                const newName = item.newGroupName?.trim();
                if (!groupId && newName) {
                  groupId = groupNameToId.get(newName) ?? null;
                }
                return { skillId: item.skillId, groupId };
              });
              await batchApplySkillGroups(assignments);
              for (const item of items) {
                const tagIds = [
                  ...item.tagIds,
                  ...item.newTagNames
                    .map((n) => tagNameToId.get(n.trim()))
                    .filter((id): id is string => Boolean(id)),
                ];
                for (const tagId of tagIds) {
                  await api.batchAddSkillTags([item.skillId], tagId);
                }
              }
              await library.refresh({ silent: true });
            }}
            onBatchAddTag={(tagId) => {
              const ids = [...librarySelectedIds];
              if (batchBusy || ids.length === 0) return;
              void batchAddSkillTags(ids, tagId).then(() =>
                void library.refresh({ silent: true }),
              );
            }}
            onBatchRemoveTag={(tagId) => {
              const ids = [...librarySelectedIds];
              if (batchBusy || ids.length === 0) return;
              void batchRemoveSkillTags(ids, tagId).then(() =>
                void library.refresh({ silent: true }),
              );
            }}
            onBatchClearTags={() => {
              const ids = [...librarySelectedIds];
              if (batchBusy || ids.length === 0) return;
              void batchSetSkillTags(ids, []).then(() =>
                void library.refresh({ silent: true }),
              );
            }}
            onCreateSkill={async (name) => {
              await library.createLibrarySkill(name, "");
              void installations.refresh({ silent: true });
            }}
            onRetry={() => void library.refresh()}
            onClearBatchResult={clearBatchResult}
            onGoToProjects={() => {
              setFilter("projects");
              setSearch("");
              setLibraryQuery(EMPTY_LIBRARY_QUERY);
              setSkillSelectedIds(new Set());
              setLibrarySelectedIds(new Set());
              clearBatchResult();
            }}
          />
          <LibraryDetail
            api={api}
            skill={
              library.selectedLibrarySkill &&
              visibleLibrarySkills.some(
                (skill) => skill.id === library.selectedLibrarySkill?.id,
              )
                ? library.selectedLibrarySkill
                : null
            }
            tags={library.tags}
            groups={library.groups}
            loading={library.detailLoading}
            actionError={library.actionError}
            pendingAction={library.pendingAction}
            onSetTags={library.setSkillTags}
            onSetGroup={library.setSkillGroup}
            onCreateTag={(name, color) => library.createTag(name, color ?? null)}
            onCreateGroup={(name, color) =>
              library.createGroup(name, color ?? null)
            }
            onInstall={async (id, provider) => {
              await library.installSkill(id, provider);
              void refresh({ silent: true });
              void installations.refresh({ silent: true });
            }}
            onUninstall={async (id, provider) => {
              await library.uninstallSkill(id, provider);
              void refresh({ silent: true });
              void installations.refresh({ silent: true });
            }}
            onExportZip={library.exportLibrarySkillZip}
            onRename={async (id, newName) => {
              await library.renameLibrarySkill(id, newName);
            }}
            onDelete={async (id) => {
              await library.deleteLibrarySkill(id);
              void refresh({ silent: true });
              void installations.refresh({ silent: true });
            }}
            onClearError={library.clearActionError}
            onMetadataSaved={() => {
              void library.refresh({ silent: true });
              void refresh({ silent: true });
            }}
          />
        </>
      ) : (
        <>
          <SkillList
            title={filterTitles[filter] ?? "Skill"}
            skills={visibleSkills}
            selectedSkillId={selectedSkillId}
            selectedIds={skillSelectedIds}
            search={search}
            loading={listLoading}
            errorMessage={scanError?.message ?? null}
            warnings={scanWarnings}
            hasScannedSkills={skills.length > 0}
            batchBusy={batchBusy}
            batchResult={batchResult}
            collapsed={listCollapsed}
            taxonomyActive={taxonomyActive}
            queryChips={queryChips}
            resolveTaxonomy={(skill) => {
              const joined = joinSkillTaxonomy(skill, pathTaxonomyIndex);
              if (!joined) return null;
              const groupLabel =
                joined.groupId == null
                  ? null
                  : (library.groups.find((g) => g.id === joined.groupId)?.name ??
                    null);
              const tagLabels = joined.tagIds
                .map((id) => library.tags.find((t) => t.id === id)?.name)
                .filter((name): name is string => Boolean(name));
              return {
                librarySkillId: joined.librarySkillId,
                groupLabel,
                tagLabels,
              };
            }}
            onToggleCollapse={() => setListCollapsed((value) => !value)}
            onSearchChange={setSearch}
            onSelect={(id) => {
              const skill = visibleSkills.find((item) => item.id === id);
              selectSkill(
                skill ? skillIdForProviderFilter(skill, filter) : id,
              );
            }}
            onToggleSelect={(ids) => toggleSet(setSkillSelectedIds, ids)}
            onSetSelection={(ids) => setSkillSelectedIds(new Set(ids))}
            onInvertSelection={(ids) => invertSet(setSkillSelectedIds, ids)}
            onClearSelection={() => setSkillSelectedIds(new Set())}
            onRemoveQueryChip={(chip) => {
              if (chip.kind === "group" || chip.kind === "ungrouped") {
                setLibraryQuery((q) => removeGroupScope(q));
              } else if (chip.kind === "untagged") {
                setLibraryQuery((q) => ({ ...q, untaggedOnly: false }));
              } else if (chip.kind === "tag" && chip.key.startsWith("tag:")) {
                setLibraryQuery((q) => removeTagFromQuery(q, chip.key.slice(4)));
              }
            }}
            onClearQuery={() => setLibraryQuery(EMPTY_LIBRARY_QUERY)}
            onOpenLibrarySkill={(librarySkillId) => {
              setLibraryQuery(EMPTY_LIBRARY_QUERY);
              setFilter("library");
              library.selectLibrarySkill(librarySkillId);
            }}
            onBatchPause={() => {
              const ids = [...skillSelectedIds];
              if (batchBusy || ids.length === 0) return;
              void batchPauseSkills(ids).then(() => void refresh({ silent: true }));
            }}
            onBatchResume={() => {
              const ids = [...skillSelectedIds];
              if (batchBusy || ids.length === 0) return;
              void batchResumeSkills(ids).then(() => void refresh({ silent: true }));
            }}
            onBatchBackup={() => {
              const ids = [...skillSelectedIds];
              if (batchBusy || ids.length === 0) return;
              void batchBackupSkills(ids).then(() => {
                void refresh({ silent: true });
                void loadBackups();
              });
            }}
            onBatchDelete={() => {
              const ids = [...skillSelectedIds];
              if (batchBusy || ids.length === 0) return;
              void batchDeleteSkills(ids).then(() => {
                setSkillSelectedIds(new Set());
                syncAfterLibraryChange();
                void loadBackups();
              });
            }}
            onBatchMigrate={(replaceWithLink) => {
              const ids = [...skillSelectedIds];
              if (batchBusy || ids.length === 0) return;
              void batchMigrateProviderSkills(ids, replaceWithLink).then(() => {
                syncAfterLibraryChange();
              });
            }}
            onRetry={() => void refresh()}
            onClearBatchResult={clearBatchResult}
          />
          <SkillDetail
            api={api}
            skill={
              selectedSkill &&
              visibleSkills.some((skill) =>
                skillMemberIds(skill).includes(selectedSkill.id),
              )
                ? selectedSkill
                : null
            }
            loading={detailLoading}
            error={detailError}
            actionError={actionError}
            pendingAction={pendingAction}
            onPause={pauseSkill}
            onResume={resumeSkill}
            onBackup={createBackup}
            onDelete={async (id) => {
              await deleteSkill(id);
              // deleteSkill 已 refresh skills(clearSelection) + loadBackups；补齐库/安装索引
              void library.refresh({ silent: true });
              void installations.refresh({ silent: true });
            }}
            onMigrated={() => {
              syncAfterLibraryChange();
            }}
            onClearActionError={clearActionError}
            onMetadataSaved={() => {
              void refresh({ silent: true });
              void library.refresh({ silent: true });
            }}
          />
        </>
      )}
    </main>
  );
}

export default App;
