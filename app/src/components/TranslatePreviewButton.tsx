import { useEffect, useRef, useState, type ReactNode } from "react";
import type { SkillApi } from "../api/skillApi";
import type { TranslatePreview, TranslateSkillSource } from "../model/skill";
import { errorMessage } from "../utils/errors";
import { MarkdownViewer } from "./MarkdownViewer";
import { useI18n } from "../i18n";

interface TranslatePreviewButtonProps {
  api: SkillApi;
  source: TranslateSkillSource;
  skillId: string;
  /** 当前选中的相对路径；未选中时按钮不可用 */
  relativePath: string | null;
  disabled?: boolean;
}

function TranslatingPanel() {
  const { t } = useI18n();
  return (
    <div
      className="translate-loading flex h-full min-h-0 flex-col items-center justify-center gap-5 px-6 py-10"
      aria-busy="true"
      aria-live="polite"
    >
      <div className="translate-loading-orb" aria-hidden="true">
        <span className="translate-loading-orb-ring" />
        <span className="translate-loading-orb-core" />
      </div>
      <div className="text-center">
        <p className="m-0 text-[14px] font-medium tracking-tight text-ink">
          {t("translate.translating")}
          <span className="translate-loading-dots" aria-hidden="true">
            <i />
            <i />
            <i />
          </span>
        </p>
      </div>
      <div className="translate-loading-skeleton w-full max-w-md" aria-hidden="true">
        <span className="h-3 w-[42%]" />
        <span className="h-2.5 w-full" />
        <span className="h-2.5 w-[92%]" />
        <span className="h-2.5 w-[78%]" />
        <span className="mt-2 h-2.5 w-full" />
        <span className="h-2.5 w-[88%]" />
        <span className="h-2.5 w-[64%]" />
      </div>
    </div>
  );
}

export function useTranslatePreview(
  api: SkillApi | null,
  source: TranslateSkillSource,
  skillId: string,
) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<TranslatePreview | null>(null);
  const [pathLabel, setPathLabel] = useState<string>("");
  const requestIdRef = useRef(0);

  const closePreview = () => {
    requestIdRef.current += 1;
    setOpen(false);
    setLoading(false);
    setError(null);
    setResult(null);
  };

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      closePreview();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open]);

  const run = (relativePath: string) => {
    if (!api || !skillId) return;
    const path = relativePath.trim() || "SKILL.md";
    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;
    setPathLabel(path);
    setOpen(true);
    setLoading(true);
    setError(null);
    setResult(null);
    window.setTimeout(() => {
      void (async () => {
        try {
          const preview = await api.previewTranslateSkill(source, skillId, path);
          if (requestIdRef.current !== requestId) return;
          setResult(preview);
        } catch (err: unknown) {
          if (requestIdRef.current !== requestId) return;
          setError(errorMessage(err, t("translate.failed")));
        } finally {
          if (requestIdRef.current === requestId) {
            setLoading(false);
          }
        }
      })();
    }, 0);
  };

  const dialog: ReactNode = open ? (
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
              {t("translate.previewTitle")}
            </h2>
            <p className="mt-1 text-[12px] leading-5 text-ink-3">
              {loading
                ? t("translate.translatingFile", {
                    path: pathLabel || t("translate.currentFile"),
                  })
                : t("translate.previewHint")}
              {!loading && result
                ? ` · ${result.sourceFiles.join("、")} → ${result.targetLang} · ${result.model}`
                : null}
              {!loading && result?.fromCache ? t("translate.fromCache") : null}
              {!loading && result?.truncated ? t("translate.truncated") : null}
            </p>
          </div>
          <button
            type="button"
            className="macos-btn-ghost macos-btn-sm shrink-0"
            onClick={closePreview}
          >
            {t("common.close")}
          </button>
        </header>
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
          {loading ? (
            <TranslatingPanel />
          ) : (
            <div className="translate-result-enter flex h-full min-h-0 flex-col overflow-hidden">
              <MarkdownViewer
                file={
                  result
                    ? {
                        relativePath: result.sourceFiles[0] ?? t("translate.previewFilename"),
                        mediaType: "markdown",
                        content: result.markdown,
                        message: null,
                      }
                    : null
                }
                loading={false}
                errorMessage={error}
                editable={false}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  ) : null;

  return { run, loading, open, dialog };
}

export function TranslatePreviewButton({
  api,
  source,
  skillId,
  relativePath,
  disabled = false,
}: TranslatePreviewButtonProps) {
  const { t } = useI18n();
  const preview = useTranslatePreview(api, source, skillId);
  const hasSelection = Boolean(relativePath?.trim());

  return (
    <>
      <button
        type="button"
        className="macos-btn-ghost"
        disabled={disabled || preview.loading || !hasSelection}
        title={
          hasSelection
            ? t("translate.buttonTitle", { path: relativePath ?? "" })
            : t("translate.buttonDisabled")
        }
        onClick={() => {
          const path = relativePath?.trim();
          if (path) preview.run(path);
        }}
      >
        {t("translate.button")}
      </button>
      {preview.dialog}
    </>
  );
}
