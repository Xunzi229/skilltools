import { useEffect, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";
import type { SkillApi } from "../api/skillApi";
import type {
  AiTaxonomyApplyItem,
  GroupSuggestion,
  LibrarySkillSummary,
  SkillGroup,
  Tag,
} from "../model/skill";
import { errorMessage } from "../utils/errors";
import { displayDescription } from "../utils/skillDisplay";
import { useModelServiceConfigured } from "../hooks/useModelServiceConfigured";

/** 与后端 group_suggest::MAX_SKILLS_PER_REQUEST 保持一致 */
const SUGGEST_BATCH_SIZE = 40;

interface AiGroupButtonProps {
  api: SkillApi;
  skills: LibrarySkillSummary[];
  groups: SkillGroup[];
  tags: Tag[];
  selectedIds: Set<string>;
  disabled?: boolean;
  onApply: (items: AiTaxonomyApplyItem[]) => Promise<void>;
}

type DraftRow = {
  skillId: string;
  name: string;
  description: string;
  /** 已有分组 id，或 `__new__:${name}` */
  groupKey: string;
  tagIds: string[];
  newTagNames: string[];
};

type BatchProgress = {
  done: number;
  total: number;
};

function chunkIds(ids: string[], size: number): string[][] {
  const chunks: string[][] = [];
  for (let i = 0; i < ids.length; i += size) {
    chunks.push(ids.slice(i, i + size));
  }
  return chunks;
}

function RecognizingPanel({ progress }: { progress: BatchProgress | null }) {
  const remaining =
    progress && progress.total > 0
      ? Math.max(progress.total - progress.done, 0)
      : null;
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
          识别中
          <span className="translate-loading-dots" aria-hidden="true">
            <i />
            <i />
            <i />
          </span>
        </p>
        <p className="mt-1.5 m-0 text-[12px] leading-5 text-ink-3">
          {progress && progress.total > 1
            ? `批次 ${progress.done}/${progress.total}，剩余 ${remaining} 批`
            : "根据描述匹配分组与标签；不明显归属的会保持未分组"}
        </p>
      </div>
      <div className="translate-loading-skeleton w-full max-w-md" aria-hidden="true">
        <span className="h-3 w-[42%]" />
        <span className="h-2.5 w-full" />
        <span className="h-2.5 w-[92%]" />
        <span className="h-2.5 w-[78%]" />
      </div>
    </div>
  );
}

function suggestionsToDrafts(
  suggestions: GroupSuggestion[],
  skillById: Map<string, LibrarySkillSummary>,
  groupsByName: Map<string, SkillGroup>,
  tagsByName: Map<string, Tag>,
): DraftRow[] {
  return suggestions.map((item) => {
    const skill = skillById.get(item.skillId);
    let groupKey = "";
    if (item.groupName != null) {
      const existing = groupsByName.get(item.groupName);
      groupKey = existing ? existing.id : `__new__:${item.groupName}`;
    }
    const tagIds: string[] = [];
    const newTagNames: string[] = [];
    for (const name of item.tagNames ?? []) {
      const existing = tagsByName.get(name);
      if (existing) tagIds.push(existing.id);
      else if (!newTagNames.includes(name)) newTagNames.push(name);
    }
    return {
      skillId: item.skillId,
      name: skill?.name ?? item.skillId,
      description: skill?.description ?? "",
      groupKey,
      tagIds,
      newTagNames,
    };
  });
}

