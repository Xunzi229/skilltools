import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { GitImportItem, Project } from "../model/skill";
import { ProjectPanel } from "./ProjectPanel";

const baseProject: Project = {
  id: "p1",
  name: "acme/skills",
  sourceType: "git",
  localPath: "/tmp/acme",
  remoteUrl: "https://github.com/acme/skills.git",
  addedAt: "2026-01-01T00:00:00.000Z",
  lastUpdatedAt: "2026-01-02T00:00:00.000Z",
  lastSyncedAt: "2026-01-02T00:00:00.000Z",
  warnings: [],
};

function renderPanel(overrides: {
  projects?: Project[];
  gitImports?: GitImportItem[];
  onAddGit?: (url: string) => Promise<void>;
  onRetryGitImport?: (tempId: string) => Promise<void>;
  onDismissGitImport?: (tempId: string) => void;
} = {}) {
  const onAddGit = overrides.onAddGit ?? vi.fn(async () => undefined);
  const onRetryGitImport = overrides.onRetryGitImport ?? vi.fn(async () => undefined);
  const onDismissGitImport = overrides.onDismissGitImport ?? vi.fn();
  render(
    <ProjectPanel
      projects={overrides.projects ?? []}
      gitImports={overrides.gitImports ?? []}
      loading={false}
      error={null}
      pendingAction={null}
      onAddLocal={vi.fn(async () => undefined)}
      onAddGit={onAddGit}
      onRetryGitImport={onRetryGitImport}
      onDismissGitImport={onDismissGitImport}
      onPull={vi.fn(async () => undefined)}
      onRemove={vi.fn(async () => undefined)}
      onImportZip={vi.fn(async () => undefined)}
      onExportZip={vi.fn(async () => undefined)}
      onClearError={vi.fn()}
    />,
  );
  return { onAddGit, onRetryGitImport, onDismissGitImport };
}

describe("ProjectPanel git import UI", () => {
  it("导入中只显示正在导入中，不显示拉取/导出/删除", () => {
    renderPanel({
      gitImports: [
        {
          tempId: "importing:1",
          url: "https://github.com/acme/new.git",
          name: "acme/new",
          status: "importing",
          error: null,
        },
      ],
    });
    expect(screen.getByText("acme/new")).toBeInTheDocument();
    expect(screen.getByText("正在导入中")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "拉取" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "导出" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /移除|删除/ })).not.toBeInTheDocument();
  });

  it("失败时显示错误并可重试/删除", async () => {
    const user = userEvent.setup();
    const { onRetryGitImport, onDismissGitImport } = renderPanel({
      gitImports: [
        {
          tempId: "failed:1",
          url: "https://github.com/acme/bad.git",
          name: "acme/bad",
          status: "failed",
          error: { code: "GIT_OPERATION", message: "clone failed: network" },
        },
      ],
    });
    expect(screen.getByRole("alert")).toHaveTextContent("clone failed: network");
    await user.click(screen.getByRole("button", { name: "重试" }));
    expect(onRetryGitImport).toHaveBeenCalledWith("failed:1");
    await user.click(screen.getByRole("button", { name: /删除导入失败项/ }));
    expect(onDismissGitImport).toHaveBeenCalledWith("failed:1");
  });

  it("已导入项目显示拉取/导出/移除", () => {
    renderPanel({ projects: [baseProject] });
    expect(screen.getByRole("button", { name: "拉取 acme/skills" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "导出" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "移除 acme/skills" })).toBeInTheDocument();
  });

  it("添加 Git 后立即清空输入并调用回调", async () => {
    const user = userEvent.setup();
    const { onAddGit } = renderPanel();
    const input = screen.getByLabelText("Git 仓库 URL");
    await user.type(input, "https://github.com/acme/skills.git");
    await user.click(screen.getByRole("button", { name: "添加 Git 项目" }));
    expect(onAddGit).toHaveBeenCalledWith("https://github.com/acme/skills.git");
    expect(input).toHaveValue("");
  });
});
