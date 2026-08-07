import { useEffect, useMemo, useState } from "react";
import type { SkillApi } from "./api/skillApi";
import { tauriSkillApi } from "./api/skillApi";
import { BackupList } from "./components/BackupList";
import { Sidebar, type SkillFilter } from "./components/Sidebar";
import { SkillDetail } from "./components/SkillDetail";
import { SkillList } from "./components/SkillList";
import { useSkills } from "./hooks/useSkills";
import "./styles.css";

interface AppProps {
  api?: SkillApi;
}

const filterTitles: Record<SkillFilter, string> = {
  all: "全部 Skill",
  cursor: "Cursor",
  claude: "Claude",
  codex: "Codex",
  paused: "已暂停",
  backups: "备份记录",
};

function App({ api = tauriSkillApi }: AppProps) {
  const [filter, setFilter] = useState<SkillFilter>("all");
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
    <main className="app-shell">
      <Sidebar
        skills={skills}
        backupCount={backups.length}
        activeFilter={filter}
        loading={listLoading}
        onFilterChange={(nextFilter) => {
          setFilter(nextFilter);
          setSearch("");
        }}
        onRefresh={() => void refresh()}
      />

      {filter === "backups" ? (
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
