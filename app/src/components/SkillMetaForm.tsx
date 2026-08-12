import { useEffect, useState } from "react";
import { t, useI18n } from "../i18n";
import {
  getStandardFrontmatterFields,
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

function buildDraft(markdown: string, name: string, description: string) {
  const fields = getStandardFrontmatterFields();
  const parsed = parseFrontmatterFields(markdown);
  const standard: Record<string, string> = {};
  for (const field of fields) {
    standard[field.key] = parsed[field.key] ?? "";
  }
  if (!standard.name) standard.name = name;
  if (!standard.description) standard.description = description;

  // 仅展示已有值的可选标准字段
  const visibleOptional: string[] = fields
    .filter((field) => !field.required && (parsed[field.key] ?? "").trim() !== "")
    .map((field) => field.key);

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
  const defs = getStandardFrontmatterFields();
  const fields: Record<string, string> = {};
  for (const field of defs.filter((item) => item.required)) {
    fields[field.key] = (standard[field.key] ?? "").trim();
  }
  for (const key of visibleOptional) {
    const value = (standard[key] ?? "").trim();
    if (value) {
      fields[key] = standard[key] ?? "";
    }
  }

  if (!fields.name?.trim()) {
    return t("metaForm.nameRequired");
  }
  if (!fields.description?.trim()) {
    return t("metaForm.descriptionRequired");
  }

  const seen = new Set<string>(Object.keys(fields));
  for (const row of custom) {
    const key = row.key.trim();
    if (!key && !row.value.trim()) {
      continue;
    }
    if (!key) {
      return t("metaForm.customKeyRequired");
    }
    if (STANDARD_FRONTMATTER_KEYS.has(key) || seen.has(key)) {
      return t("metaForm.duplicateKey", { key });
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
  const { t } = useI18n();
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
            className="macos-btn-ghost macos-btn-sm"
            disabled={busy}
            aria-label={t("metaForm.removeField", { label })}
            onClick={onRemove}
          >
            {t("metaForm.remove")}
          </button>
        )}
      </div>
      {multiline ? (
        <textarea
          id={`meta-${fieldKey}`}
          className="macos-input mt-1 h-auto w-full py-1.5 font-mono text-[12px]"
          rows={fieldKey === "description" ? 3 : 2}
          value={value}
          disabled={busy}
          onChange={(event) => onChange(event.target.value)}
        />
      ) : (
        <input
          id={`meta-${fieldKey}`}
          className="macos-input mt-1 w-full font-mono text-[12px]"
          value={value}
          disabled={busy}
          onChange={(event) => onChange(event.target.value)}
        />
      )}
    </div>
  );
}

function draftsEqual(
  left: ReturnType<typeof buildDraft>,
  right: { standard: Record<string, string>; custom: CustomRow[]; visibleOptional: string[] },
) {
  if (left.visibleOptional.join("\0") !== right.visibleOptional.join("\0")) return false;
  for (const field of getStandardFrontmatterFields()) {
    if ((left.standard[field.key] ?? "") !== (right.standard[field.key] ?? "")) {
      return false;
    }
  }
  if (left.custom.length !== right.custom.length) return false;
  return left.custom.every(
    (row, index) =>
      row.key === right.custom[index]?.key && row.value === right.custom[index]?.value,
  );
}

