import ReactMarkdown from "react-markdown";
import type { FileContent } from "../model/skill";
import { stripMarkdownFrontmatter } from "../utils/skillDisplay";

interface MarkdownViewerProps {
  file: FileContent | null;
  loading: boolean;
  errorMessage: string | null;
}

export function MarkdownViewer({
  file,
  loading,
  errorMessage,
}: MarkdownViewerProps) {
  const markdown =
    file?.mediaType === "markdown"
      ? stripMarkdownFrontmatter(file.content ?? "")
      : "";

  return (
    <article className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-panel">
      <div className="shrink-0 border-b border-line-strong px-3 py-2 text-[12px] font-medium text-ink-2">
        {file?.relativePath ?? "SKILL.md"}
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        {loading ? (
          <p className="px-4 py-3 text-[13px] text-ink-3">正在加载文件…</p>
        ) : errorMessage ? (
          <p className="px-4 py-3 text-[13px] text-red-600">{errorMessage}</p>
        ) : !file ? (
          <p className="px-4 py-3 text-[13px] text-ink-3">选择文件以预览</p>
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
