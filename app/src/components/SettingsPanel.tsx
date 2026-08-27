import { useEffect, useState } from "react";
import { useI18n } from "../i18n";
import type { SkillApi } from "../api/skillApi";
import type {
  AppPathsInfo,
  AppSettings,
  CommandError,
  Provider,
  ThemePreference,
} from "../model/skill";
import { APP_VERSION } from "../version";
import { pickDirectory } from "../utils/dialogs";
import { formatUpdaterError } from "../utils/errors";
import { FontFamilyPicker } from "./FontFamilyPicker";
import {
  DEFAULT_PREVIEW_FONT_FAMILY,
  DEFAULT_PREVIEW_FONT_SIZE,
  PREVIEW_FONT_OPTIONS,
  PREVIEW_FONT_SIZE_OPTIONS,
  applyPreviewTypography,
  fontsToOptions,
  type PreviewFontOption,
} from "../utils/previewTypography";
import {
  DEFAULT_TRANSLATE_SETTINGS,
  TRANSLATE_LANG_OPTIONS,
  isModelServiceConfigured,
  normalizeTranslateSettings,
} from "../utils/translateSettings";
import {
  PROXY_TYPE_OPTIONS,
  normalizeProxySettings,
  proxySettingsError,
} from "../utils/proxySettings";

interface SettingsPanelProps {
  api: SkillApi;
  onSettingsSaved: () => void;
  /** 备份列表变更（如清理）后回调，仅刷新备份计数 */
  onBackupsChanged?: () => void;
}

const providerLabels: Record<Provider, string> = {
  cursor: "Cursor",
  claude: "Claude",
  codex: "Codex",
};

function asCommandError(err: unknown, fallback: string): CommandError {
  return typeof err === "object" && err && "message" in err
    ? (err as CommandError)
    : { code: "UNKNOWN", message: fallback };
}