export function AiGroupButton({
  api,
  skills,
  groups,
  tags,
  selectedIds,
  disabled = false,
  onApply,
}: AiGroupButtonProps) {
  const configured = useModelServiceConfigured(api);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rows, setRows] = useState<DraftRow[]>([]);
  const [progress, setProgress] = useState<BatchProgress | null>(null);
  const [allowNew, setAllowNew] = useState(false);
  const requestIdRef = useRef(0);

  const orderedGroups = useMemo(
    () => [...groups].sort((a, b) => a.order - b.order),
    [groups],
  );

  const extraNewGroups = useMemo(() => {
    const names = new Set<string>();
    for (const row of rows) {
      if (row.groupKey.startsWith("__new__:")) {
        names.add(row.groupKey.slice("__new__:".length));
      }
    }
    return [...names];
  }, [rows]);

  const closeSheet = () => {
    if (applying) return;
    requestIdRef.current += 1;
    setOpen(false);
    setLoading(false);
    setError(null);
    setRows([]);
    setProgress(null);
  };

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || applying) return;
      requestIdRef.current += 1;
      setOpen(false);
      setLoading(false);
      setError(null);
      setRows([]);
      setProgress(null);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, applying]);

  if (!configured) {
    return null;
  }

  const runSuggest = () => {
    const ids = [...selectedIds];
    if (ids.length === 0) return;
    if (groups.length === 0 && !allowNew) {
      setError("请先创建分组或开启「允许新建」");
      return;
    }
    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;
    const batches = chunkIds(ids, SUGGEST_BATCH_SIZE);
    setOpen(true);
    setLoading(true);
    setApplying(false);
    setError(null);
    setRows([]);
    setProgress({ done: 0, total: batches.length });

    const skillById = new Map(skills.map((skill) => [skill.id, skill]));
    const groupsByName = new Map(groups.map((group) => [group.name, group]));
    const tagsByName = new Map(tags.map((tag) => [tag.name, tag]));

    window.setTimeout(() => {
      void (async () => {
        const batchErrors: string[] = [];
        for (let index = 0; index < batches.length; index += 1) {
          if (requestIdRef.current !== requestId) return;
          const batch = batches[index]!;
          try {
            const suggestions = await api.suggestSkillGroups(batch, {
              allowNewGroups: allowNew,
              allowNewTags: allowNew,
            });
            if (requestIdRef.current !== requestId) return;
            const drafts = suggestionsToDrafts(
              suggestions,
              skillById,
              groupsByName,
              tagsByName,
            );
            flushSync(() => {
              setRows((prev) => [...prev, ...drafts]);
              setProgress({ done: index + 1, total: batches.length });
            });
            await new Promise<void>((resolve) => {
              window.requestAnimationFrame(() => resolve());
            });
          } catch (err: unknown) {
            if (requestIdRef.current !== requestId) return;
            batchErrors.push(
              `第 ${index + 1}/${batches.length} 批：${errorMessage(err, "识别失败")}`,
            );
            flushSync(() => {
              setProgress({ done: index + 1, total: batches.length });
            });
          }
        }
        if (requestIdRef.current !== requestId) return;
        if (batchErrors.length > 0) {
          setError(batchErrors.join("；"));
        }
        setLoading(false);
      })();
    }, 0);
  };

  const apply = async () => {
    if (rows.length === 0 || applying || loading) return;
    setApplying(true);
    setError(null);
    try {
      const items: AiTaxonomyApplyItem[] = rows.map((row) => {
        if (row.groupKey.startsWith("__new__:")) {
          return {
            skillId: row.skillId,
            groupId: null,
            newGroupName: row.groupKey.slice("__new__:".length),
            tagIds: row.tagIds,
            newTagNames: row.newTagNames,
          };
        }
        return {
          skillId: row.skillId,
          groupId: row.groupKey === "" ? null : row.groupKey,
          newGroupName: null,
          tagIds: row.tagIds,
          newTagNames: row.newTagNames,
        };
      });
      await onApply(items);
      requestIdRef.current += 1;
      setOpen(false);
      setRows([]);
      setProgress(null);
    } catch (err: unknown) {
      setError(errorMessage(err, "应用分组失败"));
    } finally {
      setApplying(false);
    }
  };

  const remainingBatches =
    progress && progress.total > 0
      ? Math.max(progress.total - progress.done, 0)
      : 0;

  return (
    <>
      <label className="inline-flex items-center gap-1 text-[11px] text-ink-2">
        <input
          type="checkbox"
          checked={allowNew}
          disabled={disabled || loading || applying}
          onChange={(event) => setAllowNew(event.target.checked)}
        />
        允许新建
      </label>
      <button
        type="button"
        className="macos-btn-ghost"
        disabled={
          disabled ||
          selectedIds.size === 0 ||
          loading ||
          applying ||
          (groups.length === 0 && !allowNew)
        }
        title="根据描述用模型匹配分组与标签（可调整后应用）"
        onClick={runSuggest}
      >
        智能分组
      </button>
      {open ? (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/30 p-4 backdrop-blur-[2px]">
          <div
            className="macos-sheet flex h-[min(85vh,640px)] w-full max-w-3xl flex-col overflow-hidden p-0"
            role="dialog"
            aria-modal="true"
            aria-labelledby="ai-group-title"
          >
            <header className="flex shrink-0 items-start justify-between gap-3 border-b border-line-strong px-5 py-4">
              <div className="min-w-0">
                <h2
                  id="ai-group-title"
                  className="m-0 text-[15px] font-semibold tracking-tight text-ink"
                >
                  智能分组
                </h2>
                <p className="mt-1 text-[12px] leading-5 text-ink-3">
                  {loading && progress
                    ? progress.total > 1
                      ? `正在分批识别：已完成 ${progress.done}/${progress.total}，剩余 ${remainingBatches} 批`
                      : `正在识别 ${selectedIds.size} 个 Skill…`
                    : "确认前可调整分组与标签；新建项将在应用时创建"}
                </p>
              </div>
              <button
                type="button"
                className="macos-btn-ghost macos-btn-sm shrink-0"
                disabled={applying}
                onClick={closeSheet}
              >
                关闭
              </button>
            </header>

            <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
              {loading && rows.length === 0 ? (
                <RecognizingPanel progress={progress} />
              ) : (
                <div className="translate-result-enter flex min-h-0 flex-1 flex-col overflow-hidden">
                  {loading && progress && progress.total > 1 ? (
                    <div
                      className="shrink-0 border-b border-line bg-hover px-4 py-2 text-[12px] text-ink-2"
                      aria-live="polite"
                    >
                      批次进度 {progress.done}/{progress.total}
                      ，剩余 {remainingBatches} 批 · 已出结果 {rows.length} 项
                    </div>
                  ) : null}
                  {error ? (
                    <p className="macos-alert-error m-4 shrink-0">{error}</p>
                  ) : null}
                  {rows.length > 0 ? (
                    <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
                      <table className="w-full border-collapse text-left text-[12px]">
                        <thead className="sticky top-0 bg-panel text-[11px] text-ink-3">
                          <tr className="border-b border-line">
                            <th className="px-2 py-2 font-medium">Skill</th>
                            <th className="px-2 py-2 font-medium">描述</th>
                            <th className="w-[150px] px-2 py-2 font-medium">分组</th>
                            <th className="w-[180px] px-2 py-2 font-medium">标签</th>
                          </tr>
                        </thead>
                        <tbody>
                          {rows.map((row, index) => (
                            <tr
                              key={row.skillId}
                              className="border-b border-line align-top"
                            >
                              <td className="px-2 py-2.5 font-medium text-ink">
                                {row.name}
                              </td>
                              <td className="px-2 py-2.5 text-ink-2">
                                {displayDescription(row.description, 72) || "—"}
                              </td>
                              <td className="px-2 py-2">
                                <select
                                  className="macos-select macos-select-sm w-full"
                                  aria-label={`${row.name} 分组`}
                                  disabled={applying}
                                  value={row.groupKey}
                                  onChange={(event) => {
                                    const value = event.target.value;
                                    setRows((prev) =>
                                      prev.map((item, i) =>
                                        i === index
                                          ? { ...item, groupKey: value }
                                          : item,
                                      ),
                                    );
                                  }}
                                >
                                  <option value="">未分组</option>
                                  {orderedGroups.map((group) => (
                                    <option key={group.id} value={group.id}>
                                      {group.name}
                                    </option>
                                  ))}
                                  {extraNewGroups.map((name) => (
                                    <option key={`new-${name}`} value={`__new__:${name}`}>
                                      新建：{name}
                                    </option>
                                  ))}
                                </select>
                              </td>
                              <td className="px-2 py-2">
                                <div className="flex flex-col gap-1">
                                  {tags.map((tag) => {
                                    const checked = row.tagIds.includes(tag.id);
                                    return (
                                      <label
                                        key={tag.id}
                                        className="inline-flex items-center gap-1 text-[11px] text-ink-2"
                                      >
                                        <input
                                          type="checkbox"
                                          disabled={applying}
                                          checked={checked}
                                          onChange={() => {
                                            setRows((prev) =>
                                              prev.map((item, i) => {
                                                if (i !== index) return item;
                                                const tagIds = checked
                                                  ? item.tagIds.filter((id) => id !== tag.id)
                                                  : [...item.tagIds, tag.id];
                                                return { ...item, tagIds };
                                              }),
                                            );
                                          }}
                                        />
                                        {tag.name}
                                      </label>
                                    );
                                  })}
                                  {row.newTagNames.map((name) => (
                                    <label
                                      key={`new-tag-${name}`}
                                      className="inline-flex items-center gap-1 text-[11px] text-brand"
                                    >
                                      <input
                                        type="checkbox"
                                        disabled={applying}
                                        checked
                                        onChange={() => {
                                          setRows((prev) =>
                                            prev.map((item, i) =>
                                              i === index
                                                ? {
                                                    ...item,
                                                    newTagNames: item.newTagNames.filter(
                                                      (n) => n !== name,
                                                    ),
                                                  }
                                                : item,
                                            ),
                                          );
                                        }}
                                      />
                                      新建：{name}
                                    </label>
                                  ))}
                                </div>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : !error && !loading ? (
                    <p className="px-5 py-8 text-center text-[13px] text-ink-3">
                      没有可展示的识别结果
                    </p>
                  ) : null}
                </div>
              )}
            </div>

            <footer className="flex shrink-0 justify-end gap-2 border-t border-line-strong px-5 py-3">
              <button
                type="button"
                className="macos-btn-ghost h-8 px-3.5 text-[13px]"
                disabled={applying}
                onClick={closeSheet}
              >
                取消
              </button>
              <button
                type="button"
                className="macos-btn-primary h-8 px-3.5 text-[13px]"
                disabled={loading || applying || rows.length === 0}
                onClick={() => void apply()}
              >
                {applying ? "应用中…" : "应用"}
              </button>
            </footer>
          </div>
        </div>
      ) : null}
    </>
  );
}
