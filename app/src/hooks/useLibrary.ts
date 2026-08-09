import { useCallback, useEffect, useRef, useState } from "react";
import type { SkillApi } from "../api/skillApi";
import type {
  CommandError,
  LibrarySkillDetail,
  LibrarySkillSummary,
  Project,
  Provider,
  SkillGroup,
  Tag,
} from "../model/skill";
import { normalizeCommandError } from "../utils/errors";

export function useLibrary(api: SkillApi) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [librarySkills, setLibrarySkills] = useState<LibrarySkillSummary[]>([]);
  const [tags, setTags] = useState<Tag[]>([]);
  const [groups, setGroups] = useState<SkillGroup[]>([]);
  const [selectedLibrarySkillId, setSelectedLibrarySkillId] = useState<string | null>(null);
  const [selectedLibrarySkill, setSelectedLibrarySkill] =
    useState<LibrarySkillDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [loadError, setLoadError] = useState<CommandError | null>(null);
  const [actionError, setActionError] = useState<CommandError | null>(null);
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const pendingRef = useRef<string | null>(null);
  const detailRequest = useRef(0);

  const refresh = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const [nextProjects, nextSkills, nextTags, nextGroups] = await Promise.all([
        api.listProjects(),
        api.listLibrarySkills(),
        api.listTags(),
        api.listGroups(),
      ]);
      setProjects(nextProjects);
      setLibrarySkills(nextSkills);
      setTags(nextTags);
      setGroups(nextGroups);
      setSelectedLibrarySkillId((current) =>
        current && nextSkills.some((skill) => skill.id === current)
          ? current
          : nextSkills[0]?.id ?? null,
      );
      if (nextSkills.length === 0) {
        detailRequest.current += 1;
        setSelectedLibrarySkill(null);
      }
    } catch (error) {
      setLoadError(normalizeCommandError(error));
    } finally {
      setLoading(false);
    }
  }, [api]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (!selectedLibrarySkillId) {
      setSelectedLibrarySkill(null);
      return;
    }
    const requestId = ++detailRequest.current;
    setDetailLoading(true);
    void api
      .getLibrarySkillDetail(selectedLibrarySkillId)
      .then((detail) => {
        if (requestId === detailRequest.current) setSelectedLibrarySkill(detail);
      })
      .catch((error: unknown) => {
        if (requestId === detailRequest.current) {
          setActionError(normalizeCommandError(error));
        }
      })
      .finally(() => {
        if (requestId === detailRequest.current) setDetailLoading(false);
      });
  }, [api, selectedLibrarySkillId, librarySkills]);

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
        await refresh();
      });
    },
    [refresh, runAction],
  );

  return {
    projects,
    librarySkills,
    tags,
    groups,
    selectedLibrarySkillId,
    selectedLibrarySkill,
    loading,
    detailLoading,
    loadError,
    actionError,
    pendingAction,
    refresh,
    selectLibrarySkill: setSelectedLibrarySkillId,
    addLocalProject: (path: string) =>
      mutateAndRefresh("project:add-local", () => api.addLocalProject(path)),
    addGitProject: (url: string) =>
      mutateAndRefresh("project:add-git", () => api.addGitProject(url)),
    pullGitProject: (id: string) =>
      runAction(`project:pull:${id}`, async () => {
        const result = await api.pullGitProject(id);
        await refresh();
        return result;
      }),
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
        await refresh();
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
        await refresh();
        setSelectedLibrarySkillId(skill.id);
        return skill;
      }),
    renameLibrarySkill: async (
      id: string,
      newName: string,
    ): Promise<LibrarySkillSummary | undefined> =>
      runAction(`library:rename:${id}`, async () => {
        const skill = await api.renameLibrarySkill(id, newName.trim());
        await refresh();
        setSelectedLibrarySkillId(skill.id);
        return skill;
      }),
    deleteLibrarySkill: (id: string) =>
      mutateAndRefresh(`library:delete:${id}`, () => api.deleteLibrarySkill(id)),
    createGroup: async (
      name: string,
      order?: number,
      color: string | null = null,
    ): Promise<SkillGroup | undefined> =>
      runAction("group:create", async () => {
        const nextOrder =
          order ??
          groups.reduce((max, group) => Math.max(max, group.order), -1) + 1;
        const group = await api.createGroup(name.trim(), nextOrder, color);
        await refresh();
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
