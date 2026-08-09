import { useCallback, useEffect, useMemo, useState, type Dispatch, type SetStateAction } from "react";
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
import { useSkills } from "./hooks/useSkills";
import { useLibrary } from "./hooks/useLibrary";
import type { Provider, SkillInstallation } from "./model/skill";
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
  const [search, setSearch] = useState("");
  const [skillSelectedIds, setSkillSelectedIds] = useState<Set<string>>(new Set());
  const [librarySelectedIds, setLibrarySelectedIds] = useState<Set<string>>(
    new Set(),
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
    batchAddSkillTags,
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
  const [installations, setInstallations] = useState<SkillInstallation[]>([]);

  const refreshInstallations = useCallback(async () => {
    try {
      setInstallations(await api.listInstallations());
    } catch {
      setInstallations([]);
    }
  }, [api]);

  useEffect(() => {
    void api
      .getSettings()
      .then((settings) => {
        document.documentElement.dataset.theme = settings.theme;
      })
      .catch(() => {
        document.documentElement.dataset.theme = "light";
      });
  }, [api]);

  useEffect(() => {
    void refreshInstallations();
  }, [refreshInstallations, library.librarySkills]);

  const visibleSkills = useMemo(() => {
    if (
      filter === "backups" ||
      filter === "settings" ||
      filter === "projects" ||
      filter === "installations"
    ) {
      return [];
    }

    const query = search.trim().toLocaleLowerCase();
    return skills.filter((skill) => {
      const matchesFilter =
        filter === "all" ||
        filter === skill.provider ||
        (filter === "paused" && skill.status === "paused");
      const matchesSearch =
        !query ||
        skill.name.toLocaleLowerCase().includes(query) ||
        skill.description.toLocaleLowerCase().includes(query);
      return matchesFilter && matchesSearch;
    });
  }, [filter, search, skills]);

  const visibleLibrarySkills = useMemo(() => {
    const query = search.trim().toLocaleLowerCase();
    return library.librarySkills.filter((skill) => {
      const matchesFilter =
        filter === "library" ||
        (filter.startsWith("group:") && skill.groupId === filter.slice(6)) ||
        (filter.startsWith("tag:") && skill.tagIds.includes(filter.slice(4)));
      return (
        matchesFilter &&
        (!query ||
          skill.name.toLocaleLowerCase().includes(query) ||
          skill.description.toLocaleLowerCase().includes(query))
      );
    });
  }, [filter, library.librarySkills, search]);

  const libraryMode =
    filter === "library" || filter.startsWith("group:") || filter.startsWith("tag:");

  const libraryTitle =
    filter.startsWith("group:")
      ? library.groups.find((group) => group.id === filter.slice(6))?.name ?? "分组"
      : filter.startsWith("tag:")
        ? library.tags.find((tag) => tag.id === filter.slice(4))?.name ?? "标签"
        : "Skill 库";

  useEffect(() => {
    if (
      filter !== "backups" &&
      selectedSkillId !== null &&
      visibleSkills.length > 0 &&
      !visibleSkills.some((skill) => skill.id === selectedSkillId)
    ) {
      selectSkill(visibleSkills[0].id);
    }
  }, [filter, selectSkill, selectedSkillId, visibleSkills]);

  useEffect(() => {
    void loadBackups();
  }, [loadBackups]);

  const toggleSet = (
    setter: Dispatch<SetStateAction<Set<string>>>,
    id: string,
  ) => {
    setter((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <main className="grid h-screen min-h-[600px] w-screen grid-cols-[240px_340px_minmax(0,1fr)] grid-rows-[minmax(0,1fr)] overflow-hidden bg-panel">
      <Sidebar
        skills={skills}
        librarySkills={library.librarySkills}
        groups={library.groups}
        tags={library.tags}
        projectCount={library.projects.length}
        backupCount={backups.length}
        installationCount={installations.length}
        activeFilter={filter}
        loading={listLoading || library.loading}
        busy={library.pendingAction !== null}
        onFilterChange={(nextFilter) => {
          setFilter(nextFilter);
          setSearch("");
          setSkillSelectedIds(new Set());
          setLibrarySelectedIds(new Set());
          clearBatchResult();
        }}
        onRefresh={() => {
          void refresh();
          void library.refresh();
          void refreshInstallations();
        }}
        onCreateGroup={async (name) => {
          await library.createGroup(name);
        }}
        onRenameGroup={async (id, name) => {
          await library.renameGroup(id, name);
        }}
        onDeleteGroup={async (id) => {
          await library.deleteGroup(id);
          if (filter === `group:${id}`) setFilter("library");
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
          if (filter === `tag:${id}`) setFilter("library");
        }}
      />

      {filter === "settings" ? (
        <SettingsPanel
          api={api}
          onSettingsSaved={() => {
            void refresh();
            void library.refresh();
            void refreshInstallations();
          }}
        />
      ) : filter === "installations" ? (
        <InstallationsPanel
          api={api}
          librarySkills={library.librarySkills}
          onUninstalled={() => {
            void library.refresh();
            void refresh();
            void refreshInstallations();
          }}
          onOpenSettingsHealth={() => setFilter("settings")}
        />
      ) : filter === "projects" ? (
        <ProjectPanel
          projects={library.projects}
          loading={library.loading}
          error={library.actionError ?? library.loadError}
          pendingAction={library.pendingAction}
          onAddLocal={library.addLocalProject}
          onAddGit={library.addGitProject}
          onPull={library.pullGitProject}
          onRemove={library.removeProject}
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
          onRestore={restoreBackup}
          onDelete={deleteBackup}
          onClearActionError={clearActionError}
        />
      ) : libraryMode ? (
        <>
          <LibraryList
            title={libraryTitle}
            skills={visibleLibrarySkills}
            groups={library.groups}
            tags={library.tags}
            selectedId={library.selectedLibrarySkillId}
            selectedIds={librarySelectedIds}
            search={search}
            loading={library.loading}
            errorMessage={library.loadError?.message ?? null}
            batchBusy={batchBusy}
            batchResult={batchResult}
            onSearchChange={setSearch}
            onSelect={library.selectLibrarySkill}
            onToggleSelect={(id) => toggleSet(setLibrarySelectedIds, id)}
            onClearSelection={() => setLibrarySelectedIds(new Set())}
            onBatchInstall={(provider: Provider) => {
              const ids = [...librarySelectedIds];
              if (batchBusy || ids.length === 0) return;
              void batchInstallSkills(ids, provider).then(() => void library.refresh());
            }}
            onBatchUninstall={(provider: Provider) => {
              const ids = [...librarySelectedIds];
              if (batchBusy || ids.length === 0) return;
              void batchUninstallSkills(ids, provider).then(() => void library.refresh());
            }}
            onBatchSetGroup={(groupId) => {
              const ids = [...librarySelectedIds];
              if (batchBusy || ids.length === 0) return;
              void batchSetSkillGroup(ids, groupId).then(() => void library.refresh());
            }}
            onBatchAddTag={(tagId) => {
              const ids = [...librarySelectedIds];
              if (batchBusy || ids.length === 0) return;
              void batchAddSkillTags(ids, tagId).then(() => void library.refresh());
            }}
            onCreateSkill={async (name) => {
              await library.createLibrarySkill(name, "");
              void refreshInstallations();
            }}
            onRetry={() => void library.refresh()}
            onClearBatchResult={clearBatchResult}
          />
          <LibraryDetail
            api={api}
            skill={library.selectedLibrarySkill}
            tags={library.tags}
            groups={library.groups}
            loading={library.detailLoading}
            actionError={library.actionError}
            pendingAction={library.pendingAction}
            onSetTags={library.setSkillTags}
            onSetGroup={library.setSkillGroup}
            onCreateTag={(name, color) => library.createTag(name, color ?? null)}
            onCreateGroup={(name) => library.createGroup(name)}
            onInstall={async (id, provider) => {
              await library.installSkill(id, provider);
              void refreshInstallations();
            }}
            onUninstall={async (id, provider) => {
              await library.uninstallSkill(id, provider);
              void refreshInstallations();
            }}
            onExportZip={library.exportLibrarySkillZip}
            onRename={async (id, newName) => {
              await library.renameLibrarySkill(id, newName);
            }}
            onDelete={async (id) => {
              await library.deleteLibrarySkill(id);
              void refreshInstallations();
            }}
            onClearError={library.clearActionError}
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
            onSearchChange={setSearch}
            onSelect={selectSkill}
            onToggleSelect={(id) => toggleSet(setSkillSelectedIds, id)}
            onClearSelection={() => setSkillSelectedIds(new Set())}
            onBatchPause={() => {
              const ids = [...skillSelectedIds];
              if (batchBusy || ids.length === 0) return;
              void batchPauseSkills(ids).then(() => void refresh());
            }}
            onBatchResume={() => {
              const ids = [...skillSelectedIds];
              if (batchBusy || ids.length === 0) return;
              void batchResumeSkills(ids).then(() => void refresh());
            }}
            onBatchBackup={() => {
              const ids = [...skillSelectedIds];
              if (batchBusy || ids.length === 0) return;
              void batchBackupSkills(ids).then(() => {
                void refresh();
                void loadBackups();
              });
            }}
            onBatchDelete={() => {
              const ids = [...skillSelectedIds];
              if (batchBusy || ids.length === 0) return;
              void batchDeleteSkills(ids).then(() => {
                setSkillSelectedIds(new Set());
                void refresh();
                void loadBackups();
              });
            }}
            onBatchMigrate={(replaceWithLink) => {
              const ids = [...skillSelectedIds];
              if (batchBusy || ids.length === 0) return;
              void batchMigrateProviderSkills(ids, replaceWithLink).then(() => {
                void refresh();
                void library.refresh();
              });
            }}
            onRetry={() => void refresh()}
            onClearBatchResult={clearBatchResult}
          />
          <SkillDetail
            api={api}
            skill={selectedSkill}
            loading={detailLoading}
            error={detailError}
            actionError={actionError}
            pendingAction={pendingAction}
            onPause={pauseSkill}
            onResume={resumeSkill}
            onBackup={createBackup}
            onDelete={deleteSkill}
            onMigrated={() => {
              void refresh();
              void library.refresh();
            }}
            onClearActionError={clearActionError}
          />
        </>
      )}
    </main>
  );
}

export default App;
