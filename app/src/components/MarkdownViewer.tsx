import { useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";
import type { FileContent } from "../model/skill";
import { stripMarkdownFrontmatter } from "../utils/skillDisplay";

interface MarkdownViewerProps {
  file: FileContent | null;
  loading: boolean;
  errorMessage: string | null;
  editable?: boolean;
  saving?: boolean;
  onSave?: (content: string) => Promise<void> | void;
}

export function MarkdownViewer({
  file,
  loading,
  errorMessage,
  editable = false,
  saving = false,
  onSave,
}: MarkdownViewerProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    setEditing(false);
    setDraft(file?.content ?? "");
    setSaveError(null);
  }, [file?.relativePath, file?.content]);

  const canEdit =
    editable &&
    !!file &&
    (file.mediaType === "markdown" || file.mediaType === "text") &&
    file.content !== null;

  const markdown =
    file?.mediaType === "markdown"
      ? stripMarkdownFrontmatter(file.content ?? "")
      : "";

  return (
    <article className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-panel">
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-line-strong px-3 py-2 text-[12px] font-medium text-ink-2">
        <span>{file?.relativePath ?? "SKILL.md"}</span>
        {canEdit ? (
          <div className="flex gap-2">
            {editing ? (
              <>
                <button
                  type="button"
                  className="rounded border border-line px-2 py-0.5 text-[11px] hover:bg-hover disabled:opacity-55"
                  disabled={saving}
                  onClick={() => {
                    setEditing(false);
                    setDraft(file?.content ?? "");
                    setSaveError(null);
                  }}
                >
                  取消
                </button>
                <button
                  type="button"
                  className="rounded bg-brand px-2 py-0.5 text-[11px] text-white disabled:opacity-55"
                  disabled={saving}
                  onClick={() => {
                    if (!onSave) return;
                    setSaveError(null);
                    void Promise.resolve(onSave(draft)).catch((error: unknown) => {
                      const message =
                        typeof error === "object" &&
                        error &&
                        "message" in error &&
                        typeof (error as { message: unknown }).message === "string"
                          ? (error as { message: string }).message
                          : "保存失败";
                      setSaveError(message);
                    });
                  }}
                >
                  {saving ? "保存中…" : "保存"}
                </button>
              </>
            ) : (
              <button
                type="button"
                className="rounded border border-line px-2 py-0.5 text-[11px] hover:bg-hover"
                onClick={() => {
                  setDraft(file?.content ?? "");
                  setEditing(true);
                }}
              >
                编辑
              </button>
            )}
          </div>
        ) : null}
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        {loading ? (
          <p className="px-4 py-3 text-[13px] text-ink-3">正在加载文件…</p>
        ) : errorMessage ? (
          <p className="px-4 py-3 text-[13px] text-red-600">{errorMessage}</p>
        ) : saveError ? (
          <p className="px-4 py-3 text-[13px] text-red-600">{saveError}</p>
        ) : !file ? (
          <p className="px-4 py-3 text-[13px] text-ink-3">选择文件以预览</p>
        ) : editing ? (
          <textarea
            className="h-full min-h-[240px] w-full resize-none border-0 bg-panel px-4 py-3 font-mono text-[12px] leading-5 text-ink outline-none"
            value={draft}
            disabled={saving}
            onChange={(event) => setDraft(event.target.value)}
            aria-label="编辑文件内容"
          />
        ) : file.mediaType === "unsupported" ? (
          <p className="px-4 py-3 text-[13px] text-ink-3">
            {file.message ?? "不支持预览"}
          </p>
        ) : file.mediaType === "markdown" ? (
          <div className="markdown-body">
            <ReactMarkdown components={{ img: () => null }}>{markdown}</ReactMarkdown>
          </div>
        ) : (
          <pre className="m-0 overflow-auto px-4 py-3 font-mono text-[12px] leading-5 text-ink whitespace-pre-wrap">
            {file.content ?? ""}
          </pre>
        )}
      </div>
    </article>
  );
}
