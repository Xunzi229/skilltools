import { useEffect, useRef, useState } from "react";
import type { SkillApi } from "../api/skillApi";
import type { ExternalEditor, FileContent, FileNode } from "../model/skill";
import { errorMessage } from "../utils/errors";

type FileSource =
  | { kind: "provider"; skillId: string }
  | { kind: "library"; skillId: string };

interface UseSkillFilesOptions {
  api: SkillApi;
  source: FileSource | null;
  reloadToken?: string | null;
}

export function useSkillFiles({ api, source, reloadToken }: UseSkillFilesOptions) {
  const [tree, setTree] = useState<FileNode[]>([]);
  const [treeLoading, setTreeLoading] = useState(false);
  const [treeError, setTreeError] = useState<string | null>(null);
  const [preview, setPreview] = useState<FileContent | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [editors, setEditors] = useState<ExternalEditor[]>([]);
  const [openError, setOpenError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const treeRequest = useRef(0);
  const previewRequest = useRef(0);

  useEffect(() => {
    void api
      .listExternalEditors()
      .then(setEditors)
      .catch(() => setEditors([]));
  }, [api]);

  const loadPreview = (skillId: string, relativePath: string, kind: FileSource["kind"]) => {
    const requestId = ++previewRequest.current;
    setPreviewLoading(true);
    setPreviewError(null);
    const reader =
      kind === "library"
        ? api.readLibrarySkillFile(skillId, relativePath)
        : api.readSkillFile(skillId, relativePath);
    void reader
      .then((content) => {
        if (requestId === previewRequest.current) {
          setPreview(content);
        }
      })
      .catch((failure: unknown) => {
        if (requestId === previewRequest.current) {
          setPreview(null);
          setPreviewError(errorMessage(failure, "文件加载失败，请重试"));
        }
      })
      .finally(() => {
        if (requestId === previewRequest.current) {
          setPreviewLoading(false);
        }
      });
  };

  useEffect(() => {
    const requestId = ++treeRequest.current;
    previewRequest.current += 1;
    setTree([]);
    setPreview(null);
    setTreeError(null);
    setPreviewError(null);
    setOpenError(null);
    if (!source) {
      setTreeLoading(false);
      setPreviewLoading(false);
      return;
    }

    setTreeLoading(true);
    const loader =
      source.kind === "library"
        ? api.listLibrarySkillTree(source.skillId)
        : api.listSkillTree(source.skillId);
    void loader
      .then((nodes) => {
        if (requestId === treeRequest.current) {
          setTree(nodes);
        }
      })
      .catch((failure: unknown) => {
        if (requestId === treeRequest.current) {
          setTreeError(errorMessage(failure, "目录加载失败，请重试"));
        }
      })
      .finally(() => {
        if (requestId === treeRequest.current) {
          setTreeLoading(false);
        }
      });
    loadPreview(source.skillId, "SKILL.md", source.kind);
  }, [api, source?.kind, source?.skillId, reloadToken]);

  const selectFile = (relativePath: string) => {
    if (!source) return;
    loadPreview(source.skillId, relativePath, source.kind);
  };

  const saveFile = async (content: string) => {
    if (!source || !preview) return;
    setSaving(true);
    setOpenError(null);
    try {
      if (source.kind === "library") {
        await api.writeLibrarySkillFile(source.skillId, preview.relativePath, content);
      } else {
        await api.writeSkillFile(source.skillId, preview.relativePath, content);
      }
      loadPreview(source.skillId, preview.relativePath, source.kind);
    } catch (failure: unknown) {
      setOpenError(errorMessage(failure, "保存失败，请重试"));
      throw failure;
    } finally {
      setSaving(false);
    }
  };

  const openWith = async (relativePath: string, editorId: string) => {
    if (!source) return;
    setOpenError(null);
    try {
      if (source.kind === "library") {
        await api.openLibrarySkillFileExternal(source.skillId, relativePath, editorId);
      } else {
        await api.openSkillFileExternal(source.skillId, relativePath, editorId);
      }
    } catch (failure: unknown) {
      setOpenError(errorMessage(failure, "打开失败，请重试"));
    }
  };

  return {
    tree,
    treeLoading,
    treeError,
    preview,
    previewLoading,
    previewError,
    editors,
    openError,
    saving,
    selectFile,
    saveFile,
    openWith,
    clearOpenError: () => setOpenError(null),
  };
}
