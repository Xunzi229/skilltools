import { useEffect, useRef, useState } from "react";
import type { SkillApi } from "../api/skillApi";
import type {
  CommandError,
  FileContent,
  FileNode,
  LibrarySkillDetail as LibrarySkillDetailModel,
  Provider,
  SkillGroup,
  Tag,
} from "../model/skill";
import { displayDescription } from "../utils/skillDisplay";
import { FileTree } from "./FileTree";
import { MarkdownViewer } from "./MarkdownViewer";
import { TargetSelector } from "./TargetSelector";

interface LibraryDetailProps {
  api: SkillApi;
  skill: LibrarySkillDetailModel | null;
  tags: Tag[];
  groups: SkillGroup[];
  loading: boolean;
  actionError: CommandError | null;
  pendingAction: string | null;
  onSetTags: (id: string, tagIds: string[]) => Promise<void>;
  onSetGroup: (id: string, groupId: string | null) => Promise<void>;
  onInstall: (id: string, provider: Provider) => Promise<void>;
  onUninstall: (id: string, provider: Provider) => Promise<void>;
  onClearError: () => void;
}

function messageOf(error: unknown) {
  if (typeof error === "object" && error !== null && "message" in error) {
    return String(error.message);
  }
  return "文件加载失败，请重试";
}

async function copyText(value: string) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value);
    return;
  }
  const input = document.createElement("textarea");
  input.value = value;
  document.body.appendChild(input);
  input.select();
  document.execCommand("copy");
  document.body.removeChild(input);
}

export function LibraryDetail({
  api,
  skill,
  tags,
  groups,
  loading,
  actionError,
  pendingAction,
  onSetTags,
  onSetGroup,
  onInstall,
  onUninstall,
  onClearError,
}: LibraryDetailProps) {
  const [tree, setTree] = useState<FileNode[]>([]);
  const [preview, setPreview] = useState<FileContent | null>(null);
  const [treeLoading, setTreeLoading] = useState(false);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [fileError, setFileError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const request = useRef(0);

  const loadPreview = (id: string, relativePath: string) => {
    const requestId = ++request.current;
    setPreviewLoading(true);
    setFileError(null);
    void api
      .readLibrarySkillFile(id, relativePath)
      .then((content) => {
        if (requestId === request.current) setPreview(content);
      })
      .catch((error: unknown) => {
        if (requestId === request.current) setFileError(messageOf(error));
      })
      .finally(() => {
        if (requestId === request.current) setPreviewLoading(false);
      });
  };

  useEffect(() => {
    const id = skill?.id;
    request.current += 1;
    setTree([]);
    setPreview(null);
    setFileError(null);
    setCopied(false);
    if (!id) return;
    setTreeLoading(true);
    void api
      .listLibrarySkillTree(id)
      .then(setTree)
      .catch((error: unknown) => setFileError(messageOf(error)))
      .finally(() => setTreeLoading(false));
    loadPreview(id, "SKILL.md");
  }, [api, skill?.id]);

  if (loading) {
    return (
      <section className="flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-panel">
        <div className="flex flex-1 items-center justify-center text-[13px] text-ink-3">
          正在加载库 Skill…
        </div>
      </section>
    );
  }
  if (!skill) {
    return (
      <section className="flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-panel">
        <div className="flex flex-1 items-center justify-center text-[13px] text-ink-3">
          <strong className="text-ink">选择一个库 Skill 查看详情</strong>
        </div>
      </section>
    );
  }

  const busy = pendingAction !== null;
  return (
    <section className="flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-panel">
      <header className="shrink-0 border-b border-line-strong px-6 pt-5 pb-4">
        {skill.parentSkillId && (
          <span className="mb-2 inline-block rounded bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-ink-2">
            子 Skill
          </span>
        )}
        <h2 className="m-0 text-[28px] font-bold leading-tight text-ink">{skill.name}</h2>
        <p className="mt-2 max-w-3xl text-[14px] leading-6 text-ink-2">
          {displayDescription(skill.description) || "暂无描述"}
        </p>
        <div className="mt-3 flex items-center gap-2">
          <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-ink-3">
            {skill.absolutePath}
          </span>
          <button
            type="button"
            className="shrink-0 rounded-md border border-line px-2 py-1 text-[11px] text-ink-2 hover:bg-hover"
            aria-label="复制来源路径"
            onClick={() => {
              void copyText(skill.absolutePath).then(() => {
                setCopied(true);
                window.setTimeout(() => setCopied(false), 1500);
              });
            }}
          >
            {copied ? "已复制" : "复制"}
          </button>
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-auto px-6 py-4">
        {actionError && (
          <div
            className="mb-4 flex items-center justify-between gap-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[12px] text-red-700"
            role="alert"
          >
            <span>{actionError.message}</span>
            <button
              type="button"
              className="rounded bg-red-100 px-2 py-1"
              onClick={onClearError}
            >
              关闭
            </button>
          </div>
        )}

        <div className="mb-5 grid gap-4 md:grid-cols-[minmax(140px,0.7fr)_1fr]">
          <label className="flex flex-col gap-1.5 text-[12px] text-ink-2">
            <span>分组</span>
            <select
              className="h-9 rounded-lg border border-line bg-panel px-2 text-[13px] text-ink"
              aria-label="分组"
              value={skill.groupId ?? ""}
              disabled={busy}
              onChange={(event) =>
                void onSetGroup(skill.id, event.target.value || null)
              }
            >
              <option value="">未分组</option>
              {groups.map((group) => (
                <option key={group.id} value={group.id}>
                  {group.name}
                </option>
              ))}
            </select>
          </label>
          <fieldset className="min-w-0 border-0 p-0">
            <legend className="mb-1.5 px-0 text-[12px] text-ink-2">标签</legend>
            {tags.length === 0 ? (
              <span className="text-[12px] text-ink-3">暂无标签</span>
            ) : (
              <div className="flex flex-wrap gap-2">
                {tags.map((tag) => (
                  <label
                    key={tag.id}
                    className="inline-flex items-center gap-1.5 rounded-md border border-line px-2 py-1 text-[12px] text-ink-2"
                  >
                    <input
                      type="checkbox"
                      aria-label={tag.name}
                      checked={skill.tagIds.includes(tag.id)}
                      disabled={busy}
                      onChange={(event) => {
                        const next = event.target.checked
                          ? [...skill.tagIds, tag.id]
                          : skill.tagIds.filter((id) => id !== tag.id);
                        void onSetTags(skill.id, next);
                      }}
                    />
                    {tag.name}
                  </label>
                ))}
              </div>
            )}
          </fieldset>
        </div>

        <div className="mb-5">
          <TargetSelector
            installedProviders={skill.installedProviders}
            busy={busy}
            onToggle={(provider, installed) =>
              void (installed
                ? onUninstall(skill.id, provider)
                : onInstall(skill.id, provider))
            }
          />
        </div>

        {skill.warnings.length > 0 && (
          <aside className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[12px] text-amber-800">
            <ul className="m-0 list-disc pl-4">
              {skill.warnings.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </aside>
        )}

        <div className="flex h-[min(520px,55vh)] min-h-[280px] overflow-hidden rounded-lg border border-line-strong">
          <FileTree
            nodes={tree}
            selectedPath={preview?.relativePath ?? null}
            loading={treeLoading}
            errorMessage={fileError}
            onSelect={(path) => loadPreview(skill.id, path)}
          />
          <MarkdownViewer
            file={preview}
            loading={previewLoading}
            errorMessage={fileError}
          />
        </div>
      </div>
    </section>
  );
}
