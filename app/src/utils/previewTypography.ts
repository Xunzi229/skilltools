import type { AppSettings } from "../model/skill";

/** 系统字体枚举失败时的回退列表 */
export const PREVIEW_FONT_OPTIONS = [
  { label: "微软雅黑", family: "Microsoft YaHei" },
  { label: "苹方 / 系统黑体", family: "PingFang SC" },
  { label: "宋体", family: "SimSun" },
  { label: "黑体", family: "SimHei" },
  { label: "楷体", family: "KaiTi" },
  { label: "仿宋", family: "FangSong" },
  { label: "等线", family: "DengXian" },
  { label: "Consolas", family: "Consolas" },
  { label: "Cascadia Code", family: "Cascadia Code" },
  { label: "JetBrains Mono", family: "JetBrains Mono" },
  { label: "Fira Code", family: "Fira Code" },
  { label: "Source Code Pro", family: "Source Code Pro" },
] as const;

export type PreviewFontOption = { label: string; family: string };

export function fontsToOptions(families: string[]): PreviewFontOption[] {
  return families.map((family) => ({ label: family, family }));
}

/** 关键字模糊匹配：忽略大小写，支持空格分词与子序列匹配 */
export function filterFontOptions(
  options: readonly PreviewFontOption[],
  query: string,
): PreviewFontOption[] {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return [...options];
  const tokens = normalized.split(/\s+/).filter(Boolean);
  return options.filter((font) => {
    const hay = `${font.label} ${font.family}`.toLowerCase();
    if (tokens.every((token) => hay.includes(token))) return true;
    return isSubsequence(normalized.replace(/\s+/g, ""), hay.replace(/\s+/g, ""));
  });
}

function isSubsequence(needle: string, haystack: string): boolean {
  let index = 0;
  for (const ch of haystack) {
    if (ch === needle[index]) {
      index += 1;
      if (index >= needle.length) return true;
    }
  }
  return needle.length === 0;
}

export const PREVIEW_FONT_SIZE_OPTIONS = [12, 13, 14, 15, 16, 18, 20] as const;

export const DEFAULT_PREVIEW_FONT_FAMILY = "Microsoft YaHei";
export const DEFAULT_PREVIEW_FONT_SIZE = 14;

export function previewFontCss(family: string): string {
  const safe = family.trim() || DEFAULT_PREVIEW_FONT_FAMILY;
  return `"${safe}", "Microsoft YaHei", "PingFang SC", "Segoe UI", sans-serif`;
}

export function applyPreviewTypography(settings: Pick<
  AppSettings,
  "previewFontFamily" | "previewFontSize"
>): void {
  const root = document.documentElement;
  root.style.setProperty(
    "--preview-font-family",
    previewFontCss(settings.previewFontFamily || DEFAULT_PREVIEW_FONT_FAMILY),
  );
  const size = settings.previewFontSize || DEFAULT_PREVIEW_FONT_SIZE;
  root.style.setProperty("--preview-font-size", `${size}px`);
}
