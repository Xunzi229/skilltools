import hljs from "highlight.js/lib/core";
import bash from "highlight.js/lib/languages/bash";
import css from "highlight.js/lib/languages/css";
import ini from "highlight.js/lib/languages/ini";
import javascript from "highlight.js/lib/languages/javascript";
import json from "highlight.js/lib/languages/json";
import markdownLang from "highlight.js/lib/languages/markdown";
import python from "highlight.js/lib/languages/python";
import rust from "highlight.js/lib/languages/rust";
import typescript from "highlight.js/lib/languages/typescript";
import xml from "highlight.js/lib/languages/xml";
import yaml from "highlight.js/lib/languages/yaml";
import { useEffect, useMemo, useState } from "react";
import ReactMarkdown from "react-markdown";
import type { FileContent } from "../model/skill";
import {
  languageLabel,
  languageOf,
  previewKindOf,
} from "../utils/filePreview";
import { stripMarkdownFrontmatter } from "../utils/skillDisplay";

hljs.registerLanguage("bash", bash);
hljs.registerLanguage("css", css);
hljs.registerLanguage("ini", ini);
hljs.registerLanguage("javascript", javascript);
hljs.registerLanguage("json", json);
hljs.registerLanguage("markdown", markdownLang);
hljs.registerLanguage("python", python);
hljs.registerLanguage("rust", rust);
hljs.registerLanguage("typescript", typescript);
hljs.registerLanguage("xml", xml);
hljs.registerLanguage("yaml", yaml);

interface MarkdownViewerProps {
  file: FileContent | null;
  loading: boolean;
  errorMessage: string | null;
  editable?: boolean;
  saving?: boolean;
  onSave?: (content: string) => Promise<void> | void;
}

function highlightCode(content: string, language: string): string {
  try {
    if (language !== "plaintext" && hljs.getLanguage(language)) {
      return hljs.highlight(content, { language }).value;
    }
  } catch {
    // fall through
  }
  return hljs.highlightAuto(content).value;
}

function CodePanel({
  content,
  language,
}: {
  content: string;
  language: string;
}) {
  const html = useMemo(() => highlightCode(content, language), [content, language]);
  const lines = content.length === 0 ? [""] : content.split("\n");

  return (
    <div className="code-panel">
      <div className="code-gutter" aria-hidden="true">
        {lines.map((_, index) => (
          <span key={index}>{index + 1}</span>
        ))}
      </div>
      <pre className="code-pre">
        <code
          className={`hljs language-${language}`}
          dangerouslySetInnerHTML={{ __html: html }}
        />
      </pre>
    </div>
  );
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
  const [mdSource, setMdSource] = useState(false);

  useEffect(() => {
    setEditing(false);
    setDraft(file?.content ?? "");
    setSaveError(null);
    setMdSource(false);
  }, [file?.relativePath, file?.content]);

  const canEdit =
    editable &&
    !!file &&
    (file.mediaType === "markdown" || file.mediaType === "text") &&
    file.content !== null;

  const kind = file
    ? previewKindOf(file.relativePath, file.mediaType)
    : "text";
  const language = file ? languageOf(file.relativePath) : "plaintext";
  const markdown =
    kind === "markdown" ? stripMarkdownFrontmatter(file?.content ?? "") : "";

  return (
    <article className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-panel">
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-line-strong px-3 py-2 text-[12px] font-medium text-ink-2">
        <div className="flex min-w-0 items-center gap-2">
          <span className="truncate">{file?.relativePath ?? "SKILL.md"}</span>
          {file && file.mediaType !== "unsupported" && (
            <span className="shrink-0 rounded bg-hover px-1.5 py-0.5 text-[10px] text-ink-3">
              {languageLabel(language)}
            </span>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {kind === "markdown" && !editing && file?.content !== null && (
            <button
              type="button"
              className="macos-btn-ghost macos-btn-sm"
              onClick={() => setMdSource((value) => !value)}
            >
              {mdSource ? "渲染预览" : "查看源码"}
            </button>
          )}
          {canEdit ? (
            editing ? (
              <>
                <button
                  type="button"
                  className="macos-btn-ghost macos-btn-sm"
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
                  className="macos-btn-primary macos-btn-sm"
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
                className="macos-btn-ghost macos-btn-sm"
                onClick={() => {
                  setDraft(file?.content ?? "");
                  setEditing(true);
                }}
              >
                编辑
              </button>
            )
          ) : null}
        </div>
      </div>
      <div className="file-preview-body min-h-0 flex-1 overflow-auto">
        {loading ? (
          <p className="px-4 py-3 text-[13px] text-ink-3">正在加载文件…</p>
        ) : errorMessage ? (
          <p className="macos-alert-error m-3">{errorMessage}</p>
        ) : saveError ? (
          <p className="macos-alert-error m-3">{saveError}</p>
        ) : !file ? (
          <p className="px-4 py-3 text-[13px] text-ink-3">选择文件以预览</p>
        ) : editing ? (
          <textarea
            className="file-preview-editor h-full min-h-[240px] w-full resize-none border-0 bg-panel px-4 py-3 text-ink outline-none"
            value={draft}
            disabled={saving}
            onChange={(event) => setDraft(event.target.value)}
            aria-label="编辑文件内容"
            spellCheck={kind === "markdown" || kind === "text"}
          />
        ) : file.mediaType === "unsupported" ? (
          <p className="px-4 py-3 text-[13px] text-ink-3">
            {file.message ?? "不支持预览"}
          </p>
        ) : kind === "markdown" && !mdSource ? (
          <div className="markdown-body">
            <ReactMarkdown
              components={{
                img: () => null,
                code({ className, children, ...props }) {
                  const text = String(children).replace(/\n$/, "");
                  const match = /language-(\w+)/.exec(className ?? "");
                  const isBlock = Boolean(match) || text.includes("\n");
                  if (!isBlock) {
                    return (
                      <code className={className} {...props}>
                        {children}
                      </code>
                    );
                  }
                  const lang = match?.[1] ?? "plaintext";
                  const highlighted = highlightCode(text, lang);
                  return (
                    <pre className="md-code-block">
                      <div className="md-code-lang">{languageLabel(lang)}</div>
                      <code
                        className={`hljs language-${lang}`}
                        dangerouslySetInnerHTML={{ __html: highlighted }}
                      />
                    </pre>
                  );
                },
              }}
            >
              {markdown}
            </ReactMarkdown>
          </div>
        ) : kind === "code" || mdSource ? (
          <CodePanel
            content={file.content ?? ""}
            language={mdSource ? "markdown" : language}
          />
        ) : (
          <pre className="file-preview-text m-0 overflow-auto px-4 py-3 whitespace-pre-wrap text-ink">
            {file.content ?? ""}
          </pre>
        )}
      </div>
    </article>
  );
}
