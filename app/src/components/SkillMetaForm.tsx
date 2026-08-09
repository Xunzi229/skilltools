import { useEffect, useState } from "react";

interface SkillMetaFormProps {
  name: string;
  description: string;
  busy?: boolean;
  onSave: (name: string, description: string) => Promise<void>;
}

export function SkillMetaForm({
  name,
  description,
  busy = false,
  onSave,
}: SkillMetaFormProps) {
  const [draftName, setDraftName] = useState(name);
  const [draftDescription, setDraftDescription] = useState(description);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    setDraftName(name);
    setDraftDescription(description);
    setMessage(null);
  }, [name, description]);

  return (
    <form
      className="mb-4 rounded-lg border border-line px-3 py-3"
      onSubmit={(event) => {
        event.preventDefault();
        setMessage(null);
        void onSave(draftName.trim(), draftDescription.trim())
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
      <h4 className="m-0 text-[13px] font-semibold text-ink">SKILL.md 元数据</h4>
      <label className="mt-2 block text-[12px] text-ink-3">
        name
        <input
          className="mt-1 w-full rounded border border-line px-2 py-1.5 text-[13px] text-ink"
          value={draftName}
          disabled={busy}
          onChange={(event) => setDraftName(event.target.value)}
        />
      </label>
      <label className="mt-2 block text-[12px] text-ink-3">
        description
        <textarea
          className="mt-1 w-full rounded border border-line px-2 py-1.5 text-[13px] text-ink"
          rows={3}
          value={draftDescription}
          disabled={busy}
          onChange={(event) => setDraftDescription(event.target.value)}
        />
      </label>
      <div className="mt-2 flex items-center gap-2">
        <button
          type="submit"
          className="rounded-lg border border-line px-3 py-1.5 text-[12px] hover:bg-hover disabled:opacity-55"
          disabled={busy || !draftName.trim()}
        >
          保存元数据
        </button>
        {message && <span className="text-[12px] text-ink-2">{message}</span>}
      </div>
    </form>
  );
}
