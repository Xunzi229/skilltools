/** SKILL.md 常见 frontmatter 字段（Agent Skills / Cursor / Claude / Codex）。 */
export const STANDARD_FRONTMATTER_FIELDS = [
  {
    key: "name",
    label: "name",
    required: true,
    multiline: false,
    hint: "必填，建议小写字母/数字/连字符",
  },
  {
    key: "description",
    label: "description",
    required: true,
    multiline: true,
    hint: "必填，说明用途与触发场景",
  },
  {
    key: "license",
    label: "license",
    required: false,
    multiline: false,
    hint: "如 MIT、Apache-2.0",
  },
  {
    key: "compatibility",
    label: "compatibility",
    required: false,
    multiline: true,
    hint: "环境要求（可选）",
  },
  {
    key: "allowed-tools",
    label: "allowed-tools",
    required: false,
    multiline: false,
    hint: "空格分隔的预授权工具（实验性）",
  },
  {
    key: "tags",
    label: "tags",
    required: false,
    multiline: false,
    hint: "逗号分隔，或 YAML 列表",
  },
  {
    key: "version",
    label: "version",
    required: false,
    multiline: false,
  },
  {
    key: "author",
    label: "author",
    required: false,
    multiline: false,
  },
  {
    key: "homepage",
    label: "homepage",
    required: false,
    multiline: false,
  },
  {
    key: "metadata",
    label: "metadata",
    required: false,
    multiline: true,
    hint: "嵌套 YAML 映射（可选）",
  },
] as const;

export const STANDARD_FRONTMATTER_KEYS: Set<string> = new Set(
  STANDARD_FRONTMATTER_FIELDS.map((field) => field.key),
);

/** 提取 --- ... --- 之间的 YAML 文本。 */
export function extractFrontmatterYaml(markdown: string): string | null {
  if (!markdown.startsWith("---")) {
    return null;
  }
  const match = markdown.match(/^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/);
  return match ? match[1] ?? null : null;
}

/**
 * 轻量解析 frontmatter：支持标量与缩进块（如 metadata）。
 * 不做完整 YAML 语义，只服务表单编辑。
 */
export function parseFrontmatterFields(markdown: string): Record<string, string> {
  const yaml = extractFrontmatterYaml(markdown);
  if (yaml === null) {
    return {};
  }

  const fields: Record<string, string> = {};
  const lines = yaml.split(/\r?\n/);
  let index = 0;

  while (index < lines.length) {
    const line = lines[index] ?? "";
    if (!line.trim() || line.trimStart().startsWith("#")) {
      index += 1;
      continue;
    }

    const match = line.match(/^([^:\s][^:]*):\s*(.*)$/);
    if (!match) {
      index += 1;
      continue;
    }

    const key = match[1].trim();
    const inline = match[2] ?? "";
    index += 1;

    if (inline !== "") {
      fields[key] = stripYamlQuotes(inline.trim());
      continue;
    }

    const block: string[] = [];
    while (index < lines.length) {
      const next = lines[index] ?? "";
      if (next === "" || /^\s/.test(next)) {
        block.push(next.replace(/^\s{2}/, ""));
        index += 1;
        continue;
      }
      break;
    }
    fields[key] = block.join("\n").replace(/^\n+/, "").replace(/\n+$/, "");
  }

  return fields;
}

function stripYamlQuotes(value: string): string {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }
  return value;
}

export function customFrontmatterEntries(
  fields: Record<string, string>,
): Array<{ key: string; value: string }> {
  return Object.entries(fields)
    .filter(([key]) => !STANDARD_FRONTMATTER_KEYS.has(key))
    .map(([key, value]) => ({ key, value }))
    .sort((left, right) => left.key.localeCompare(right.key));
}
