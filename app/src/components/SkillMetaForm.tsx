import { useEffect, useState } from "react";
import {
  STANDARD_FRONTMATTER_FIELDS,
  STANDARD_FRONTMATTER_KEYS,
  customFrontmatterEntries,
  parseFrontmatterFields,
} from "../utils/skillFrontmatter";

interface SkillMetaFormProps {
  /** SKILL.md 全文，用于解析现有 frontmatter */
  markdown: string;
  /** 详情里已解析的 name/description，作为解析失败时的回退 */
  name: string;
  description: string;
  busy?: boolean;
  onSave: (fields: Record<string, string>) => Promise<void>;
}

type CustomRow = { id: string; key: string; value: string };

const REQUIRED_FIELDS = STANDARD_FRONTMATTER_FIELDS.filter((field) => field.required);
const OPTIONAL_FIELDS = STANDARD_FRONTMATTER_FIELDS.filter((field) => !field.required);

function buildDraft(markdown: string, name: string, description: string) {
  const parsed = parseFrontmatterFields(markdown);
  const standard: Record<string, string> = {};
  for (const field of STANDARD_FRONTMATTER_FIELDS) {
    standard[field.key] = parsed[field.key] ?? "";
  }
  if (!standard.name) standard.name = name;
  if (!standard.description) standard.description = description;

  // 仅展示已有值的可选标准字段
  const visibleOptional: string[] = OPTIONAL_FIELDS.filter(
    (field) => (parsed[field.key] ?? "").trim() !== "",
  ).map((field) => field.key);

  const custom: CustomRow[] = customFrontmatterEntries(parsed).map((entry, index) => ({
    id: `c-${index}-${entry.key}`,
    key: entry.key,
    value: entry.value,
  }));

  return { standard, custom, visibleOptional };
}

function collectFields(
  standard: Record<string, string>,
  visibleOptional: string[],
  custom: CustomRow[],
): Record<string, string> | string {
  const fields: Record<string, string> = {};
  for (const field of REQUIRED_FIELDS) {
    fields[field.key] = (standard[field.key] ?? "").trim();
  }
  for (const key of visibleOptional) {
    const value = (standard[key] ?? "").trim();
    if (value) {
      fields[key] = standard[key] ?? "";
    }
  }

  if (!fields.name?.trim()) {
    return "name 不能为空";
  }
  if (!fields.description?.trim()) {
    return "description 不能为空";
  }

  const seen = new Set<string>(Object.keys(fields));
  for (const row of custom) {
    const key = row.key.trim();
    if (!key && !row.value.trim()) {
      continue;
    }
    if (!key) {
      return "自定义字段的键名不能为空";
    }
    if (STANDARD_FRONTMATTER_KEYS.has(key) || seen.has(key)) {
      return `字段键重复：${key}`;
    }
    seen.add(key);
    fields[key] = row.value;
  }

  return fields;
}

function FieldEditor({
  fieldKey,
  label,
  required,
  multiline,
  hint,
  value,
  busy,
  onChange,
  onRemove,
}: {
  fieldKey: string;
  label: string;
  required?: boolean;
  multiline?: boolean;
  hint?: string;
  value: string;
  busy: boolean;
  onChange: (value: string) => void;
  onRemove?: () => void;
}) {
  return (
    <div className="block text-[12px] text-ink-3">
      <div className="flex items-baseline justify-between gap-2">
        <span className="inline-flex min-w-0 items-baseline gap-1">
          <label htmlFor={`meta-${fieldKey}`}>{label}</label>
          {required && <span className="text-red-500">*</span>}
          {hint && <span className="font-normal text-ink-3/80">· {hint}</span>}
        </span>
        {onRemove && (
          <button
            type="button"
            className="shrink-0 rounded border border-line px-1.5 py-0.5 text-[11px] text-ink-2 hover:bg-hover disabled:opacity-55"
            disabled={busy}
            aria-label={`移除字段 ${label}`}
            onClick={onRemove}
          >
            移除
          </button>
        )}
      </div>
      {multiline ? (
        <textarea
          id={`meta-${fieldKey}`}
          className="mt-1 w-full rounded border border-line px-2 py-1.5 font-mono text-[12px] text-ink"
          rows={fieldKey === "description" ? 3 : 2}
          value={value}
          disabled={busy}
          onChange={(event) => onChange(event.target.value)}
        />
      ) : (
        <input
          id={`meta-${fieldKey}`}
          className="mt-1 w-full rounded border border-line px-2 py-1.5 font-mono text-[12px] text-ink"
          value={value}
          disabled={busy}
          onChange={(event) => onChange(event.target.value)}
        />
      )}
    </div>
  );
}

