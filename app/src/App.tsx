import { useEffect, useMemo, useState } from "react";
import type { SkillApi } from "./api/skillApi";
import { tauriSkillApi } from "./api/skillApi";
import { BackupList } from "./components/BackupList";
import { LibraryDetail } from "./components/LibraryDetail";
import { LibraryList } from "./components/LibraryList";
import { ProjectPanel } from "./components/ProjectPanel";
import { Sidebar, type SkillFilter } from "./components/Sidebar";
import { SkillDetail } from "./components/SkillDetail";
import { SkillList } from "./components/SkillList";
import { useSkills } from "./hooks/useSkills";
import { useLibrary } from "./hooks/useLibrary";
import "./styles.css";

interface AppProps {
  api?: SkillApi;
}

const filterTitles: Record<SkillFilter, string> = {
  library: "Skill 库",
  all: "全部 Skill",
  cursor: "Cursor",
  claude: "Claude",
  codex: "Codex",
  paused: "已暂停",
  projects: "项目",
  backups: "备份记录",
};

function App({ api = tauriSkillApi }: AppProps) {
  const [filter, setFilter] = useState<SkillFilter>("library");
  const [search, setSearch] = useState("");
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
    clearActionError,
  } = useSkills(api);
  const library = useLibrary(api);

  const visibleSkills = useMemo(() => {
    if (filter === "backups") {
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
    // Only repair an existing selection invalidated by filter/search.
    // Keep an intentionally empty selection after delete.
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
        onFilterChange={(nextFilter) => {
          setFilter(nextFilter);
          setSearch("");
        }}
        onRefresh={() => {
          void refresh();
          void library.refresh();
        }}
      />

      {filter === "projects" ? (
        <ProjectPanel
          projects={library.projects}
          loading={library.loading}
          error={library.actionError ?? library.loadError}
          pendingAction={library.pendingAction}
          onAddLocal={library.addLocalProject}
          onAddGit={library.addGitProject}
          onPull={library.pullGitProject}
          onRemove={library.removeProject}
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
            search={search}
            loading={library.loading}
            errorMessage={library.loadError?.message ?? null}
            onSearchChange={setSearch}
            onSelect={library.selectLibrarySkill}
            onRetry={() => void library.refresh()}
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
            onInstall={library.installSkill}
            onUninstall={library.uninstallSkill}
            onClearError={library.clearActionError}
          />
        </>
      ) : (
        <>
          <SkillList
            title={filterTitles[filter]}
            skills={visibleSkills}
            selectedSkillId={selectedSkillId}
            search={search}
            loading={listLoading}
            errorMessage={scanError?.message ?? null}
            warnings={scanWarnings}
            hasScannedSkills={skills.length > 0}
            onSearchChange={setSearch}
            onSelect={selectSkill}
            onRetry={() => void refresh()}
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