function MacSwitch({
  checked,
  disabled,
  label,
  onChange,
}: {
  checked: boolean;
  disabled?: boolean;
  label: string;
  onChange: (next: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      className="macos-switch"
      data-on={checked ? "true" : undefined}
      onClick={() => onChange(!checked)}
    >
      <span className="macos-switch-knob" />
    </button>
  );
}

export function SettingsPanel({
  api,
  onSettingsSaved,
  onBackupsChanged,
}: SettingsPanelProps) {
  const { locale, setLocale, t } = useI18n();
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [paths, setPaths] = useState<AppPathsInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<CommandError | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [cleanupBusy, setCleanupBusy] = useState(false);
  const [updateBusy, setUpdateBusy] = useState(false);
  const [updateMessage, setUpdateMessage] = useState<string | null>(null);
  const [fontOptions, setFontOptions] = useState<PreviewFontOption[]>(() => [
    ...PREVIEW_FONT_OPTIONS,
  ]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void Promise.all([
      api.getSettings(),
      api.getAppPaths(),
      api.listSystemFonts().catch(() => [] as string[]),
    ])
      .then(([nextSettings, nextPaths, systemFonts]) => {
        if (cancelled) return;
        const normalized = {
          ...nextSettings,
          translate: normalizeTranslateSettings(nextSettings.translate),
          proxy: normalizeProxySettings(nextSettings.proxy),
        };
        setSettings(normalized);
        setPaths(nextPaths);
        if (systemFonts.length > 0) {
          setFontOptions(fontsToOptions(systemFonts));
        }
        applyPreviewTypography(normalized);
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(asCommandError(err, t("settings.loadFailed")));
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [api]);

  const save = async (next: AppSettings) => {
    setSaving(true);
    setError(null);
    setMessage(null);
    const rootsChanged =
      JSON.stringify(settings?.skillRootOverrides) !== JSON.stringify(next.skillRootOverrides);
    try {
      const saved = await api.saveSettings(next);
      setSettings(saved);
      setPaths(await api.getAppPaths());
      document.documentElement.dataset.theme = saved.theme;
      applyPreviewTypography(saved);
      setMessage(t("settings.saved"));
      if (rootsChanged) {
        onSettingsSaved();
      }
    } catch (err: unknown) {
      setError(asCommandError(err, t("settings.saveFailed")));
    } finally {
      setSaving(false);
    }
  };

  const setTheme = (theme: ThemePreference) => {
    if (!settings) return;
    void save({ ...settings, theme });
  };

  const setRoot = async (provider: Provider) => {
    if (!settings) return;
    const selected = await pickDirectory(t("settings.pickRootTitle", { provider: providerLabels[provider] }));
    if (!selected) return;
    void save({
      ...settings,
      skillRootOverrides: {
        ...settings.skillRootOverrides,
        [provider]: selected,
      },
    });
  };

  const resetRoot = (provider: Provider) => {
    if (!settings) return;
    void save({
      ...settings,
      skillRootOverrides: {
        ...settings.skillRootOverrides,
        [provider]: null,
      },
    });
  };

  const resetAllRoots = () => {
    if (!settings) return;
    void save({
      ...settings,
      skillRootOverrides: { cursor: null, claude: null, codex: null },
    });
  };

  const runCleanup = async () => {
    setCleanupBusy(true);
    setError(null);
    setMessage(null);
    try {
      const deleted = await api.cleanupBackups();
      setMessage(t("settings.cleaned", { count: deleted }));
      onBackupsChanged?.();
    } catch (err: unknown) {
      setError(asCommandError(err, t("settings.cleanupFailed")));
    } finally {
      setCleanupBusy(false);
    }
  };

  const checkForUpdates = async () => {
    setUpdateBusy(true);
    setUpdateMessage(null);
    setError(null);
    try {
      const [{ check }, { relaunch }] = await Promise.all([
        import("@tauri-apps/plugin-updater"),
        import("@tauri-apps/plugin-process"),
      ]);
      const update = await check();
      if (!update) {
        setUpdateMessage(t("settings.upToDate", { version: APP_VERSION }));
        return;
      }
      const ok = window.confirm(
        t("settings.updateConfirm", { version: update.version, body: update.body ?? "" }),
      );
      if (!ok) {
        setUpdateMessage(t("settings.updateCancelled", { version: update.version }));
        return;
      }
      await update.downloadAndInstall();
      setUpdateMessage(t("settings.updateInstalled"));
      await relaunch();
    } catch (err: unknown) {
      // plugin-updater 的 Error 经 IPC 序列化为纯字符串，不能只认 Error/message
      setUpdateMessage(formatUpdaterError(err));
    } finally {
      setUpdateBusy(false);
    }
  };

  return (
    <section
      className="col-span-2 flex h-full min-h-0 min-w-0 flex-col overflow-hidden bg-panel"
      aria-label={t("settings.region")}
    >
      <header className="shrink-0 border-b border-line-strong px-6 pt-5 pb-4">
        <h2 className="macos-page-title">{t("settings.title")}</h2>
        <p className="macos-page-sub">{t("settings.subtitle", { version: APP_VERSION })}</p>
      </header>
      <div className="min-h-0 flex-1 overflow-auto px-6 py-5">
        {loading ? (
          <p className="text-[13px] text-ink-3">{t("settings.loading")}</p>
        ) : (
          <>
            {error && <div className="macos-alert-error mb-4">{error.message}</div>}
            {message && <div className="macos-alert-ok mb-4">{message}</div>}
            <section className="macos-card mb-6 p-4">
              <h3 className="macos-section-title">{t("settings.language")}</h3>
              <p className="mt-2 text-[12px] text-ink-3">{t("settings.languageHint")}</p>
              <div className="macos-seg mt-3">
                <button
                  type="button"
                  className="macos-seg-item px-3.5 text-[13px]"
                  data-active={locale === "zh" ? "true" : undefined}
                  aria-pressed={locale === "zh"}
                  onClick={() => setLocale("zh")}
                >
                  {t("settings.langZh")}
                </button>
                <button
                  type="button"
                  className="macos-seg-item px-3.5 text-[13px]"
                  data-active={locale === "en" ? "true" : undefined}
                  aria-pressed={locale === "en"}
                  onClick={() => setLocale("en")}
                >
                  {t("settings.langEn")}
                </button>
              </div>
            </section>
            <section className="macos-card mb-6 p-4">
              <h3 className="macos-section-title">{t("settings.theme")}</h3>
              <div className="macos-seg mt-3">
                {(["light", "dark"] as const).map((theme) => (
                  <button
                    key={theme}
                    type="button"
                    disabled={saving}
                    className="macos-seg-item px-3.5 text-[13px]"
                    data-active={settings?.theme === theme ? "true" : undefined}
                    aria-pressed={settings?.theme === theme}
                    onClick={() => setTheme(theme)}
                  >
                    {theme === "light" ? t("settings.themeLight") : t("settings.themeDark")}
                  </button>
                ))}
              </div>
            </section>
            <section className="macos-card mb-6 p-4">
              <h3 className="macos-section-title">{t("settings.previewFont")}</h3>
              <p className="mt-2 text-[12px] text-ink-3">{t("settings.previewFontHint")}</p>
              <div className="mt-3 flex flex-wrap gap-4">
                <label className="flex flex-col gap-1 text-[12px] text-ink-2">
                  {t("settings.fontFamily")}
                  <FontFamilyPicker
                    value={settings?.previewFontFamily || DEFAULT_PREVIEW_FONT_FAMILY}
                    options={fontOptions}
                    disabled={saving || !settings}
                    onChange={(family) => {
                      if (!settings) return;
                      void save({
                        ...settings,
                        previewFontFamily: family,
                      });
                    }}
                  />
                </label>
                <label className="flex flex-col gap-1 text-[12px] text-ink-2">
                  {t("settings.fontSize")}
                  <select
                    className="macos-select"
                    value={settings?.previewFontSize || DEFAULT_PREVIEW_FONT_SIZE}
                    disabled={saving || !settings}
                    onChange={(event) => {
                      if (!settings) return;
                      void save({
                        ...settings,
                        previewFontSize: Number(event.target.value),
                      });
                    }}
                  >
                    {PREVIEW_FONT_SIZE_OPTIONS.map((size) => (
                      <option key={size} value={size}>
                        {size}px
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <p
                className="macos-row mt-3 text-ink-2"
                style={{
                  fontFamily: `"${settings?.previewFontFamily || DEFAULT_PREVIEW_FONT_FAMILY}"`,
                  fontSize: `${settings?.previewFontSize || DEFAULT_PREVIEW_FONT_SIZE}px`,
                }}
              >
                {t("settings.previewSample")}
              </p>
            </section>
            <section className="macos-card mb-6 p-4">
              <h3 className="macos-section-title">{t("settings.modelService")}</h3>
              <p className="mt-2 text-[12px] text-ink-3">{t("settings.modelServiceHint")}</p>
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <label className="flex flex-col gap-1 text-[12px] text-ink-2 sm:col-span-2">
                  Base URL
                  <input
                    type="url"
                    className="macos-input px-2.5 py-1.5"
                    placeholder="https://api.openai.com/v1"
                    value={settings?.translate?.baseUrl ?? ""}
                    disabled={saving || !settings}
                    onChange={(event) => {
                      if (!settings) return;
                      setSettings({
                        ...settings,
                        translate: {
                          ...normalizeTranslateSettings(settings.translate),
                          baseUrl: event.target.value,
                        },
                      });
                    }}
                  />
                </label>
                <label className="flex flex-col gap-1 text-[12px] text-ink-2 sm:col-span-2">
                  API Key
                  <input
                    type="password"
                    className="macos-input px-2.5 py-1.5"
                    placeholder="sk-…"
                    autoComplete="off"
                    value={settings?.translate?.apiKey ?? ""}
                    disabled={saving || !settings}
                    onChange={(event) => {
                      if (!settings) return;
                      setSettings({
                        ...settings,
                        translate: {
                          ...normalizeTranslateSettings(settings.translate),
                          apiKey: event.target.value,
                        },
                      });
                    }}
                  />
                </label>
                <label className="flex flex-col gap-1 text-[12px] text-ink-2">
                  {t("settings.model")}
                  <input
                    type="text"
                    className="macos-input px-2.5 py-1.5"
                    placeholder="gpt-4o-mini"
                    value={settings?.translate?.model ?? ""}
                    disabled={saving || !settings}
                    onChange={(event) => {
                      if (!settings) return;
                      setSettings({
                        ...settings,
                        translate: {
                          ...normalizeTranslateSettings(settings.translate),
                          model: event.target.value,
                        },
                      });
                    }}
                  />
                </label>
                <label className="flex flex-col gap-1 text-[12px] text-ink-2">
                  {t("settings.targetLang")}
                  <input
                    list="translate-lang-options"
                    type="text"
                    className="macos-input px-2.5 py-1.5"
                    placeholder={t("settings.targetLangPlaceholder")}
                    value={
                      settings?.translate?.targetLang ??
                      DEFAULT_TRANSLATE_SETTINGS.targetLang
                    }
                    disabled={saving || !settings}
                    onChange={(event) => {
                      if (!settings) return;
                      setSettings({
                        ...settings,
                        translate: {
                          ...normalizeTranslateSettings(settings.translate),
                          targetLang: event.target.value,
                        },
                      });
                    }}
                  />
                  <datalist id="translate-lang-options">
                    {TRANSLATE_LANG_OPTIONS.map((lang) => (
                      <option key={lang} value={lang} />
                    ))}
                  </datalist>
                </label>
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  className="macos-btn-ghost"
                  disabled={saving || !settings}
                  onClick={() => {
                    if (!settings) return;
                    void save({
                      ...settings,
                      translate: normalizeTranslateSettings(settings.translate),
                    });
                  }}
                >
                  {t("settings.saveModelService")}
                </button>
                <span className="text-[12px] text-ink-3">
                  {settings && isModelServiceConfigured(settings)
                    ? t("settings.modelConfigured")
                    : t("settings.modelNotConfigured")}
                </span>
              </div>
            </section>
            <section className="macos-card mb-6 p-4">
              <div className="macos-settings-row">
                <h3 className="macos-section-title">{t("settings.proxy")}</h3>
                <MacSwitch
                  checked={Boolean(settings?.proxy?.enabled)}
                  disabled={saving || !settings}
                  label={t("settings.proxy")}
                  onChange={(enabled) => {
                    if (!settings) return;
                    setSettings({
                      ...settings,
                      proxy: {
                        ...normalizeProxySettings(settings.proxy),
                        enabled,
                      },
                    });
                  }}
                />
              </div>
              <p className="mt-2 text-[12px] text-ink-3">{t("settings.proxyHint")}</p>
              <div
                className="mt-3"
                style={{
                  opacity: settings?.proxy?.enabled ? 1 : 0.55,
                }}
              >
                <div className="macos-settings-row">
                  <span className="macos-settings-label">{t("settings.proxyMode")}</span>
                  <select
                    className="macos-select"
                    value="manual"
                    disabled={saving || !settings || !settings.proxy.enabled}
                    onChange={() => undefined}
                  >
                    <option value="manual">{t("settings.proxyModeManual")}</option>
                  </select>
                </div>
                <div className="macos-settings-row">
                  <span className="macos-settings-label">{t("settings.proxyType")}</span>
                  <select
                    className="macos-select"
                    value={settings?.proxy?.proxyType ?? "socks5"}
                    disabled={saving || !settings || !settings.proxy.enabled}
                    onChange={(event) => {
                      if (!settings) return;
                      setSettings({
                        ...settings,
                        proxy: {
                          ...normalizeProxySettings(settings.proxy),
                          proxyType: event.target.value as (typeof PROXY_TYPE_OPTIONS)[number],
                        },
                      });
                    }}
                  >
                    {PROXY_TYPE_OPTIONS.map((type) => (
                      <option key={type} value={type}>
                        {type === "http"
                          ? t("settings.proxyTypeHttp")
                          : type === "https"
                            ? t("settings.proxyTypeHttps")
                            : t("settings.proxyTypeSocks5")}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="macos-settings-row">
                  <span className="macos-settings-label">{t("settings.proxyHost")}</span>
                  <input
                    type="text"
                    className="macos-input px-2.5"
                    placeholder={t("settings.proxyHostPlaceholder")}
                    autoComplete="off"
                    value={settings?.proxy?.host ?? ""}
                    disabled={saving || !settings || !settings.proxy.enabled}
                    onChange={(event) => {
                      if (!settings) return;
                      setSettings({
                        ...settings,
                        proxy: {
                          ...normalizeProxySettings(settings.proxy),
                          host: event.target.value,
                        },
                      });
                    }}
                  />
                </div>
                <div className="macos-settings-row">
                  <span className="macos-settings-label">{t("settings.proxyPort")}</span>
                  <input
                    type="number"
                    min={1}
                    max={65535}
                    className="macos-input px-2.5"
                    placeholder={t("settings.proxyPortPlaceholder")}
                    value={settings?.proxy?.port ? settings.proxy.port : ""}
                    disabled={saving || !settings || !settings.proxy.enabled}
                    onChange={(event) => {
                      if (!settings) return;
                      const raw = event.target.value.trim();
                      setSettings({
                        ...settings,
                        proxy: {
                          ...normalizeProxySettings(settings.proxy),
                          port: raw === "" ? 0 : Number(raw),
                        },
                      });
                    }}
                  />
                </div>
                <div className="macos-settings-row">
                  <span className="macos-settings-label">{t("settings.proxyAuth")}</span>
                  <MacSwitch
                    checked={Boolean(settings?.proxy?.authEnabled)}
                    disabled={saving || !settings || !settings.proxy.enabled}
                    label={t("settings.proxyAuth")}
                    onChange={(authEnabled) => {
                      if (!settings) return;
                      setSettings({
                        ...settings,
                        proxy: {
                          ...normalizeProxySettings(settings.proxy),
                          authEnabled,
                        },
                      });
                    }}
                  />
                </div>
                <div className="macos-settings-row">
                  <span className="macos-settings-label">{t("settings.proxyUsername")}</span>
                  <input
                    type="text"
                    className="macos-input px-2.5"
                    autoComplete="off"
                    value={settings?.proxy?.username ?? ""}
                    disabled={
                      saving || !settings || !settings.proxy.enabled || !settings.proxy.authEnabled
                    }
                    onChange={(event) => {
                      if (!settings) return;
                      setSettings({
                        ...settings,
                        proxy: {
                          ...normalizeProxySettings(settings.proxy),
                          username: event.target.value,
                        },
                      });
                    }}
                  />
                </div>
                <div className="macos-settings-row">
                  <span className="macos-settings-label">{t("settings.proxyPassword")}</span>
                  <input
                    type="password"
                    className="macos-input px-2.5"
                    autoComplete="off"
                    value={settings?.proxy?.password ?? ""}
                    disabled={
                      saving || !settings || !settings.proxy.enabled || !settings.proxy.authEnabled
                    }
                    onChange={(event) => {
                      if (!settings) return;
                      setSettings({
                        ...settings,
                        proxy: {
                          ...normalizeProxySettings(settings.proxy),
                          password: event.target.value,
                        },
                      });
                    }}
                  />
                </div>
              </div>
              <div className="mt-3">
                <button
                  type="button"
                  className="macos-btn-ghost"
                  disabled={saving || !settings}
                  onClick={() => {
                    if (!settings) return;
                    const proxy = normalizeProxySettings(settings.proxy);
                    const invalid = proxySettingsError(proxy, {
                      hostRequired: t("settings.proxyHostRequired"),
                      portRequired: t("settings.proxyPortRequired"),
                      usernameRequired: t("settings.proxyUsernameRequired"),
                    });
                    if (invalid) {
                      setError({ code: "SETTINGS", message: invalid });
                      setMessage(null);
                      return;
                    }
                    void save({ ...settings, proxy });
                  }}
                >
                  {t("settings.saveProxy")}
                </button>
              </div>
            </section>
            <section className="macos-card mb-6 p-4">
              <div className="flex items-center justify-between gap-3">
                <h3 className="macos-section-title">{t("settings.skillRoots")}</h3>
                <button
                  type="button"
                  className="macos-btn-ghost"
                  disabled={saving}
                  onClick={resetAllRoots}
                >
                  {t("settings.resetAllRoots")}
                </button>
              </div>
              <ul className="mt-3 flex list-none flex-col gap-2 p-0">
                {(["cursor", "claude", "codex"] as const).map((provider) => {
                  const current =
                    provider === "cursor"
                      ? paths?.cursorSkills
                      : provider === "claude"
                        ? paths?.claudeSkills
                        : paths?.codexSkills;
                  const defaults =
                    provider === "cursor"
                      ? paths?.defaultCursorSkills
                      : provider === "claude"
                        ? paths?.defaultClaudeSkills
                        : paths?.defaultCodexSkills;
                  const overridden = Boolean(settings?.skillRootOverrides[provider]);
                  return (
                    <li key={provider} className="macos-row">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <strong className="text-[13px] text-ink">
                          {providerLabels[provider]}
                          {overridden ? (
                            <span className="ml-2 text-[11px] font-normal text-brand">
                              {t("settings.customized")}
                            </span>
                          ) : null}
                        </strong>
                        <div className="flex gap-1.5">
                          <button
                            type="button"
                            className="macos-btn-ghost"
                            disabled={saving}
                            onClick={() => void setRoot(provider)}
                          >
                            {t("settings.browse")}
                          </button>
                          <button
                            type="button"
                            className="macos-btn-ghost"
                            disabled={saving || !overridden}
                            onClick={() => resetRoot(provider)}
                          >
                            {t("settings.reset")}
                          </button>
                          <button
                            type="button"
                            className="macos-btn-ghost"
                            disabled={!current}
                            onClick={() => current && void api.revealPath(current)}
                          >
                            {t("settings.open")}
                          </button>
                        </div>
                      </div>
                      <p className="mt-2 break-all font-mono text-[12px] text-ink-2">
                        {current ?? "—"}
                      </p>
                      {overridden && (
                        <p className="mt-1 text-[11px] text-ink-3">
                          {t("settings.defaultPath", { path: defaults ?? "—" })}
                        </p>
                      )}
                    </li>
                  );
                })}
              </ul>
            </section>
            <section className="macos-card mb-6 p-4">
              <h3 className="macos-section-title">{t("settings.backupRetention")}</h3>
              <p className="mt-2 text-[12px] text-ink-3">{t("settings.backupRetentionHint")}</p>
              <div className="mt-3 flex flex-wrap gap-4">
                <label className="flex flex-col gap-1 text-[12px] text-ink-2">
                  {t("settings.retainDays")}
                  <input
                    type="number"
                    min={1}
                    className="macos-input w-28 px-2.5 py-1.5"
                    value={settings?.backupRetentionDays ?? ""}
                    placeholder={t("settings.retainDaysPlaceholder")}
                    disabled={saving}
                    onChange={(event) => {
                      if (!settings) return;
                      const raw = event.target.value.trim();
                      setSettings({
                        ...settings,
                        backupRetentionDays: raw === "" ? null : Number(raw),
                      });
                    }}
                  />
                </label>
                <label className="flex flex-col gap-1 text-[12px] text-ink-2">
                  {t("settings.maxCount")}
                  <input
                    type="number"
                    min={1}
                    className="macos-input w-28 px-2.5 py-1.5"
                    value={settings?.backupMaxCount ?? ""}
                    placeholder={t("settings.maxCountPlaceholder")}
                    disabled={saving}
                    onChange={(event) => {
                      if (!settings) return;
                      const raw = event.target.value.trim();
                      setSettings({
                        ...settings,
                        backupMaxCount: raw === "" ? null : Number(raw),
                      });
                    }}
                  />
                </label>
              </div>
              <div className="mt-3 flex gap-2">
                <button
                  type="button"
                  className="macos-btn-ghost"
                  disabled={saving || !settings}
                  onClick={() => {
                    if (!settings) return;
                    const days = settings.backupRetentionDays;
                    const max = settings.backupMaxCount;
                    void save({
                      ...settings,
                      backupRetentionDays:
                        days != null && Number.isFinite(days) && days > 0
                          ? Math.floor(days)
                          : null,
                      backupMaxCount:
                        max != null && Number.isFinite(max) && max > 0
                          ? Math.floor(max)
                          : null,
                    });
                  }}
                >
                  {t("settings.saveRetention")}
                </button>
                <button
                  type="button"
                  className="macos-btn-ghost"
                  disabled={cleanupBusy}
                  onClick={() => void runCleanup()}
                >
                  {cleanupBusy ? t("settings.cleaning") : t("settings.cleanNow")}
                </button>
              </div>
            </section>
            <section className="macos-card mb-6 p-4">
              <h3 className="macos-section-title">{t("settings.updates")}</h3>
              <p className="mt-2 text-[12px] text-ink-3">{t("settings.updatesHint")}</p>
              <button
                type="button"
                className="macos-btn-ghost mt-3"
                disabled={updateBusy}
                onClick={() => void checkForUpdates()}
              >
                {updateBusy ? t("settings.checking") : t("settings.checkUpdate")}
              </button>
              {updateMessage && (
                <p className="mt-2 text-[12px] text-ink-2">{updateMessage}</p>
              )}
            </section>
            <section className="macos-card p-4">
              <h3 className="macos-section-title">{t("settings.appData")}</h3>
              <p className="mt-2 text-[12px] text-ink-3">{t("settings.appDataHint")}</p>
              <p className="mt-2 break-all font-mono text-[12px] text-ink-2">
                {paths?.appDataDir ?? "—"}
              </p>
              <button
                type="button"
                className="macos-btn-ghost mt-3"
                disabled={!paths}
                onClick={() => paths && void api.revealPath(paths.appDataDir)}
              >
                {t("settings.openInFileManager")}
              </button>
            </section>
          </>
        )}
      </div>
    </section>
  );
}