export function SkillMetaForm({
  markdown,
  name,
  description,
  busy = false,
  onSave,
}: SkillMetaFormProps) {
  const { t } = useI18n();
  const fields = getStandardFrontmatterFields();
  const requiredFields = fields.filter((field) => field.required);
  const optionalFields = fields.filter((field) => !field.required);
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
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const draft = buildDraft(markdown, name, description);
    setStandard(draft.standard);
    setCustom(draft.custom);
    setVisibleOptional(draft.visibleOptional);
    setAddChoice("");
    setMessage(null);
    setExpanded(false);
    setSaving(false);
  }, [markdown, name, description]);

  const baseline = buildDraft(markdown, name, description);
  const dirty = !draftsEqual(baseline, { standard, custom, visibleOptional });
  const formBusy = busy || saving;

  const availableOptional = optionalFields.filter(
    (field) => !visibleOptional.includes(field.key),
  );

  const resetDraft = () => {
    const draft = buildDraft(markdown, name, description);
    setStandard(draft.standard);
    setCustom(draft.custom);
    setVisibleOptional(draft.visibleOptional);
    setAddChoice("");
    setMessage(null);
  };

  const applyDraft = () => {
    setMessage(null);
    const collected = collectFields(standard, visibleOptional, custom);
    if (typeof collected === "string") {
      setMessage(collected);
      setExpanded(true);
      return;
    }
    setSaving(true);
    void onSave(collected)
      .then(() => setMessage(t("metaForm.saved")))
      .catch((error: unknown) => {
        setMessage(
          typeof error === "object" &&
            error &&
            "message" in error &&
            typeof (error as { message: unknown }).message === "string"
            ? (error as { message: string }).message
            : t("metaForm.saveFailed"),
        );
      })
      .finally(() => setSaving(false));
  };

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
      className="macos-card mb-4 shrink-0 px-3 py-3"
      onSubmit={(event) => {
        event.preventDefault();
        applyDraft();
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
          <h4 className="m-0 text-[13px] font-semibold text-ink">{t("metaForm.title")}</h4>
          {!expanded && (
            <span className="truncate text-[11px] text-ink-3">
              {dirty ? t("metaForm.dirty") : t("metaForm.expandHint")}
            </span>
          )}
        </button>
        {dirty && (
          <div className="flex shrink-0 gap-2">
            <button
              type="button"
              className="macos-btn-ghost macos-btn-sm"
              disabled={formBusy}
              onClick={resetDraft}
            >
              {t("metaForm.cancel")}
            </button>
            <button
              type="submit"
              className="macos-btn-primary macos-btn-sm"
              disabled={formBusy || !(standard.name ?? "").trim()}
            >
              {saving ? t("metaForm.applying") : t("metaForm.apply")}
            </button>
          </div>
        )}
      </div>

      {expanded && (
        <>
      <p className="mt-1 mb-0 text-[11px] text-ink-3">
        {t("metaForm.fieldsHint")}
      </p>

      <div className="mt-2 grid gap-2">
        {requiredFields.map((field) => (
          <FieldEditor
            key={field.key}
            fieldKey={field.key}
            label={field.label}
            required
            multiline={field.multiline}
            hint={"hint" in field ? field.hint : undefined}
            value={standard[field.key] ?? ""}
            busy={formBusy}
            onChange={(value) =>
              setStandard((current) => ({ ...current, [field.key]: value }))
            }
          />
        ))}

        {visibleOptional.map((key) => {
          const field = optionalFields.find((item) => item.key === key);
          if (!field) return null;
          return (
            <FieldEditor
              key={field.key}
              fieldKey={field.key}
              label={field.label}
              multiline={field.multiline}
              hint={"hint" in field ? field.hint : undefined}
              value={standard[field.key] ?? ""}
              busy={formBusy}
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
                className="macos-input w-[28%] font-mono text-[12px]"
                placeholder={t("metaForm.keyPlaceholder")}
                aria-label={t("metaForm.keyAria")}
                value={row.key}
                disabled={formBusy}
                onChange={(event) =>
                  setCustom((current) =>
                    current.map((item) =>
                      item.id === row.id ? { ...item, key: event.target.value } : item,
                    ),
                  )
                }
              />
              <input
                className="macos-input min-w-0 flex-1 font-mono text-[12px]"
                placeholder={t("metaForm.valuePlaceholder")}
                aria-label={t("metaForm.valueAria")}
                value={row.value}
                disabled={formBusy}
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
                className="macos-btn-ghost macos-btn-sm shrink-0"
                disabled={formBusy}
                aria-label={t("metaForm.deleteFieldAria", {
                  key: row.key || t("metaForm.unnamed"),
                })}
                onClick={() =>
                  setCustom((current) => current.filter((item) => item.id !== row.id))
                }
              >
                {t("metaForm.remove")}
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-line pt-3">
        <label className="flex min-w-0 flex-1 items-center gap-2 text-[12px] text-ink-3">
          <span className="shrink-0">{t("metaForm.add")}</span>
          <select
            className="macos-select macos-select-sm min-w-0 flex-1"
            aria-label={t("metaForm.addAria")}
            value={addChoice}
            disabled={formBusy}
            onChange={(event) => {
              const value = event.target.value;
              setAddChoice(value);
              addField(value);
            }}
          >
            <option value="">{t("metaForm.selectField")}</option>
            {availableOptional.map((field) => (
              <option key={field.key} value={field.key}>
                {field.label}
              </option>
            ))}
            <option value="__custom__">{t("metaForm.customKv")}</option>
          </select>
        </label>
        {message && <span className="text-[12px] text-ink-2">{message}</span>}
      </div>
        </>
      )}
    </form>
  );
}
