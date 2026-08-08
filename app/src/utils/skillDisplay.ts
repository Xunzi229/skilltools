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

/** 预览 SKILL.md 时去掉 YAML frontmatter，避免把元数据渲成正文。 */
export function stripMarkdownFrontmatter(markdown: string): string {
  if (!markdown.startsWith("---")) {
    return markdown;
  }
  const match = markdown.match(/^---[ \t]*\r?\n[\s\S]*?\r?\n---[ \t]*\r?\n?/);
  return match ? markdown.slice(match[0].length).replace(/^\r?\n/, "") : markdown;
}
