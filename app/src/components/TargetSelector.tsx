import { useEffect, useMemo, useState } from "react";
import { useI18n } from "../i18n";
import type { Provider } from "../model/skill";

interface TargetSelectorProps {
  installedProviders: Provider[];
  disabled?: boolean;
  onApply: (nextProviders: Provider[]) => Promise<void>;
}

const targets: Array<{
  id: Provider;
  label: string;
  mark: string;
  markClass: string;
}> = [
  {
    id: "cursor",
    label: "Cursor",
    mark: "C",
    markClass: "bg-[#2563eb] text-white",
  },
  {
    id: "claude",
    label: "Claude",
    mark: "A",
    markClass: "bg-[#d97706] text-white",
  },
  {
    id: "codex",
    label: "Codex",
    mark: "X",
    markClass: "bg-[#0f766e] text-white",
  },
];

function sameProviders(left: Provider[], right: Provider[]) {
  if (left.length !== right.length) return false;
  const rightSet = new Set(right);
  return left.every((item) => rightSet.has(item));
}

function providersKey(providers: Provider[]) {
  return [...providers].sort().join(",");
}

export function TargetSelector({
  installedProviders,
  disabled = false,
  onApply,
}: TargetSelectorProps) {
  const { t } = useI18n();
  const [draft, setDraft] = useState<Provider[]>(installedProviders);
  const [applying, setApplying] = useState(false);
  const installedKey = useMemo(
    () => providersKey(installedProviders),
    [installedProviders],
  );

  // 仅在已安装集合「内容」变化或应用结束时同步草稿；用 installedKey 忽略父组件数组引用抖动。
  useEffect(() => {
    if (!applying) {
      setDraft(installedProviders);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- sync by installedKey, not array identity
  }, [installedKey, applying]);

  const dirty = useMemo(
    () => !sameProviders(draft, installedProviders),
    [draft, installedProviders],
  );
  const busy = disabled || applying;

  const resetDraft = () => {
    setDraft(installedProviders);
  };

  return (
    <section aria-label={t("targetSelector.region")}>
      <div className="mb-2 flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <h3 className="text-[13px] font-semibold text-ink">{t("targetSelector.title")}</h3>
          <p className="mt-0.5 text-[12px] text-ink-2">{t("targetSelector.subtitle")}</p>
        </div>
        {dirty && (
          <div className="flex shrink-0 items-center gap-2">
            <button
              type="button"
              className="macos-btn-ghost macos-btn-sm"
              disabled={disabled}
              onClick={resetDraft}
            >
              {t("targetSelector.cancel")}
            </button>
            <button
              type="button"
              className="macos-btn-primary macos-btn-sm"
              disabled={busy}
              onClick={() => {
                setApplying(true);
                void onApply(draft)
                  .catch(() => undefined)
                  .finally(() => setApplying(false));
              }}
            >
              {applying ? t("targetSelector.applying") : t("targetSelector.apply")}
            </button>
          </div>
        )}
      </div>
      <div className="flex flex-wrap gap-2.5">
        {targets.map(({ id, label, mark, markClass }) => {
          const selected = draft.includes(id);
          const committed = installedProviders.includes(id);
          return (
            <label
              key={id}
              className={[
                "macos-selectable h-14 w-[200px] cursor-pointer",
                busy ? "opacity-60" : "",
              ].join(" ")}
              data-selected={selected ? "true" : undefined}
            >
              <input
                type="checkbox"
                className="size-3.5 accent-[var(--color-brand)]"
                aria-label={t("targetSelector.installAria", { label })}
                checked={selected}
                disabled={busy}
                onChange={() => {
                  setDraft((current) =>
                    current.includes(id)
                      ? current.filter((item) => item !== id)
                      : [...current, id],
                  );
                }}
              />
              <span
                className={`grid size-8 shrink-0 place-items-center rounded-[9px] text-[13px] font-bold ${markClass}`}
                aria-hidden="true"
              >
                {mark}
              </span>
              <span className="min-w-0 leading-tight">
                <strong className="block text-[13px] font-semibold text-ink">{label}</strong>
                <em className="block text-[11px] not-italic text-ink-3">
                  {committed
                    ? t("targetSelector.installed")
                    : t("targetSelector.uninstalled")}
                </em>
              </span>
            </label>
          );
        })}
      </div>
    </section>
  );
}
