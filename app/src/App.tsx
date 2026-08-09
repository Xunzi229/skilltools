import { useEffect, useMemo, useState, type Dispatch, type SetStateAction } from "react";
import type { SkillApi } from "./api/skillApi";
import { tauriSkillApi } from "./api/skillApi";
import { BackupList } from "./components/BackupList";
import { LibraryDetail } from "./components/LibraryDetail";
import { LibraryList } from "./components/LibraryList";
import { ProjectPanel } from "./components/ProjectPanel";
import { SettingsPanel } from "./components/SettingsPanel";
import { Sidebar, type SkillFilter } from "./components/Sidebar";
import { SkillDetail } from "./components/SkillDetail";
import { SkillList } from "./components/SkillList";
import { useSkills } from "./hooks/useSkills";
import { useLibrary } from "./hooks/useLibrary";
import type { BatchResult, Provider } from "./model/skill";
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
  projects: "项目",
  backups: "备份记录",
  settings: "设置",
};

async function runBatch(
  ids: string[],
  action: (id: string) => Promise<unknown>,
): Promise<BatchResult> {
  let success = 0;
  let failed = 0;
  const errors: string[] = [];
  for (const id of ids) {
    try {
      await action(id);
      success += 1;
    } catch (error: unknown) {
      failed += 1;
      const message =
        typeof error === "object" &&
        error &&
        "message" in error &&
        typeof (error as { message: unknown }).message === "string"
          ? (error as { message: string }).message
          : "操作失败";
      if (errors.length < 3) errors.push(message);
    }
  }
  return { success, failed, errors };
}

function App({ api = tauriSkillApi }: AppProps) {
  const [filter, setFilter] = useState<SkillFilter>("library");
  const [search, setSearch] = useState("");
  const [skillSelectedIds, setSkillSelectedIds] = useState<Set<string>>(new Set());
  const [librarySelectedIds, setLibrarySelectedIds] = useState<Set<string>>(
    new Set(),
  );
  const [batchBusy, setBatchBusy] = useState(false);
  const [batchResult, setBatchResult] = useState<BatchResult | null>(null);
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

  const visibleSkills = useMemo(() => {
    if (filter === "backups" || filter === "settings" || filter === "projects") {
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

  const withBatch = async (ids: string[], action: (id: string) => Promise<unknown>) => {
    if (batchBusy || ids.length === 0) return;
    setBatchBusy(true);
    setBatchResult(null);
    try {
      setBatchResult(await runBatch(ids, action));
    } finally {
      setBatchBusy(false);
    }
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
        activeFilter={filter}
        loading={listLoading || library.loading}
        busy={library.pendingAction !== null}
        onFilterChange={(nextFilter) => {
          setFilter(nextFilter);
          setSearch("");
          setSkillSelectedIds(new Set());
          setLibrarySelectedIds(new Set());
          setBatchResult(null);
        }}
        onRefresh={() => {
          void refresh();
          void library.refresh();
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
          }}
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
              void withBatch([...librarySelectedIds], (id) =>
                api.installSkill(id, provider),
              ).then(() => void library.refresh());
            }}
            onBatchUninstall={(provider: Provider) => {
              void withBatch([...librarySelectedIds], (id) =>
                api.uninstallSkill(id, provider),
              ).then(() => void library.refresh());
            }}
            onBatchSetGroup={(groupId) => {
              void withBatch([...librarySelectedIds], (id) =>
                api.setSkillGroup(id, groupId),
              ).then(() => void library.refresh());
            }}
            onBatchAddTag={(tagId) => {
              void withBatch([...librarySelectedIds], async (id) => {
                const skill = library.librarySkills.find((item) => item.id === id);
                const next = new Set(skill?.tagIds ?? []);
                next.add(tagId);
                await api.setSkillTags(id, [...next]);
              }).then(() => void library.refresh());
            }}
            onRetry={() => void library.refresh()}
            onClearBatchResult={() => setBatchResult(null)}
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
            onInstall={library.installSkill}
            onUninstall={library.uninstallSkill}
            onExportZip={library.exportLibrarySkillZip}
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
              void withBatch([...skillSelectedIds], (id) => api.pauseSkill(id)).then(
                () => void refresh(),
              );
            }}
            onBatchResume={() => {
              void withBatch([...skillSelectedIds], (id) => api.resumeSkill(id)).then(
                () => void refresh(),
              );
            }}
            onBatchBackup={() => {
              void withBatch([...skillSelectedIds], (id) => api.createBackup(id)).then(
                () => {
                  void refresh();
                  void loadBackups();
                },
              );
            }}
            onBatchDelete={() => {
              void withBatch([...skillSelectedIds], (id) => api.deleteSkill(id)).then(
                () => {
                  setSkillSelectedIds(new Set());
                  void refresh();
                  void loadBackups();
                },
              );
            }}
            onRetry={() => void refresh()}
            onClearBatchResult={() => setBatchResult(null)}
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
            onClearActionError={clearActionError}
          />
        </>
      )}
    </main>
  );
}

export default App;
