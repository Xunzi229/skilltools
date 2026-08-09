import { useEffect, useState } from "react";
import type { SkillApi } from "../api/skillApi";
import type { TranslatePreview, TranslateSkillSource } from "../model/skill";
import { errorMessage } from "../utils/errors";
import { isTranslateConfigured } from "../utils/translateSettings";
import { MarkdownViewer } from "./MarkdownViewer";

interface TranslatePreviewButtonProps {
  api: SkillApi;
  source: TranslateSkillSource;
  skillId: string;
  disabled?: boolean;
}

export function TranslatePreviewButton({
  api,
  source,
  skillId,
  disabled = false,
}: TranslatePreviewButtonProps) {
  const [configured, setConfigured] = useState(false);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<TranslatePreview | null>(null);

  useEffect(() => {
    let cancelled = false;
    void api
      .getSettings()
      .then((settings) => {
        if (!cancelled) setConfigured(isTranslateConfigured(settings));
      })
      .catch(() => {
        if (!cancelled) setConfigured(false);
      });
    return () => {
      cancelled = true;
    };
  }, [api]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !loading) {
        setOpen(false);
        setError(null);
        setResult(null);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [loading, open]);

  if (!configured) {
    return null;
  }

  const runTranslate = async () => {
    setOpen(true);
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const preview = await api.previewTranslateSkill(source, skillId);
      setResult(preview);
    } catch (err: unknown) {
      setError(errorMessage(err, "翻译失败"));
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <button
        type="button"
        className="macos-btn-ghost"
        disabled={disabled || loading}
        title="使用设置中的模型翻译预览（不修改原文件）"
        onClick={() => void runTranslate()}
      >
        {loading ? "翻译中…" : "翻译"}
      </button>
      {open ? (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/30 p-4 backdrop-blur-[2px]">
          <div
            className="macos-sheet flex h-[min(85vh,720px)] w-full max-w-3xl flex-col overflow-hidden p-0"
            role="dialog"
            aria-modal="true"
            aria-labelledby="translate-preview-title"
          >
            <header className="flex shrink-0 items-start justify-between gap-3 border-b border-line-strong px-5 py-4">
              <div className="min-w-0">
                <h2
                  id="translate-preview-title"
                  className="m-0 text-[15px] font-semibold tracking-tight text-ink"
                >
                  翻译预览
                </h2>
                <p className="mt-1 text-[12px] leading-5 text-ink-3">
                  仅预览，不写入原文件。范围：SKILL.md 与 README*.md
                  {result
                    ? ` · ${result.sourceFiles.join("、")} → ${result.targetLang}`
                    : null}
                  {result?.truncated ? " · 源文本已截断" : null}
                </p>
              </div>
              <button
                type="button"
                className="macos-btn-ghost macos-btn-sm shrink-0"
                disabled={loading}
                onClick={() => {
                  setOpen(false);
                  setError(null);
                  setResult(null);
                }}
              >
                关闭
              </button>
            </header>
            <div className="min-h-0 flex-1 overflow-hidden">
              <MarkdownViewer
                file={
                  result
                    ? {
                        relativePath: "翻译预览.md",
                        mediaType: "markdown",
                        content: result.markdown,
                        message: null,
                      }
                    : null
                }
                loading={loading}
                errorMessage={error}
                editable={false}
              />
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
