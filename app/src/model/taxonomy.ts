import { t } from "../i18n";
import {
  skillCanonicalKey,
  type LibrarySkillSummary,
  type SkillGroup,
  type SkillInstallation,
  type SkillSummary,
  type Tag,
} from "./skill";

export type JoinedLibraryTaxonomy = {
  librarySkillId: string;
  groupId: string | null;
  tagIds: string[];
};

/** 用库路径与安装映射构建 path → 分组/标签（供本机列表 join） */
export function buildPathTaxonomyIndex(
  librarySkills: LibrarySkillSummary[],
  installations: SkillInstallation[],
): Map<string, JoinedLibraryTaxonomy> {
  const byId = new Map(librarySkills.map((s) => [s.id, s]));
  const index = new Map<string, JoinedLibraryTaxonomy>();

  const put = (path: string | null | undefined, meta: JoinedLibraryTaxonomy) => {
    const raw = (path ?? "").trim();
    if (!raw) return;
    const key = skillCanonicalKey({
      resolvedPath: raw,
      currentPath: raw,
    });
    if (!key) return;
    index.set(key, meta);
  };

  for (const skill of librarySkills) {
    const meta: JoinedLibraryTaxonomy = {
      librarySkillId: skill.id,
      groupId: skill.groupId,
      tagIds: skill.tagIds,
    };
    put(skill.absolutePath, meta);
  }

  for (const inst of installations) {
    const skill = byId.get(inst.librarySkillId);
    if (!skill) continue;
    const meta: JoinedLibraryTaxonomy = {
      librarySkillId: skill.id,
      groupId: skill.groupId,
      tagIds: skill.tagIds,
    };
    put(inst.sourcePath, meta);
    put(inst.targetPath, meta);
  }

  return index;
}

export function joinSkillTaxonomy(
  skill: SkillSummary,
  pathIndex: Map<string, JoinedLibraryTaxonomy>,
): JoinedLibraryTaxonomy | null {
  return pathIndex.get(skillCanonicalKey(skill)) ?? null;
}

export type LibraryGroupScope = "all" | "ungrouped" | { groupId: string };

export interface LibraryTaxonomyQuery {
  groupScope: LibraryGroupScope;
  /** AND：须同时包含这些标签 */
  tagIds: string[];
  /** true 时要求无任何标签（与 tagIds 互斥，开启时清空 tagIds） */
  untaggedOnly: boolean;
}

export const EMPTY_LIBRARY_QUERY: LibraryTaxonomyQuery = {
  groupScope: "all",
  tagIds: [],
  untaggedOnly: false,
};

export function isLibraryQueryActive(query: LibraryTaxonomyQuery): boolean {
  return (
    query.groupScope !== "all" ||
    query.tagIds.length > 0 ||
    query.untaggedOnly
  );
}

export function matchesLibraryTaxonomy(
  skill: Pick<LibrarySkillSummary, "groupId" | "tagIds">,
  query: LibraryTaxonomyQuery,
): boolean {
  if (query.groupScope === "ungrouped") {
    if (skill.groupId != null) return false;
  } else if (query.groupScope !== "all") {
    if (skill.groupId !== query.groupScope.groupId) return false;
  }

  if (query.untaggedOnly) {
    if (skill.tagIds.length > 0) return false;
  } else if (query.tagIds.length > 0) {
    for (const tagId of query.tagIds) {
      if (!skill.tagIds.includes(tagId)) return false;
    }
  }
  return true;
}

export function setGroupScope(
  query: LibraryTaxonomyQuery,
  groupScope: LibraryGroupScope,
): LibraryTaxonomyQuery {
  return { ...query, groupScope };
}

export function toggleTagInQuery(
  query: LibraryTaxonomyQuery,
  tagId: string,
): LibraryTaxonomyQuery {
  const has = query.tagIds.includes(tagId);
  const tagIds = has
    ? query.tagIds.filter((id) => id !== tagId)
    : [...query.tagIds, tagId];
  return { ...query, tagIds, untaggedOnly: false };
}

