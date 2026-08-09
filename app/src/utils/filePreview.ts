export type PreviewKind = "markdown" | "code" | "text";

const LANGUAGE_BY_EXT: Record<string, string> = {
  md: "markdown",
  markdown: "markdown",
  py: "python",
  rs: "rust",
  ts: "typescript",
  tsx: "typescript",
  js: "javascript",
  jsx: "javascript",
  json: "json",
  yaml: "yaml",
  yml: "yaml",
  toml: "ini",
  sh: "bash",
  bash: "bash",
  css: "css",
  html: "xml",
  xml: "xml",
  csv: "plaintext",
  txt: "plaintext",
};

export function extensionOf(relativePath: string): string {
  const normalized = relativePath.replace(/\\/g, "/");
  const base = normalized.split("/").pop() ?? normalized;
  const dot = base.lastIndexOf(".");
  if (dot <= 0) return "";
  return base.slice(dot + 1).toLowerCase();
}

export function languageOf(relativePath: string): string {
  return LANGUAGE_BY_EXT[extensionOf(relativePath)] ?? "plaintext";
}

export function previewKindOf(
  relativePath: string,
  mediaType: string,
): PreviewKind {
  if (mediaType === "markdown" || languageOf(relativePath) === "markdown") {
    return "markdown";
  }
  const lang = languageOf(relativePath);
  if (lang !== "plaintext") {
    return "code";
  }
  return "text";
}

export function languageLabel(language: string): string {
  const labels: Record<string, string> = {
    markdown: "Markdown",
    python: "Python",
    rust: "Rust",
    typescript: "TypeScript",
    javascript: "JavaScript",
    json: "JSON",
    yaml: "YAML",
    ini: "TOML",
    bash: "Shell",
    css: "CSS",
    xml: "HTML/XML",
    plaintext: "Text",
  };
  return labels[language] ?? language;
}
