import type { AppSettings, TranslateSettings } from "../model/skill";

export const DEFAULT_TRANSLATE_SETTINGS: TranslateSettings = {
  baseUrl: "",
  apiKey: "",
  model: "",
  targetLang: "中文",
};

export const TRANSLATE_LANG_OPTIONS = [
  "中文",
  "English",
  "日本語",
  "한국어",
  "Français",
  "Deutsch",
  "Español",
] as const;

export function normalizeTranslateSettings(
  translate?: Partial<TranslateSettings> | null,
): TranslateSettings {
  return {
    baseUrl: translate?.baseUrl?.trim() ?? "",
    apiKey: translate?.apiKey ?? "",
    model: translate?.model?.trim() ?? "",
    targetLang: translate?.targetLang?.trim() || DEFAULT_TRANSLATE_SETTINGS.targetLang,
  };
}

export function isTranslateConfigured(
  settings: Pick<AppSettings, "translate"> | TranslateSettings | null | undefined,
): boolean {
  const translate =
    settings && "translate" in settings
      ? normalizeTranslateSettings(settings.translate)
      : normalizeTranslateSettings(settings as TranslateSettings | null | undefined);
  return Boolean(
    translate.baseUrl && translate.apiKey.trim() && translate.model && translate.targetLang,
  );
}
