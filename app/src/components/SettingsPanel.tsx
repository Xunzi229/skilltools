import { useEffect, useState } from "react";
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
import {
  DEFAULT_PREVIEW_FONT_FAMILY,
  DEFAULT_PREVIEW_FONT_SIZE,
  PREVIEW_FONT_OPTIONS,
  PREVIEW_FONT_SIZE_OPTIONS,
  applyPreviewTypography,
} from "../utils/previewTypography";

interface SettingsPanelProps {
  api: SkillApi;
  onSettingsSaved: () => void;
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

export function SettingsPanel({ api, onSettingsSaved }: SettingsPanelProps) {
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [paths, setPaths] = useState<AppPathsInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<CommandError | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [cleanupBusy, setCleanupBusy] = useState(false);
  const [updateBusy, setUpdateBusy] = useState(false);
  const [updateMessage, setUpdateMessage] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void Promise.all([api.getSettings(), api.getAppPaths()])
      .then(([nextSettings, nextPaths]) => {
        if (cancelled) return;
        setSettings(nextSettings);
        setPaths(nextPaths);
        applyPreviewTypography(nextSettings);
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(asCommandError(err, "加载设置失败"));
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
    try {
      const saved = await api.saveSettings(next);
      setSettings(saved);
      setPaths(await api.getAppPaths());
      document.documentElement.dataset.theme = saved.theme;
      applyPreviewTypography(saved);
      setMessage("设置已保存");
      onSettingsSaved();
    } catch (err: unknown) {
      setError(asCommandError(err, "保存设置失败"));
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
    const selected = await pickDirectory(`选择 ${providerLabels[provider]} Skill 目录`);
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
      setMessage(`已清理 ${deleted} 条备份`);
      onSettingsSaved();
    } catch (err: unknown) {
      setError(asCommandError(err, "清理备份失败"));
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
        setUpdateMessage(`已是最新版本（${APP_VERSION}）`);
        return;
      }
      const ok = window.confirm(
        `发现新版本 ${update.version}。\n\n${update.body ?? ""}\n\n立即下载并安装？\n（macOS 未签名时可能受 Gatekeeper 限制）`,
      );
      if (!ok) {
        setUpdateMessage(`已发现 ${update.version}，已取消安装`);
        return;
      }
      await update.downloadAndInstall();
      setUpdateMessage("更新已安装，即将重启…");
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
      aria-label="设置"
    >
      <header className="shrink-0 border-b border-line-strong px-6 pt-5 pb-4">
        <h2 className="m-0 text-[28px] font-bold text-ink">设置</h2>
        <p className="mt-2 text-[14px] text-ink-2">
          主题、预览字体、路径、备份策略与更新（v{APP_VERSION}）。安装健康见「安装」页。
        </p>
      </header>
      <div className="min-h-0 flex-1 overflow-auto px-6 py-5">
        {loading ? (
          <p className="text-[13px] text-ink-3">正在加载设置…</p>
        ) : (
          <>
            {error && (
              <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[12px] text-red-700">
                {error.message}
              </div>
            )}
            {message && (
              <div className="mb-4 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-[12px] text-emerald-700">
                {message}
              </div>
            )}
            <section className="mb-8">
              <h3 className="m-0 text-[15px] font-semibold text-ink">主题</h3>
              <div className="mt-3 flex gap-2">
                {(["light", "dark"] as const).map((theme) => (
                  <button
                    key={theme}
                    type="button"
                    disabled={saving}
                    className={[
                      "rounded-lg border px-3 py-1.5 text-[13px]",
                      settings?.theme === theme
                        ? "border-brand bg-brand text-white"
                        : "border-line text-ink hover:bg-hover",
                    ].join(" ")}
                    onClick={() => setTheme(theme)}
                  >
                    {theme === "light" ? "浅色" : "深色"}
                  </button>
                ))}
              </div>
            </section>
            <section className="mb-8">
              <h3 className="m-0 text-[15px] font-semibold text-ink">预览字体</h3>
              <p className="mt-2 text-[12px] text-ink-3">
                用于文件预览与编辑区的字体类型和字号。
              </p>
              <div className="mt-3 flex flex-wrap gap-4">
                <label className="flex flex-col gap-1 text-[12px] text-ink-2">
                  字体类型
                  <select
                    className="min-w-[200px] rounded-lg border border-line bg-panel px-3 py-1.5 text-[13px] text-ink"
                    value={settings?.previewFontFamily || DEFAULT_PREVIEW_FONT_FAMILY}
                    disabled={saving || !settings}
                    onChange={(event) => {
                      if (!settings) return;
                      void save({
                        ...settings,
                        previewFontFamily: event.target.value,
                      });
                    }}
                    style={{
                      fontFamily: `"${settings?.previewFontFamily || DEFAULT_PREVIEW_FONT_FAMILY}"`,
                    }}
                  >
                    {PREVIEW_FONT_OPTIONS.map((font) => (
                      <option
                        key={font.family}
                        value={font.family}
                        style={{ fontFamily: `"${font.family}"` }}
                      >
                        {font.label}
                      </option>
                    ))}
                    {settings?.previewFontFamily &&
                      !PREVIEW_FONT_OPTIONS.some(
                        (font) => font.family === settings.previewFontFamily,
                      ) && (
                        <option value={settings.previewFontFamily}>
                          {settings.previewFontFamily}
                        </option>
                      )}
                  </select>
                </label>
                <label className="flex flex-col gap-1 text-[12px] text-ink-2">
                  字号
                  <select
                    className="rounded-lg border border-line bg-panel px-3 py-1.5 text-[13px] text-ink"
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
                className="mt-3 rounded-lg border border-line px-3 py-2 text-ink-2"
                style={{
                  fontFamily: `"${settings?.previewFontFamily || DEFAULT_PREVIEW_FONT_FAMILY}"`,
                  fontSize: `${settings?.previewFontSize || DEFAULT_PREVIEW_FONT_SIZE}px`,
                }}
              >
                预览效果：The quick brown fox 中文预览 0123456789
              </p>
            </section>
            <section className="mb-8">
              <div className="flex items-center justify-between gap-3">
                <h3 className="m-0 text-[15px] font-semibold text-ink">Skill 根目录</h3>
                <button
                  type="button"
                  className="rounded-lg border border-line px-2.5 py-1 text-[12px] text-ink-2 hover:bg-hover disabled:opacity-55"
                  disabled={saving}
                  onClick={resetAllRoots}
                >
                  全部重置为默认
                </button>
              </div>
              <ul className="mt-3 flex list-none flex-col gap-3 p-0">
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
                    <li
                      key={provider}
                      className="rounded-lg border border-line px-3 py-3"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <strong className="text-[13px] text-ink">
                          {providerLabels[provider]}
                          {overridden ? (
                            <span className="ml-2 text-[11px] font-normal text-brand">
                              已自定义
                            </span>
                          ) : null}
                        </strong>
                        <div className="flex gap-2">
                          <button
                            type="button"
                            className="rounded border border-line px-2 py-1 text-[12px] hover:bg-hover disabled:opacity-55"
                            disabled={saving}
                            onClick={() => void setRoot(provider)}
                          >
                            浏览…
                          </button>
                          <button
                            type="button"
                            className="rounded border border-line px-2 py-1 text-[12px] hover:bg-hover disabled:opacity-55"
                            disabled={saving || !overridden}
                            onClick={() => resetRoot(provider)}
                          >
                            重置
                          </button>
                          <button
                            type="button"
                            className="rounded border border-line px-2 py-1 text-[12px] hover:bg-hover"
                            disabled={!current}
                            onClick={() => current && void api.revealPath(current)}
                          >
                            打开
                          </button>
                        </div>
                      </div>
                      <p className="mt-2 break-all font-mono text-[12px] text-ink-2">
                        {current ?? "—"}
                      </p>
                      {overridden && (
                        <p className="mt-1 text-[11px] text-ink-3">默认：{defaults}</p>
                      )}
                    </li>
                  );
                })}
              </ul>
            </section>
            <section className="mb-8">
              <h3 className="m-0 text-[15px] font-semibold text-ink">备份保留</h3>
              <p className="mt-2 text-[12px] text-ink-3">
                留空表示不按该维度清理。启动时会静默执行一次。
              </p>
              <div className="mt-3 flex flex-wrap gap-4">
                <label className="flex flex-col gap-1 text-[12px] text-ink-2">
                  保留天数
                  <input
                    type="number"
                    min={1}
                    className="w-28 rounded border border-line bg-panel px-2 py-1.5 text-[13px] text-ink"
                    value={settings?.backupRetentionDays ?? ""}
                    placeholder="永不"
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
                  最大条数
                  <input
                    type="number"
                    min={1}
                    className="w-28 rounded border border-line bg-panel px-2 py-1.5 text-[13px] text-ink"
                    value={settings?.backupMaxCount ?? ""}
                    placeholder="不限"
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
                  className="rounded-lg border border-line px-3 py-1.5 text-[12px] hover:bg-hover disabled:opacity-55"
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
                  保存保留策略
                </button>
                <button
                  type="button"
                  className="rounded-lg border border-line px-3 py-1.5 text-[12px] hover:bg-hover disabled:opacity-55"
                  disabled={cleanupBusy}
                  onClick={() => void runCleanup()}
                >
                  {cleanupBusy ? "清理中…" : "立即清理"}
                </button>
              </div>
            </section>
            <section className="mb-8">
              <h3 className="m-0 text-[15px] font-semibold text-ink">应用更新</h3>
              <p className="mt-2 text-[12px] text-ink-3">
                从 GitHub Releases 检查更新。Windows 优先可用；macOS 无签名时下载后可能受
                Gatekeeper 限制。
              </p>
              <button
                type="button"
                className="mt-3 rounded-lg border border-line px-3 py-1.5 text-[12px] hover:bg-hover disabled:opacity-55"
                disabled={updateBusy}
                onClick={() => void checkForUpdates()}
              >
                {updateBusy ? "检查中…" : "检查更新"}
              </button>
              {updateMessage && (
                <p className="mt-2 text-[12px] text-ink-2">{updateMessage}</p>
              )}
            </section>
            <section>
              <h3 className="m-0 text-[15px] font-semibold text-ink">应用数据</h3>
              <p className="mt-2 text-[12px] text-ink-3">
                标识符 com.skilltools.manager；数据目录由系统 appDataDir 决定。
              </p>
              <p className="mt-2 break-all font-mono text-[12px] text-ink-2">
                {paths?.appDataDir ?? "—"}
              </p>
              <button
                type="button"
                className="mt-3 rounded-lg border border-line px-3 py-1.5 text-[12px] hover:bg-hover"
                disabled={!paths}
                onClick={() => paths && void api.revealPath(paths.appDataDir)}
              >
                在文件管理器中打开
              </button>
            </section>
          </>
        )}
      </div>
    </section>
  );
}
