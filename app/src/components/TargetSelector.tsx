import type { Provider } from "../model/skill";

interface TargetSelectorProps {
  installedProviders: Provider[];
  busy: boolean;
  onToggle: (provider: Provider, installed: boolean) => void;
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

export function TargetSelector({
  installedProviders,
  busy,
  onToggle,
}: TargetSelectorProps) {
  return (
    <section aria-label="安装目标">
      <div className="mb-2">
        <h3 className="text-[13px] font-semibold text-ink">安装目标</h3>
        <p className="mt-0.5 text-[12px] text-ink-2">选择要安装此 Skill 的工具目录</p>
      </div>
      <div className="flex flex-wrap gap-2.5">
        {targets.map(({ id, label, mark, markClass }) => {
          const installed = installedProviders.includes(id);
          return (
            <label
              key={id}
              className={[
                "macos-selectable h-14 w-[200px] cursor-pointer",
                busy ? "opacity-60" : "",
              ].join(" ")}
              data-selected={installed ? "true" : undefined}
            >
              <input
                type="checkbox"
                className="size-3.5 accent-[var(--color-brand)]"
                aria-label={`安装到 ${label}`}
                checked={installed}
                disabled={busy}
                onChange={() => onToggle(id, installed)}
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
                  {installed ? "已安装" : "未安装"}
                </em>
              </span>
            </label>
          );
        })}
      </div>
    </section>
  );
}
