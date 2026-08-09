import { useState } from "react";
import type { SkillApi } from "../api/skillApi";
import { useSkillFiles } from "../hooks/useSkillFiles";
import type {
  CommandError,
  LibrarySkillDetail as LibrarySkillDetailModel,
  Provider,
  SkillGroup,
  Tag,
} from "../model/skill";
import { displayDescription } from "../utils/skillDisplay";
import { pickSaveZip } from "../utils/dialogs";
import { ConfirmDialog } from "./ConfirmDialog";
import { FileTree } from "./FileTree";
import { MarkdownViewer } from "./MarkdownViewer";
import { NameDialog } from "./NameDialog";
import { TagColorDot } from "./TagColorPicker";
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
  onCreateTag: (name: string, color?: string | null) => Promise<Tag | undefined>;
  onCreateGroup: (name: string) => Promise<SkillGroup | undefined>;
  onInstall: (id: string, provider: Provider) => Promise<void>;
  onUninstall: (id: string, provider: Provider) => Promise<void>;
  onExportZip: (id: string, destPath: string) => Promise<void>;
  onRename: (id: string, newName: string) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  onClearError: () => void;
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
  onCreateTag,
  onCreateGroup,
  onInstall,
  onUninstall,
  onExportZip,
  onRename,
  onDelete,
  onClearError,
}: LibraryDetailProps) {
  const [copied, setCopied] = useState(false);
  const [nameDialog, setNameDialog] = useState<"group" | "tag" | "rename" | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const files = useSkillFiles({
    api,
    source: skill ? { kind: "library", skillId: skill.id } : null,
    reloadToken: skill?.skillMarkdown,
  });

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

  const busy = pendingAction !== null || files.saving;
  const fileError = files.treeError ?? files.previewError ?? files.openError;

  return (
    <section
      className="flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-panel"
      aria-label="库 Skill 详情"
    >
      <header className="shrink-0 border-b border-line-strong px-6 pt-5 pb-4">
        {skill.parentSkillId && (
          <span className="mb-2 inline-block rounded bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-ink-2">
            子 Skill
          </span>
        )}
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="m-0 text-[28px] font-bold leading-tight text-ink">{skill.name}</h2>
            <p className="mt-2 max-w-3xl text-[14px] leading-6 text-ink-2">
              {displayDescription(skill.description) || "暂无描述"}
            </p>
          </div>
          <div className="flex shrink-0 flex-wrap gap-2">
            <button
              type="button"
              className="rounded-lg border border-line px-3 py-1.5 text-[12px] hover:bg-hover disabled:opacity-55"
              disabled={busy}
              onClick={() => setNameDialog("rename")}
            >
              重命名
            </button>
            <button
              type="button"
              className="rounded-lg border border-red-200 bg-red-50 px-3 py-1.5 text-[12px] text-red-700 hover:bg-red-100 disabled:opacity-55"
              disabled={busy}
              onClick={() => setDeleteOpen(true)}
            >
              删除
            </button>
          </div>
        </div>
        <div className="mt-3 flex items-center gap-2">
          <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-ink-3">
            {skill.absolutePath}
          </span>
          <button
            type="button"
            className="shrink-0 rounded-md border border-line px-2 py-1 text-[11px] text-ink-2 hover:bg-hover disabled:opacity-55"
            disabled={busy}
            onClick={() => {
              void pickSaveZip(`${skill.name}.zip`).then((path) => {
                if (path) void onExportZip(skill.id, path);
              });
            }}
          >
            导出 ZIP
          </button>
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

      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-hidden px-6 py-4">
        {actionError && (
          <div
            className="flex shrink-0 items-center justify-between gap-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[12px] text-red-700"
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

        <div className="grid shrink-0 gap-4 md:grid-cols-[minmax(160px,0.7fr)_1fr]">
          <div className="flex flex-col gap-1.5 text-[12px] text-ink-2">
            <div className="flex items-center justify-between gap-2">
              <span>分组</span>
              <button
                type="button"
                className="rounded px-1.5 py-0.5 text-[11px] text-brand hover:bg-brand/10 disabled:opacity-55"
                disabled={busy}
                onClick={() => setNameDialog("group")}
              >
                新建分组
              </button>
            </div>
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
              {[...groups]
                .sort((left, right) => left.order - right.order)
                .map((group) => (
                  <option key={group.id} value={group.id}>
                    {group.name}
                  </option>
                ))}
            </select>
          </div>
          <fieldset className="min-w-0 border-0 p-0">
            <legend className="mb-1.5 flex w-full items-center justify-between px-0 text-[12px] text-ink-2">
              <span>标签</span>
              <button
                type="button"
                className="rounded px-1.5 py-0.5 text-[11px] text-brand hover:bg-brand/10 disabled:opacity-55"
                disabled={busy}
                onClick={() => setNameDialog("tag")}
              >
                新建标签
              </button>
            </legend>
            {tags.length === 0 ? (
              <span className="text-[12px] text-ink-3">暂无标签，可点「新建标签」创建</span>
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
                    <TagColorDot color={tag.color} />
                    {tag.name}
                  </label>
                ))}
              </div>
            )}
          </fieldset>
        </div>

        <div className="shrink-0">
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
          <aside className="shrink-0 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[12px] text-amber-800">
            <ul className="m-0 list-disc pl-4">
              {skill.warnings.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </aside>
        )}

        <div className="flex min-h-0 flex-1 overflow-hidden rounded-lg border border-line-strong">
          <FileTree
            nodes={files.tree}
            selectedPath={files.preview?.relativePath ?? null}
            loading={files.treeLoading}
            errorMessage={fileError}
            editors={files.editors}
            onSelect={files.selectFile}
            onOpenWith={files.openWith}
          />
          <MarkdownViewer
            file={files.preview}
            loading={files.previewLoading}
            errorMessage={fileError}
            editable
            saving={files.saving}
            onSave={files.saveFile}
          />
        </div>
      </div>

      <NameDialog
        open={nameDialog !== null}
        title={
          nameDialog === "group"
            ? "新建分组"
            : nameDialog === "tag"
              ? "新建标签"
              : "重命名 Skill"
        }
        initialValue={nameDialog === "rename" ? skill.name : ""}
        confirmLabel={nameDialog === "rename" ? "重命名" : "创建并应用"}
        showColorPicker={nameDialog === "tag"}
        busy={busy}
        onCancel={() => setNameDialog(null)}
        onConfirm={(name, color) => {
          const kind = nameDialog;
          const skillId = skill.id;
          const currentTagIds = skill.tagIds;
          setNameDialog(null);
          if (kind === "group") {
            void onCreateGroup(name).then((group) => {
              if (group) void onSetGroup(skillId, group.id);
            });
          } else if (kind === "tag") {
            void onCreateTag(name, color ?? null).then((tag) => {
              if (tag) void onSetTags(skillId, [...currentTagIds, tag.id]);
            });
          } else if (kind === "rename") {
            void onRename(skillId, name);
          }
        }}
      />
      <ConfirmDialog
        open={deleteOpen}
        title={`删除 ${skill.name}？`}
        message="将先卸载所有工具中的安装链接，再删除库目录内的文件。外部引用项目中的 Skill 请到「项目」页移除。"
        confirmLabel="删除"
        tone="danger"
        busy={busy}
        onCancel={() => setDeleteOpen(false)}
        onConfirm={() => {
          void onDelete(skill.id).then(() => setDeleteOpen(false));
        }}
      />
    </section>
  );
}