export function setUntaggedOnly(query: LibraryTaxonomyQuery): LibraryTaxonomyQuery {
  return { ...query, untaggedOnly: true, tagIds: [] };
}

export function clearTagFilters(query: LibraryTaxonomyQuery): LibraryTaxonomyQuery {
  return { ...query, tagIds: [], untaggedOnly: false };
}

export function removeGroupScope(query: LibraryTaxonomyQuery): LibraryTaxonomyQuery {
  return { ...query, groupScope: "all" };
}

export function removeTagFromQuery(
  query: LibraryTaxonomyQuery,
  tagId: string,
): LibraryTaxonomyQuery {
  return {
    ...query,
    tagIds: query.tagIds.filter((id) => id !== tagId),
  };
}

export function removeDeletedGroupFromQuery(
  query: LibraryTaxonomyQuery,
  groupId: string,
): LibraryTaxonomyQuery {
  if (query.groupScope !== "all" && query.groupScope !== "ungrouped") {
    if (query.groupScope.groupId === groupId) {
      return { ...query, groupScope: "all" };
    }
  }
  return query;
}

export function removeDeletedTagFromQuery(
  query: LibraryTaxonomyQuery,
  tagId: string,
): LibraryTaxonomyQuery {
  return removeTagFromQuery(query, tagId);
}

export interface TaxonomyChip {
  key: string;
  label: string;
  kind: "group" | "ungrouped" | "tag" | "untagged";
}

export function libraryQueryChips(
  query: LibraryTaxonomyQuery,
  groups: SkillGroup[],
  tags: Tag[],
): TaxonomyChip[] {
  const chips: TaxonomyChip[] = [];
  if (query.groupScope === "ungrouped") {
    chips.push({ key: "ungrouped", label: t("taxonomy.ungrouped"), kind: "ungrouped" });
  } else if (typeof query.groupScope === "object") {
    const groupId = query.groupScope.groupId;
    const name = groups.find((g) => g.id === groupId)?.name ?? t("taxonomy.groupFallback");
    chips.push({
      key: `group:${groupId}`,
      label: name,
      kind: "group",
    });
  }
  if (query.untaggedOnly) {
    chips.push({ key: "untagged", label: t("taxonomy.untagged"), kind: "untagged" });
  }
  for (const tagId of query.tagIds) {
    const name = tags.find((tItem) => tItem.id === tagId)?.name ?? t("taxonomy.tagFallback");
    chips.push({ key: `tag:${tagId}`, label: name, kind: "tag" });
  }
  return chips;
}

export function libraryQueryTitle(
  query: LibraryTaxonomyQuery,
  groups: SkillGroup[],
  tags: Tag[],
): string {
  const chips = libraryQueryChips(query, groups, tags);
  if (chips.length === 0) return t("taxonomy.libraryTitle");
  return chips.map((c) => c.label).join(" · ");
}

/** 推荐分组模板（用途主轴） */
export function getTemplateGroups(): string[] {
  return [
    t("templates.groupDevTools"),
    t("templates.groupWriting"),
    t("templates.groupOps"),
    t("templates.groupTesting"),
    t("templates.groupKnowledge"),
    t("templates.groupOther"),
  ];
}

/** @deprecated use getTemplateGroups() */
export const TEMPLATE_GROUPS = [
  "开发工具",
  "写作内容",
  "运维发布",
  "测试质量",
  "知识检索",
  "其他",
] as const;

/** 推荐标签模板 */
export function getTemplateTags(): string[] {
  return [
    "cursor",
    "claude",
    "codex",
    "macos",
    "windows",
    "linux",
    t("templates.tagExperimental"),
    t("templates.tagNeedsKey"),
    t("templates.tagWritesDisk"),
  ];
}

/** @deprecated use getTemplateTags() */
export const TEMPLATE_TAGS = [
  "cursor",
  "claude",
  "codex",
  "macos",
  "windows",
  "linux",
  "实验性",
  "需密钥",
  "写磁盘",
] as const;
