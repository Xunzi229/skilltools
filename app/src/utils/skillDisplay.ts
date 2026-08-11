import type { Provider, SkillSummary } from "../model/skill";
import { skillCanonicalKey, skillProviders } from "../model/skill";

const providerOrder: Record<Provider, number> = {
  cursor: 0,
  claude: 1,
  codex: 2,
};

/** 侧栏计数：按 canonical 源路径去重 */
export function countUniqueSkills(
  skills: SkillSummary[],
  predicate: (skill: SkillSummary) => boolean,
): number {
  const keys = new Set<string>();
  for (const skill of skills) {
    if (!predicate(skill)) continue;
    keys.add(skillCanonicalKey(skill));
  }
  return keys.size;
}

/** 列表标签：多 Provider 时显示 Cursor+Claude+… */
export function formatProviderLabels(skill: SkillSummary): string {
  const providers = [...skillProviders(skill)].sort(
    (left, right) => providerOrder[left] - providerOrder[right],
  );
  const names: Record<Provider, string> = {
    cursor: "Cursor",
    claude: "Claude",
    codex: "Codex",
  };
  return providers.map((provider) => names[provider]).join("+");
}

/** 从 Git URL 提取展示名：优先 `owner/repo`（去掉 `.git`）。 */
export function projectNameFromGitUrl(url: string): string {
  const trimmed = url.trim();
  if (!trimmed) return "project";

  let path = trimmed;
  if (path.startsWith("git@")) {
    const rest = path.slice("git@".length);
    const colon = rest.indexOf(":");
    path = colon >= 0 ? rest.slice(colon + 1) : rest;
  } else {
    const withoutScheme = path
      .replace(/^https?:\/\//i, "")
      .replace(/^git:\/\//i, "")
      .replace(/^ssh:\/\//i, "")
      .replace(/^git@/i, "");
    const slash = withoutScheme.indexOf("/");
    path = slash >= 0 ? withoutScheme.slice(slash + 1) : withoutScheme;
  }

  path = path.replace(/^\/+|\/+$/g, "").replace(/\.git$/i, "");
  const parts = path.split("/").filter(Boolean);
  if (parts.length >= 2) {
    return `${parts[parts.length - 2]}/${parts[parts.length - 1]}`;
  }
  if (parts.length === 1) {
    return parts[0]!;
  }
  return "project";
}

/** 列表/详情头部用的短描述：去掉 TRIGGER 段并压缩空白。 */
export function displayDescription(description: string, maxLength = 160): string {
  const withoutTrigger = description.split(/\bTRIGGER\b/i)[0] ?? description;
  const normalized = withoutTrigger.replace(/\s+/g, " ").trim();
  if (!normalized) {
    return "";
  }
  if (normalized.length <= maxLength) {
    return normalized;
  }
  return `${normalized.slice(0, maxLength).trimEnd()}…`;
}

/** 库 Skill 搜索：名称、描述、来源、分组名、标签名。 */
export function matchesLibrarySkillSearch(
  skill: {
    name: string;
    description: string;
    sourceRepo?: string | null;
    groupId?: string | null;
    tagIds?: string[];
  },
  query: string,
  taxonomy?: {
    groups?: Array<{ id: string; name: string }>;
    tags?: Array<{ id: string; name: string }>;
  },
): boolean {
  const normalized = query.trim().toLocaleLowerCase();
  if (!normalized) return true;
  if (skill.name.toLocaleLowerCase().includes(normalized)) return true;
  if (skill.description.toLocaleLowerCase().includes(normalized)) return true;
  const source = (skill.sourceRepo ?? "").trim().toLocaleLowerCase();
  if (source) {
    if (source.includes(normalized)) return true;
    const slash = source.indexOf("/");
    if (slash > 0) {
      const owner = source.slice(0, slash);
      const repo = source.slice(slash + 1);
      if (owner.includes(normalized) || repo.includes(normalized)) return true;
    }
  }
  if (taxonomy?.groups && skill.groupId) {
    const groupName = taxonomy.groups.find((g) => g.id === skill.groupId)?.name;
    if (groupName?.toLocaleLowerCase().includes(normalized)) return true;
  }
  if (taxonomy?.tags && skill.tagIds?.length) {
    for (const tagId of skill.tagIds) {
      const tagName = taxonomy.tags.find((t) => t.id === tagId)?.name;
      if (tagName?.toLocaleLowerCase().includes(normalized)) return true;
    }
  }
  return false;
}

/** 无来源时显示「本地」；有 `owner/repo` 则原样返回。 */
export function displaySourceLabel(sourceRepo?: string | null): string {
  const value = sourceRepo?.trim();
  return value ? value : "本地";
}

/** 预览 SKILL.md 时去掉 YAML frontmatter，避免把元数据渲成正文。 */
export function stripMarkdownFrontmatter(markdown: string): string {
  if (!markdown.startsWith("---")) {
    return markdown;
  }
  const match = markdown.match(/^---[ \t]*\r?\n[\s\S]*?\r?\n---[ \t]*\r?\n?/);
  return match ? markdown.slice(match[0].length).replace(/^\r?\n/, "") : markdown;
}