export function SkillMetaForm({
  markdown,
  name,
  description,
  busy = false,
  onSave,
}: SkillMetaFormProps) {
  const [standard, setStandard] = useState(
    () => buildDraft(markdown, name, description).standard,
  );
  const [custom, setCustom] = useState(
    () => buildDraft(markdown, name, description).custom,
  );
  const [visibleOptional, setVisibleOptional] = useState<string[]>(
    () => buildDraft(markdown, name, description).visibleOptional,
  );
  const [addChoice, setAddChoice] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    const draft = buildDraft(markdown, name, description);
    setStandard(draft.standard);
    setCustom(draft.custom);
    setVisibleOptional(draft.visibleOptional);
    setAddChoice("");
    setMessage(null);
    setExpanded(false);
  }, [markdown, name, description]);

  const availableOptional = OPTIONAL_FIELDS.filter(
    (field) => !visibleOptional.includes(field.key),
  );

  const addField = (choice: string) => {
    if (!choice) return;
    if (choice === "__custom__") {
      setCustom((current) => [
        ...current,
        { id: `new-${Date.now()}`, key: "", value: "" },
      ]);
    } else if (!visibleOptional.includes(choice)) {
      setVisibleOptional((current) => [...current, choice]);
      setStandard((current) => ({ ...current, [choice]: current[choice] ?? "" }));
    }
    setAddChoice("");
  };

  return (
    <form
      className="mb-4 shrink-0 rounded-lg border border-line px-3 py-3"
      onSubmit={(event) => {
        event.preventDefault();
        setMessage(null);
        const collected = collectFields(standard, visibleOptional, custom);
        if (typeof collected === "string") {
          setMessage(collected);
          setExpanded(true);
          return;
        }
        void onSave(collected)
          .then(() => setMessage("元数据已保存"))
          .catch((error: unknown) => {
            setMessage(
              typeof error === "object" &&
                error &&
                "message" in error &&
                typeof (error as { message: unknown }).message === "string"
                ? (error as { message: string }).message
                : "保存失败",
            );
          });
      }}
    >
      <div className="flex items-center justify-between gap-2">
        <button
          type="button"
          className="flex min-w-0 flex-1 items-center gap-2 rounded-md text-left hover:bg-hover"
          aria-expanded={expanded}
          onClick={() => setExpanded((value) => !value)}
        >
          <span className="text-[12px] text-ink-3" aria-hidden="true">
            {expanded ? "▾" : "▸"}
          </span>
          <h4 className="m-0 text-[13px] font-semibold text-ink">SKILL.md 元数据</h4>
          {!expanded && (
            <span className="truncate text-[11px] text-ink-3">点击展开编辑</span>
          )}
        </button>
      </div>

      {expanded && (
        <>
      <p className="mt-1 mb-0 text-[11px] text-ink-3">
        默认仅显示已有字段；可通过下方「添加」扩展可选/自定义字段
      </p>

      <div className="mt-2 grid gap-2">
        {REQUIRED_FIELDS.map((field) => (
          <FieldEditor
            key={field.key}
            fieldKey={field.key}
            label={field.label}
            required
            multiline={field.multiline}
            hint={"hint" in field ? field.hint : undefined}
            value={standard[field.key] ?? ""}
            busy={busy}
            onChange={(value) =>
              setStandard((current) => ({ ...current, [field.key]: value }))
            }
          />
        ))}

        {visibleOptional.map((key) => {
          const field = OPTIONAL_FIELDS.find((item) => item.key === key);
          if (!field) return null;
          return (
            <FieldEditor
              key={field.key}
              fieldKey={field.key}
              label={field.label}
              multiline={field.multiline}
              hint={"hint" in field ? field.hint : undefined}
              value={standard[field.key] ?? ""}
              busy={busy}
              onChange={(value) =>
                setStandard((current) => ({ ...current, [field.key]: value }))
              }
              onRemove={() => {
                setVisibleOptional((current) => current.filter((item) => item !== key));
                setStandard((current) => ({ ...current, [key]: "" }));
              }}
            />
          );
        })}
      </div>

      {custom.length > 0 && (
        <ul className="mt-2 mb-0 flex list-none flex-col gap-2 p-0">
          {custom.map((row) => (
            <li key={row.id} className="flex items-start gap-2">
              <input
                className="w-[28%] rounded border border-line px-2 py-1.5 font-mono text-[12px] text-ink"
                placeholder="键"
                aria-label="自定义字段键"
                value={row.key}
                disabled={busy}
                onChange={(event) =>
                  setCustom((current) =>
                    current.map((item) =>
                      item.id === row.id ? { ...item, key: event.target.value } : item,
                    ),
                  )
                }
              />
              <input
                className="min-w-0 flex-1 rounded border border-line px-2 py-1.5 font-mono text-[12px] text-ink"
                placeholder="值"
                aria-label="自定义字段值"
                value={row.value}
                disabled={busy}
                onChange={(event) =>
                  setCustom((current) =>
                    current.map((item) =>
                      item.id === row.id ? { ...item, value: event.target.value } : item,
                    ),
                  )
                }
              />
              <button
                type="button"
                className="shrink-0 rounded border border-line px-2 py-1.5 text-[11px] text-ink-2 hover:bg-hover disabled:opacity-55"
                disabled={busy}
                aria-label={`删除字段 ${row.key || "未命名"}`}
                onClick={() =>
                  setCustom((current) => current.filter((item) => item.id !== row.id))
                }
              >
                移除
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-line pt-3">
        <label className="flex min-w-0 flex-1 items-center gap-2 text-[12px] text-ink-3">
          <span className="shrink-0">添加</span>
          <select
            className="min-w-0 flex-1 rounded border border-line bg-panel px-2 py-1.5 text-[12px] text-ink"
            aria-label="添加元数据字段"
            value={addChoice}
            disabled={busy}
            onChange={(event) => {
              const value = event.target.value;
              setAddChoice(value);
              addField(value);
            }}
          >
            <option value="">选择字段…</option>
            {availableOptional.map((field) => (
              <option key={field.key} value={field.key}>
                {field.label}
              </option>
            ))}
            <option value="__custom__">自定义键值…</option>
          </select>
        </label>
        <button
          type="submit"
          className="rounded-lg border border-line px-3 py-1.5 text-[12px] hover:bg-hover disabled:opacity-55"
          disabled={busy || !(standard.name ?? "").trim()}
        >
          保存元数据
        </button>
        {message && <span className="text-[12px] text-ink-2">{message}</span>}
      </div>
        </>
      )}
    </form>
  );
}
