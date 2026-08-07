import ReactMarkdown from "react-markdown";
import type { FileContent } from "../model/skill";

interface FilePreviewProps {
  file: FileContent | null;
  loading: boolean;
  errorMessage: string | null;
}

export function FilePreview({
  file,
  loading,
  errorMessage,
}: FilePreviewProps) {
  return (
    <article className="file-preview">
      <div className="section-heading">
        <span>{file?.relativePath ?? "文件预览"}</span>
      </div>
      {loading ? (
        <p className="file-browser-state">正在加载文件…</p>
      ) : errorMessage ? (
        <p className="file-browser-state error-text">{errorMessage}</p>
      ) : !file ? (
        <p className="file-browser-state">选择文件以预览</p>
      ) : file.mediaType === "unsupported" ? (
        <p className="file-browser-state">{file.message ?? "不支持预览"}</p>
      ) : file.mediaType === "markdown" ? (
        <div className="markdown-body">
          <ReactMarkdown components={{ img: () => null }}>
            {file.content ?? ""}
          </ReactMarkdown>
        </div>
      ) : (
        <pre className="text-preview">{file.content ?? ""}</pre>
      )}
    </article>
  );
}
