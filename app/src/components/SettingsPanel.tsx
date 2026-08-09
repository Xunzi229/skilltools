import { useEffect, useState } from "react";
import type { SkillApi } from "../api/skillApi";
import type {
  AppPathsInfo,
  AppSettings,
  CommandError,
  Provider,
  ThemePreference,
} from "../model/skill";
import { pickDirectory } from "../utils/dialogs";

interface SettingsPanelProps {
  api: SkillApi;
  onSettingsSaved: () => void;
}

const providerLabels: Record<Provider, string> = {
  cursor: "Cursor",
  claude: "Claude",
  codex: "Codex",
};

export function SettingsPanel({ api, onSettingsSaved }: SettingsPanelProps) {
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [paths, setPaths] = useState<AppPathsInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<CommandError | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void Promise.all([api.getSettings(), api.getAppPaths()])
      .then(([nextSettings, nextPaths]) => {
        if (cancelled) return;
        setSettings(nextSettings);
        setPaths(nextPaths);
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(
            typeof err === "object" && err && "message" in err
              ? (err as CommandError)
              : { code: "UNKNOWN", message: "加载设置失败" },
          );
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
      setMessage("设置已保存");
      onSettingsSaved();
    } catch (err: unknown) {
      setError(
        typeof err === "object" && err && "message" in err
          ? (err as CommandError)
          : { code: "UNKNOWN", message: "保存设置失败" },
      );
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

  return (
    <section
      className="col-span-2 flex h-full min-h-0 min-w-0 flex-col overflow-hidden bg-panel"
      aria-label="设置"
    >
      <header className="shrink-0 border-b border-line-strong px-6 pt-5 pb-4">
        <h2 className="m-0 text-[28px] font-bold text-ink">设置</h2>
        <p className="mt-2 text-[14px] text-ink-2">主题与本机 Skill 根目录。</p>
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
            <section>
              <h3 className="m-0 text-[15px] font-semibold text-ink">应用数据</h3>
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
