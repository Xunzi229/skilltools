import {
  createContext,
  createElement,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { en } from "./en";
import type { Locale, Messages } from "./types";
import { zh } from "./zh";

export type { Locale, Messages } from "./types";
export { zh } from "./zh";
export { en } from "./en";

const STORAGE_KEY = "skilltools.locale";

const catalogs: Record<Locale, Messages> = { zh, en };

function isLocale(value: string): value is Locale {
  return value === "zh" || value === "en";
}

function readStoredLocale(): Locale {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw && isLocale(raw)) return raw;
  } catch {
    // ignore
  }
  return "zh";
}

let currentLocale: Locale = "zh";
let currentMessages: Messages = catalogs.zh;

try {
  currentLocale = readStoredLocale();
  currentMessages = catalogs[currentLocale];
} catch {
  // SSR / non-browser
}

type Vars = Record<string, string | number>;

function lookup(messages: Messages, keyPath: string): string | undefined {
  const parts = keyPath.split(".");
  let cur: unknown = messages;
  for (const part of parts) {
    if (cur == null || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[part];
  }
  return typeof cur === "string" ? cur : undefined;
}

function interpolate(template: string, vars?: Vars): string {
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (match, key: string) =>
    vars[key] !== undefined ? String(vars[key]) : match,
  );
}

/** Module-level translate for hooks/utils outside React. */
export function t(keyPath: string, vars?: Vars): string {
  const value =
    lookup(currentMessages, keyPath) ??
    lookup(catalogs.zh, keyPath) ??
    keyPath;
  return interpolate(value, vars);
}

export function getLocale(): Locale {
  return currentLocale;
}

function applyLocale(locale: Locale): void {
  currentLocale = locale;
  currentMessages = catalogs[locale];
  try {
    localStorage.setItem(STORAGE_KEY, locale);
  } catch {
    // ignore
  }
}

/** Reset module-level locale (used by tests). */
export function resetLocale(locale: Locale = "zh"): void {
  applyLocale(locale);
}

interface I18nContextValue {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: typeof t;
}

const I18nContext = createContext<I18nContextValue | null>(null);

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(() => {
    const initial = readStoredLocale();
    applyLocale(initial);
    return initial;
  });

  const setLocale = useCallback((next: Locale) => {
    applyLocale(next);
    setLocaleState(next);
  }, []);

  const value = useMemo(
    () => ({
      locale,
      setLocale,
      t,
    }),
    [locale, setLocale],
  );

  return createElement(I18nContext.Provider, { value }, children);
}

export function useI18n(): I18nContextValue {
  const ctx = useContext(I18nContext);
  if (!ctx) {
    throw new Error("useI18n must be used within I18nProvider");
  }
  return ctx;
}
