import { useCallback, useEffect, useRef, useState } from "react";
import type { SkillApi } from "../api/skillApi";
import type {
  CommandError,
  GitImportItem,
  LibrarySkillDetail,
  LibrarySkillSummary,
  Project,
  Provider,
  SkillGroup,
  Tag,
} from "../model/skill";
import { t } from "../i18n";
import { normalizeCommandError } from "../utils/errors";
import { projectNameFromGitUrl } from "../utils/skillDisplay";

export function useLibrary(api: SkillApi) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [gitImports, setGitImports] = useState<GitImportItem[]>([]);
  const [librarySkills, setLibrarySkills] = useState<LibrarySkillSummary[]>([]);
  const [tags, setTags] = useState<Tag[]>([]);
  const [groups, setGroups] = useState<SkillGroup[]>([]);
  const [selectedLibrarySkillId, setSelectedLibrarySkillId] = useState<string | null>(null);
  const [selectedLibrarySkill, setSelectedLibrarySkill] =
    useState<LibrarySkillDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<CommandError | null>(null);
  const [loadError, setLoadError] = useState<CommandError | null>(null);
  const [actionError, setActionError] = useState<CommandError | null>(null);
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const [pullingProjectIds, setPullingProjectIds] = useState<string[]>([]);
  const pendingRef = useRef<string | null>(null);
  const pullingIdsRef = useRef<Set<string>>(new Set());
  const gitImportUrlsRef = useRef<Set<string>>(new Set());
  const detailRequest = useRef(0);
  const selectedLibrarySkillIdRef = useRef<string | null>(null);
  selectedLibrarySkillIdRef.current = selectedLibrarySkillId;

  const loadDetail = useCallback(
    async (skillId: string, options?: { silent?: boolean }) => {
      const requestId = ++detailRequest.current;
      if (!options?.silent) {
        setSelectedLibrarySkill(null);
        setDetailLoading(true);
      }
      setDetailError(null);
      try {
        const detail = await api.getLibrarySkillDetail(skillId);
        if (requestId === detailRequest.current) {
          setSelectedLibrarySkill(detail);
        }
      } catch (error: unknown) {
        if (requestId === detailRequest.current) {
          setSelectedLibrarySkill(null);
          setDetailError(normalizeCommandError(error, t("hooks.loadLibraryDetailFailed")));
        }
      } finally {
        if (requestId === detailRequest.current && !options?.silent) {
          setDetailLoading(false);
        }
      }
    },
    [api],
  );

  const refresh = useCallback(async (options?: { silent?: boolean }) => {
    if (!options?.silent) {
      setLoading(true);
    }
    setLoadError(null);
    try {
      const [nextProjects, nextSkills, nextTags, nextGroups] = await Promise.all([
        api.listProjects(),
        api.listLibrarySkills(),
        api.listTags(),
        api.listGroups(),
      ]);
      setProjects(nextProjects);
      setGitImports((prev) =>
        prev.filter(
          (item) =>
            item.status === "importing" ||
            !nextProjects.some((project) => project.remoteUrl === item.url),
        ),
      );
      setLibrarySkills(nextSkills);
      setTags(nextTags);
      setGroups(nextGroups);
      const currentId = selectedLibrarySkillIdRef.current;
      const nextSelectedId =
        currentId && nextSkills.some((skill) => skill.id === currentId)
          ? currentId
          : nextSkills[0]?.id ?? null;
      setSelectedLibrarySkillId(nextSelectedId);
      if (!nextSelectedId) {
        detailRequest.current += 1;
        setSelectedLibrarySkill(null);
      } else if (nextSelectedId === currentId) {
        // 选中项未变时 useEffect 不会重跑，需在此同步详情
        await loadDetail(nextSelectedId, { silent: options?.silent });
      }
    } catch (error) {
      setLoadError(normalizeCommandError(error));
    } finally {
      if (!options?.silent) {
        setLoading(false);
      }
    }
  }, [api, loadDetail]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (!selectedLibrarySkillId) {
      setSelectedLibrarySkill(null);
      setDetailError(null);
      return;
    }
    void loadDetail(selectedLibrarySkillId);
  }, [loadDetail, selectedLibrarySkillId]);

  const runAction = useCallback(async <T,>(
    key: string,
    action: () => Promise<T>,
  ): Promise<T | undefined> => {
    if (pendingRef.current) return undefined;
    pendingRef.current = key;
    setPendingAction(key);
    setActionError(null);
    try {
      return await action();
    } catch (error) {
      setActionError(normalizeCommandError(error));
      return undefined;
    } finally {
      pendingRef.current = null;
      setPendingAction(null);
    }
  }, []);

  const mutateAndRefresh = useCallback(
    async (key: string, action: () => Promise<unknown>): Promise<void> => {
      await runAction(key, async () => {
        await action();
        await refresh({ silent: true });
      });
    },
    [refresh, runAction],
  );

  const startGitImport = useCallback(
    async (url: string, tempId?: string) => {
      const trimmed = url.trim();
      if (!trimmed) return;

      if (gitImportUrlsRef.current.has(trimmed)) {
        return;
      }
      if (projects.some((project) => project.remoteUrl === trimmed)) {
        setActionError({
          code: "PROJECT_ALREADY_EXISTS",
          message: t("hooks.projectExists", { name: trimmed }),
        });
        return;
      }

      const id = tempId ?? `importing:${trimmed}:${Date.now()}`;
      const name = projectNameFromGitUrl(trimmed);
      gitImportUrlsRef.current.add(trimmed);
      setActionError(null);
      setGitImports((prev) => {
        const withoutSame = prev.filter((item) => item.url !== trimmed);
        return [
          ...withoutSame,
          { tempId: id, url: trimmed, name, status: "importing", error: null },
        ];
      });

      try {
        await api.addGitProject(trimmed);
        gitImportUrlsRef.current.delete(trimmed);
        setGitImports((prev) => prev.filter((item) => item.tempId !== id));
        await refresh({ silent: true });
      } catch (error) {
        gitImportUrlsRef.current.delete(trimmed);
        const normalized = normalizeCommandError(error);
        setGitImports((prev) =>
          prev.map((item) =>
            item.tempId === id
              ? { ...item, status: "failed", error: normalized }
              : item,
          ),
        );
      }
    },
    [api, projects, refresh],
  );

  return {
    projects,
    gitImports,
    librarySkills,
    tags,
    groups,
    selectedLibrarySkillId,
    selectedLibrarySkill,
    loading,
    detailLoading,
    detailError,
    loadError,
    actionError,
    pendingAction,
    pullingProjectIds,
    refresh,
    selectLibrarySkill: setSelectedLibrarySkillId,
    addLocalProject: (path: string) =>
      mutateAndRefresh("project:add-local", () => api.addLocalProject(path)),
    addGitProject: (url: string) => startGitImport(url),
    retryGitImport: (tempId: string) => {
      const target = gitImports.find((item) => item.tempId === tempId);
      if (!target) return Promise.resolve();
      return startGitImport(target.url, target.tempId);
    },
    dismissGitImport: (tempId: string) => {
      setGitImports((prev) => {
        const target = prev.find((item) => item.tempId === tempId);
        if (target) {
          gitImportUrlsRef.current.delete(target.url);
        }
        return prev.filter((item) => item.tempId !== tempId);
      });
    },
    pullGitProject: async (id: string) => {
      // 与 Git 导入一致：不走全局 pendingAction，避免卡死侧栏/其它项目操作
      if (pullingIdsRef.current.has(id)) {
        return undefined;
      }
      pullingIdsRef.current.add(id);
      setPullingProjectIds([...pullingIdsRef.current]);
      setActionError(null);
      try {
        const result = await api.pullGitProject(id);
        await refresh({ silent: true });
        return result;
      } catch (error) {
        setActionError(normalizeCommandError(error));
        return undefined;
      } finally {
        pullingIdsRef.current.delete(id);
        setPullingProjectIds([...pullingIdsRef.current]);
      }
    },
    removeProject: (id: string) =>
      mutateAndRefresh(`project:remove:${id}`, () => api.removeProject(id)),
    installSkill: (id: string, provider: Provider) =>
      mutateAndRefresh(`install:${id}:${provider}`, () => api.installSkill(id, provider)),
    uninstallSkill: (id: string, provider: Provider) =>
      mutateAndRefresh(`uninstall:${id}:${provider}`, () =>
        api.uninstallSkill(id, provider),
      ),
    setSkillTags: (id: string, tagIds: string[]) =>
      mutateAndRefresh(`tags:${id}`, () => api.setSkillTags(id, tagIds)),
    setSkillGroup: (id: string, groupId: string | null) =>
      mutateAndRefresh(`group:${id}`, () => api.setSkillGroup(id, groupId)),
    createTag: async (
      name: string,
      color: string | null = null,
    ): Promise<Tag | undefined> =>
      runAction("tag:create", async () => {
        const tag = await api.createTag(name.trim(), color);
        await refresh({ silent: true });
        return tag;
      }),
    renameTag: (id: string, name: string, color: string | null = null) =>
      mutateAndRefresh(`tag:rename:${id}`, () =>
        api.updateTag(id, name.trim(), color),
      ),
    deleteTag: (id: string) =>
      mutateAndRefresh(`tag:delete:${id}`, () => api.deleteTag(id)),
    importSkillZip: (zipPath: string) =>
      mutateAndRefresh("project:import-zip", () => api.importSkillZip(zipPath)),
    exportProjectZip: (projectId: string, destPath: string) =>
      mutateAndRefresh(`project:export:${projectId}`, () =>
        api.exportProjectZip(projectId, destPath),
      ),
    exportLibrarySkillZip: (id: string, destPath: string) =>
      mutateAndRefresh(`library:export:${id}`, () =>
        api.exportLibrarySkillZip(id, destPath),
      ),
    createLibrarySkill: async (
      name: string,
      description: string,
      projectId?: string | null,
    ): Promise<LibrarySkillSummary | undefined> =>
      runAction("library:create", async () => {
        const skill = await api.createLibrarySkill(name.trim(), description.trim(), projectId);
        await refresh({ silent: true });
        setSelectedLibrarySkillId(skill.id);
        return skill;
      }),
    renameLibrarySkill: async (
      id: string,
      newName: string,
    ): Promise<LibrarySkillSummary | undefined> =>
      runAction(`library:rename:${id}`, async () => {
        const skill = await api.renameLibrarySkill(id, newName.trim());
        await refresh({ silent: true });
        setSelectedLibrarySkillId(skill.id);
        return skill;
      }),
    deleteLibrarySkill: (id: string) =>
      mutateAndRefresh(`library:delete:${id}`, () => api.deleteLibrarySkill(id)),
    createGroup: async (
      name: string,
      color: string | null = null,
    ): Promise<SkillGroup | undefined> =>
      runAction("group:create", async () => {
        const group = await api.createGroup(name.trim(), color);
        await refresh({ silent: true });
        return group;
      }),
    renameGroup: (id: string, name: string) =>
      mutateAndRefresh(`group:rename:${id}`, () => api.renameGroup(id, name.trim())),
    updateGroup: (id: string, name: string, color: string | null) =>
      mutateAndRefresh(`group:update:${id}`, () =>
        api.updateGroup(id, name.trim(), color),
      ),
    updateGroupOrder: (id: string, order: number) =>
      mutateAndRefresh(`group:order:${id}`, () => api.updateGroupOrder(id, order)),
    deleteGroup: (id: string) =>
      mutateAndRefresh(`group:delete:${id}`, () => api.deleteGroup(id)),
    clearActionError: () => setActionError(null),
  };
}
