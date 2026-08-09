import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import App from "./App";
import type {
  BackupRecord,
  FileContent,
  FileNode,
  LibrarySkillDetail,
  LibrarySkillSummary,
  Project,
  ScanResult,
  SkillGroup,
  SkillDetail,
  SkillSummary,
  Tag,
} from "./model/skill";
import type { SkillApi } from "./api/skillApi";

const skills: SkillSummary[] = [
  {
    id: "cursor:brainstorming",
    name: "brainstorming",
    description: "在创作前探索想法",
    provider: "cursor",
    status: "active",
    originalPath: "/Users/demo/.cursor/skills/brainstorming",
    currentPath: "/Users/demo/.cursor/skills/brainstorming",
    warnings: [],
  },
  {
    id: "claude:tdd-test",
    name: "tdd-test",
    description: "测试驱动开发工作流",
    provider: "claude",
    status: "paused",
    originalPath: "/Users/demo/.claude/skills/tdd-test",
    currentPath: "/Users/demo/.skill-manager/paused/tdd-test",
    warnings: ["Skill 当前位于暂停目录"],
  },
];

const details: Record<string, SkillDetail> = {
  "cursor:brainstorming": {
    ...skills[0],
    skillMarkdown: "# Brainstorming\n\n探索并澄清想法。",
    files: ["SKILL.md"],
  },
  "claude:tdd-test": {
    ...skills[1],
    skillMarkdown: "# 测试驱动开发\n\n坚持 **红、绿、重构**。",
    files: ["SKILL.md", "references/examples.md"],
  },
};

const backups: BackupRecord[] = [
  {
    id: "backup-old",
    skillId: "cursor:brainstorming",
    skillName: "brainstorming",
    provider: "cursor",
    reason: "manual",
    createdAt: "2026-08-06T10:00:00.000Z",
    originalPath: "/Users/demo/.cursor/skills/brainstorming",
    archivePath: "/Users/demo/.skill-manager/backups/backup-old",
    checksum: "checksum-old",
  },
  {
    id: "backup-new",
    skillId: "claude:tdd-test",
    skillName: "tdd-test",
    provider: "claude",
    reason: "beforeDelete",
    createdAt: "2026-08-07T10:00:00.000Z",
    originalPath: "/Users/demo/.claude/skills/tdd-test",
    archivePath: "/Users/demo/.skill-manager/backups/backup-new",
    checksum: "checksum-new",
  },
];

const fileTrees: Record<string, FileNode[]> = {
  "cursor:brainstorming": [
    {
      name: "SKILL.md",
      relativePath: "SKILL.md",
      kind: "file",
      size: 41,
      children: [],
    },
  ],
  "claude:tdd-test": [
    {
      name: "references",
      relativePath: "references",
      kind: "directory",
      size: null,
      children: [
        {
          name: "examples.md",
          relativePath: "references/examples.md",
          kind: "file",
          size: 16,
          children: [],
        },
      ],
    },
    {
      name: "SKILL.md",
      relativePath: "SKILL.md",
      kind: "file",
      size: 30,
      children: [],
    },
  ],
};

function fileContent(skillId: string, relativePath: string): FileContent {
  if (relativePath === "SKILL.md") {
    return {
      relativePath,
      mediaType: "markdown",
      content: details[skillId].skillMarkdown,
      message: null,
    };
  }
  return {
    relativePath,
    mediaType: "markdown",
    content: "# 示例文件\n\n文件预览内容。",
    message: null,
  };
}

const scanResult = (
  nextSkills: SkillSummary[],
  warnings: string[] = [],
): ScanResult => ({ skills: nextSkills, warnings });

const projects: Project[] = [
  {
    id: "project-local",
    name: "skills",
    sourceType: "local",
    localPath: "/Users/demo/skills",
    remoteUrl: null,
    addedAt: "2026-08-07T10:00:00.000Z",
    lastUpdatedAt: "2026-08-07T09:30:00.000Z",
    lastSyncedAt: null,
    warnings: [],
  },
  {
    id: "project-git",
    name: "team/skills",
    sourceType: "git",
    localPath: "/Users/demo/.skill-manager/team-skills",
    remoteUrl: "https://example.com/team/skills.git",
    addedAt: "2026-08-07T10:00:00.000Z",
    lastUpdatedAt: "2026-08-07T11:00:00.000Z",
    lastSyncedAt: "2026-08-07T12:00:00.000Z",
    warnings: [],
  },
];

const librarySkills: LibrarySkillSummary[] = [
  {
    id: "library-reviewer",
    projectId: "project-local",
    name: "reviewer",
    description: "代码评审工作流",
    relativePath: "reviewer",
    absolutePath: "/Users/demo/skills/reviewer",
    parentSkillId: null,
    groupId: null,
    tagIds: [],
    installedProviders: [],
    warnings: [],
  },
  {
    id: "library-auto-code",
    projectId: "project-local",
    name: "auto-code",
    description: "自主编码流程包",
    relativePath: "auto-code",
    absolutePath: "/Users/demo/skills/auto-code",
    parentSkillId: null,
    groupId: null,
    tagIds: [],
    installedProviders: [],
    warnings: [],
  },
  {
    id: "library-auto-child",
    projectId: "project-local",
    name: "atom-doc-parse",
    description: "文档解析子 Skill",
    relativePath: "auto-code/skills/atom-doc-parse",
    absolutePath: "/Users/demo/skills/auto-code/skills/atom-doc-parse",
    parentSkillId: "library-auto-code",
    groupId: null,
    tagIds: [],
    installedProviders: [],
    warnings: [],
  },
];

const libraryDetail: LibrarySkillDetail = {
  ...librarySkills[0],
  skillMarkdown: "# Reviewer\n\n检查代码变更。",
  files: ["SKILL.md"],
};

const tags: Tag[] = [{ id: "tag-backend", name: "后端", color: "#315fb5" }];
const groups: SkillGroup[] = [{ id: "group-dev", name: "开发", order: 1 }];

function createApi(overrides: Partial<SkillApi> = {}): SkillApi {
  const unavailable = async (): Promise<never> => {
    throw new Error("本测试不应调用 Task 8 API");
  };

  return {
    scanSkills: async () => scanResult(skills),
    getSkillDetail: async (skillId) => details[skillId],
    listSkillTree: async (skillId) => fileTrees[skillId],
    readSkillFile: async (skillId, relativePath) => fileContent(skillId, relativePath),
    listExternalEditors: async () => [
      { id: "default", name: "默认应用" },
      { id: "notepad", name: "记事本" },
      { id: "reveal", name: "在资源管理器中显示" },
    ],
    openSkillFileExternal: async () => undefined,
    openLibrarySkillFileExternal: async () => undefined,
    pauseSkill: unavailable,
    resumeSkill: unavailable,
    createBackup: unavailable,
    listBackups: async () => [],
    restoreBackup: unavailable,
    deleteBackup: unavailable,
    cleanupBackups: async () => 0,
    deleteSkill: unavailable,
    listProjects: async () => projects,
    addLocalProject: unavailable,
    addGitProject: unavailable,
    pullGitProject: unavailable,
    removeProject: unavailable,
    listLibrarySkills: async () => librarySkills,
    getLibrarySkillDetail: async () => libraryDetail,
    listLibrarySkillTree: async () => fileTrees["cursor:brainstorming"],
    readLibrarySkillFile: async (_skillId, relativePath) =>
      fileContent("cursor:brainstorming", relativePath),
    writeSkillFile: unavailable,
    writeLibrarySkillFile: unavailable,
    installSkill: unavailable,
    uninstallSkill: unavailable,
    listInstallations: async () => [],
    getInstallOverview: async () => ({
      managed: [],
      unmanaged: [],
      duplicates: [],
      health: { issues: [], repaired: 0 },
    }),
    scanInstallHealth: async () => ({ issues: [], repaired: 0 }),
    repairInstallations: async () => ({ issues: [], repaired: 0 }),
    migrateProviderSkill: unavailable,
    listInstallPresets: async () => [],
    saveInstallPreset: unavailable,
    deleteInstallPreset: unavailable,
    applyInstallPreset: unavailable,
    validateSkillFrontmatter: async () => ({
      ok: true,
      name: null,
      description: null,
      fields: {},
      warnings: [],
    }),
    updateSkillMetadata: unavailable,
    updateLibrarySkillMetadata: unavailable,
    createLibrarySkill: unavailable,
    renameLibrarySkill: unavailable,
    deleteLibrarySkill: unavailable,
    listTags: async () => tags,
    createTag: async (name, color = null) => ({ id: `tag-${name}`, name, color }),
    renameTag: async (id, name) => ({ id, name, color: null }),
    updateTag: async (id, name, color) => ({ id, name, color }),
    deleteTag: async () => undefined,
    setSkillTags: unavailable,
    listGroups: async () => groups,
    createGroup: async (name, order) => ({ id: `group-${name}`, name, order }),
    renameGroup: async (id, name) => ({ id, name, order: 0 }),
    updateGroupOrder: async (id, order) => ({ id, name: "开发", order }),
    deleteGroup: async () => undefined,
    setSkillGroup: unavailable,
    getSettings: async () => ({
      theme: "light",
      skillRootOverrides: { cursor: null, claude: null, codex: null },
      backupRetentionDays: 30,
      backupMaxCount: 200,
      previewFontFamily: "Microsoft YaHei",
      previewFontSize: 14,
    }),
    saveSettings: async (settings) => settings,
    getAppPaths: async () => ({
      appDataDir: "/tmp/app-data",
      disabledDir: "/tmp/app-data/disabled",
      backupsDir: "/tmp/app-data/backups",
      libraryDir: "/tmp/app-data/library",
      cursorSkills: "/tmp/.cursor/skills",
      claudeSkills: "/tmp/.claude/skills",
      codexSkills: "/tmp/.codex/skills",
      defaultCursorSkills: "/tmp/.cursor/skills",
      defaultClaudeSkills: "/tmp/.claude/skills",
      defaultCodexSkills: "/tmp/.codex/skills",
    }),
    revealPath: async () => undefined,
    exportLibrarySkillZip: unavailable,
    exportProjectZip: unavailable,
    importSkillZip: unavailable,
    batchPauseSkills: async (skillIds) => ({
      total: skillIds.length,
      success: skillIds.length,
      failed: 0,
      skipped: 0,
      items: skillIds.map((id) => ({ id, status: "success" as const })),
    }),
    batchResumeSkills: async (skillIds) => ({
      total: skillIds.length,
      success: skillIds.length,
      failed: 0,
      skipped: 0,
      items: skillIds.map((id) => ({ id, status: "success" as const })),
    }),
    batchBackupSkills: async (skillIds) => ({
      total: skillIds.length,
      success: skillIds.length,
      failed: 0,
      skipped: 0,
      items: skillIds.map((id) => ({ id, status: "success" as const })),
    }),
    batchDeleteSkills: async (skillIds) => ({
      total: skillIds.length,
      success: skillIds.length,
      failed: 0,
      skipped: 0,
      items: skillIds.map((id) => ({ id, status: "success" as const })),
    }),
    batchInstallSkills: async (skillIds) => ({
      total: skillIds.length,
      success: skillIds.length,
      failed: 0,
      skipped: 0,
      items: skillIds.map((id) => ({ id, status: "success" as const })),
    }),
    batchUninstallSkills: async (skillIds) => ({
      total: skillIds.length,
      success: skillIds.length,
      failed: 0,
      skipped: 0,
      items: skillIds.map((id) => ({ id, status: "success" as const })),
    }),
    batchSetSkillGroup: async (skillIds) => ({
      total: skillIds.length,
      success: skillIds.length,
      failed: 0,
      skipped: 0,
      items: skillIds.map((id) => ({ id, status: "success" as const })),
    }),
    batchAddSkillTags: async (skillIds) => ({
      total: skillIds.length,
      success: skillIds.length,
      failed: 0,
      skipped: 0,
      items: skillIds.map((id) => ({ id, status: "success" as const })),
    }),
    batchMigrateProviderSkills: async (skillIds) => ({
      total: skillIds.length,
      success: skillIds.length,
      failed: 0,
      skipped: 0,
      items: skillIds.map((id) => ({ id, status: "success" as const })),
    }),
    ...overrides,
  };
}

async function renderLibrary(api = createApi()) {
  render(<App api={api} />);
  await screen.findByText("reviewer");
}

async function renderLoaded(api = createApi()) {
  const user = userEvent.setup();
  render(<App api={api} />);
  await screen.findByText("reviewer");
  const navigation = screen.getByRole("navigation", { name: "Skill 分类" });
  await user.click(within(navigation).getByRole("button", { name: /^已安装/ }));
  const list = await screen.findByRole("region", { name: "Skill 列表" });
  await within(list).findByText("brainstorming");
  return user;
}

describe("Skill Manager", () => {
  it("首次加载默认进入 Skill 库", async () => {
    await renderLibrary();

    expect(screen.getByRole("heading", { name: "Skill Manager" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Skill 库" })).toBeInTheDocument();
    expect(screen.getAllByText("reviewer").length).toBeGreaterThan(0);
    expect(screen.getByRole("tab", { name: /全部/ })).toBeInTheDocument();
  });

  it("按来源和暂停状态筛选", async () => {
    const user = await renderLoaded();
    const navigation = screen.getByRole("navigation", { name: "Skill 分类" });
    const list = screen.getByRole("region", { name: "Skill 列表" });

    await user.click(within(navigation).getByRole("button", { name: /Claude/ }));
    expect(within(list).queryByText("brainstorming")).not.toBeInTheDocument();
    expect(within(list).getByText("tdd-test")).toBeInTheDocument();

    await user.click(within(navigation).getByRole("button", { name: /已暂停/ }));
    expect(within(list).getByText("tdd-test")).toBeInTheDocument();
    expect(within(list).queryByText("brainstorming")).not.toBeInTheDocument();
  });

  it("按名称和描述搜索且不区分大小写", async () => {
    const user = await renderLoaded();
    const search = screen.getByRole("searchbox", { name: "搜索 Skill" });
    const list = screen.getByRole("region", { name: "Skill 列表" });

    await user.type(search, "BRAIN");
    expect(within(list).getByText("brainstorming")).toBeInTheDocument();
    expect(within(list).queryByText("tdd-test")).not.toBeInTheDocument();

    await user.clear(search);
    await user.type(search, "测试驱动");
    expect(within(list).getByText("tdd-test")).toBeInTheDocument();
    expect(within(list).queryByText("brainstorming")).not.toBeInTheDocument();
  });

  it("选择 Skill 后展示 Markdown、路径、文件和警告", async () => {
    const user = await renderLoaded();

    await user.click(screen.getByText("tdd-test"));

    expect(await screen.findByRole("heading", { name: "测试驱动开发" })).toBeInTheDocument();
    expect(screen.getByText("/Users/demo/.claude/skills/tdd-test")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "examples.md" })).toBeInTheDocument();
    expect(screen.getByText("Skill 当前位于暂停目录")).toBeInTheDocument();
  });

  it("打开详情加载目录树与 SKILL.md，点击文件后更新预览", async () => {
    const listSkillTree = vi.fn(async (skillId: string) => fileTrees[skillId]);
    const readSkillFile = vi.fn(async (skillId: string, relativePath: string) =>
      fileContent(skillId, relativePath),
    );
    const user = await renderLoaded(createApi({ listSkillTree, readSkillFile }));

    expect(await screen.findByRole("tree", { name: "Skill 目录结构" })).toBeInTheDocument();
    expect(await screen.findByRole("heading", { name: "Brainstorming" })).toBeInTheDocument();
    expect(listSkillTree).toHaveBeenCalledWith("cursor:brainstorming");
    expect(readSkillFile).toHaveBeenCalledWith("cursor:brainstorming", "SKILL.md");

    await user.click(screen.getByText("tdd-test"));
    await user.click(await screen.findByRole("button", { name: "examples.md" }));

    expect(await screen.findByRole("heading", { name: "示例文件" })).toBeInTheDocument();
    expect(screen.getByText("文件预览内容。")).toBeInTheDocument();
    expect(readSkillFile).toHaveBeenCalledWith(
      "claude:tdd-test",
      "references/examples.md",
    );
  });

  it("点击目录可收起和展开子目录", async () => {
    const user = await renderLoaded();

    await user.click(screen.getByText("tdd-test"));
    expect(await screen.findByRole("button", { name: "examples.md" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "收起 references" }));
    expect(screen.queryByRole("button", { name: "examples.md" })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "展开 references" }));
    expect(screen.getByRole("button", { name: "examples.md" })).toBeInTheDocument();
  });

  it("右键文件悬停打开可选择应用", async () => {
    const openSkillFileExternal = vi.fn(async () => undefined);
    const user = await renderLoaded(createApi({ openSkillFileExternal }));

    const file = await screen.findByRole("button", { name: "SKILL.md" });
    await user.pointer({ keys: "[MouseRight>]", target: file });

    expect(await screen.findByRole("menu", { name: "文件菜单" })).toBeInTheDocument();
    await user.hover(screen.getByRole("menuitem", { name: "打开" }));
    expect(await screen.findByRole("menu", { name: "选择应用" })).toBeInTheDocument();
    await user.click(screen.getByRole("menuitem", { name: "记事本" }));

    expect(openSkillFileExternal).toHaveBeenCalledWith(
      "cursor:brainstorming",
      "SKILL.md",
      "notepad",
    );
  });

  it("侧栏底部展示设置入口", async () => {
    const user = userEvent.setup();
    await renderLibrary();
    const settingsButton = screen.getByRole("button", { name: "设置" });
    expect(settingsButton).toBeEnabled();
    await user.click(settingsButton);
    expect(await screen.findByRole("heading", { name: "设置" })).toBeInTheDocument();
    expect(await screen.findByRole("heading", { name: "预览字体" })).toBeInTheDocument();
  });

  it("快速切换时忽略过期的详情响应", async () => {
    let resolveClaude: ((detail: SkillDetail) => void) | undefined;
    const api = createApi({
      getSkillDetail: (skillId) => {
        if (skillId === "claude:tdd-test") {
          return new Promise((resolve) => {
            resolveClaude = resolve;
          });
        }
        return Promise.resolve(details[skillId]);
      },
    });
    const user = await renderLoaded(api);

    await user.click(screen.getByText("tdd-test"));
    await user.click(screen.getByText("brainstorming"));
    expect(await screen.findByRole("heading", { name: "Brainstorming" })).toBeInTheDocument();

    resolveClaude?.(details["claude:tdd-test"]);
    await waitFor(() => {
      expect(screen.queryByRole("heading", { name: "测试驱动开发" })).not.toBeInTheDocument();
    });
  });

  it("扫描失败时展示中文错误并支持重试", async () => {
    const scanSkills = vi
      .fn<() => Promise<ScanResult>>()
      .mockRejectedValueOnce({ code: "IO", message: "目录读取失败" })
      .mockResolvedValueOnce(scanResult(skills));
    const user = userEvent.setup();
    render(<App api={createApi({ scanSkills })} />);
    await screen.findByText("reviewer");
    await user.click(
      within(screen.getByRole("navigation", { name: "Skill 分类" })).getByRole(
        "button",
        { name: /^已安装/ },
      ),
    );

    expect(await screen.findByText("扫描失败：目录读取失败")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "重试扫描" }));

    const list = await screen.findByLabelText("Skill 列表");
    expect(await within(list).findByText("brainstorming")).toBeInTheDocument();
    expect(scanSkills).toHaveBeenCalledTimes(2);
  });

  it("刷新后即使所选 ID 不变也会重新加载详情", async () => {
    const getSkillDetail = vi
      .fn<(skillId: string) => Promise<SkillDetail>>()
      .mockResolvedValueOnce(details["cursor:brainstorming"])
      .mockResolvedValueOnce({
        ...details["cursor:brainstorming"],
        skillMarkdown: "# Brainstorming\n\n刷新后的最新内容。",
        warnings: ["内容已更新"],
      });
    const readSkillFile = vi
      .fn<(skillId: string, relativePath: string) => Promise<FileContent>>()
      .mockResolvedValueOnce(fileContent("cursor:brainstorming", "SKILL.md"))
      .mockResolvedValueOnce({
        relativePath: "SKILL.md",
        mediaType: "markdown",
        content: "# Brainstorming\n\n刷新后的最新内容。",
        message: null,
      });
    const user = await renderLoaded(createApi({ getSkillDetail, readSkillFile }));

    expect(await screen.findByText("探索并澄清想法。")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /刷新扫描/ }));

    expect(await screen.findByText("刷新后的最新内容。")).toBeInTheDocument();
    expect(screen.getByText("内容已更新")).toBeInTheDocument();
    expect(getSkillDetail).toHaveBeenCalledTimes(2);
  });

  it("扫描结果为空时展示空状态", async () => {
    const user = userEvent.setup();
    render(<App api={createApi({ scanSkills: async () => scanResult([]) })} />);
    await screen.findByText("reviewer");
    await user.click(
      within(screen.getByRole("navigation", { name: "Skill 分类" })).getByRole(
        "button",
        { name: /^已安装/ },
      ),
    );

    expect(await screen.findByText("未扫描到 Skill")).toBeInTheDocument();
    expect(screen.getByText("请确认本地 Skill 目录中已有内容。")).toBeInTheDocument();
  });

  it("展示根目录扫描警告且保留其它 Skill", async () => {
    const user = userEvent.setup();
    render(
      <App
        api={createApi({
          scanSkills: async () =>
            scanResult(skills, ["无法读取 Skill 根目录 /restricted：拒绝访问"]),
        })}
      />,
    );
    await screen.findByText("reviewer");
    await user.click(
      within(screen.getByRole("navigation", { name: "Skill 分类" })).getByRole(
        "button",
        { name: /^已安装/ },
      ),
    );

    const list = await screen.findByRole("region", { name: "Skill 列表" });
    expect(await within(list).findByText("brainstorming")).toBeInTheDocument();
    expect(screen.getByText(/无法读取 Skill 根目录.*拒绝访问/)).toBeInTheDocument();
  });

  it("Markdown 不渲染远程图片", async () => {
    const remoteImageDetail = {
      ...details["cursor:brainstorming"],
      skillMarkdown: "![remote](https://example.com/tracker.png)",
    };
    await renderLoaded(
      createApi({ getSkillDetail: async () => remoteImageDetail }),
    );

    expect(screen.queryByRole("img")).not.toBeInTheDocument();
  });

  it("备份记录为空时展示空状态", async () => {
    const user = userEvent.setup();
    await renderLoaded();

    await user.click(screen.getByRole("button", { name: /备份记录/ }));

    expect(await screen.findByText("暂无备份记录")).toBeInTheDocument();
  });

  it("侧栏显示真实备份数量", async () => {
    await renderLoaded(createApi({ listBackups: async () => backups }));

    const backupButton = screen.getByRole("button", { name: /备份记录/ });
    await waitFor(() => expect(backupButton).toHaveTextContent("2"));
  });

  it("Skill 操作按钮可用", async () => {
    await renderLoaded();
    const actions = await screen.findByRole("group", { name: "Skill 操作" });

    for (const name of ["暂停", "备份", "删除"]) {
      const button = within(actions).getByRole("button", { name });
      expect(button).toBeEnabled();
    }
  });

  it("删除需二次确认，确认后只调用一次并清空选择", async () => {
    const deleteSkill = vi.fn(async () => backups[1]);
    const scanSkills = vi
      .fn<() => Promise<ScanResult>>()
      .mockResolvedValueOnce(scanResult(skills))
      .mockResolvedValueOnce(scanResult([skills[1]]));
    const user = await renderLoaded(createApi({ deleteSkill, scanSkills }));

    await user.click(await screen.findByRole("button", { name: "删除" }));
    expect(deleteSkill).not.toHaveBeenCalled();
    expect(screen.getByText(/先自动备份再删除/)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "备份并删除" }));
    await waitFor(() => expect(deleteSkill).toHaveBeenCalledTimes(1));
    expect(await screen.findByText("选择一个 Skill 查看详情")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "brainstorming" })).not.toBeInTheDocument();
  });

  it("删除处理中禁用确认按钮并阻止重复提交", async () => {
    let resolveDelete: ((backup: BackupRecord) => void) | undefined;
    const deleteSkill = vi.fn(
      () =>
        new Promise<BackupRecord>((resolve) => {
          resolveDelete = resolve;
        }),
    );
    const user = await renderLoaded(createApi({ deleteSkill }));

    await user.click(await screen.findByRole("button", { name: "删除" }));
    const confirm = screen.getByRole("button", { name: "备份并删除" });
    await user.click(confirm);

    expect(confirm).toBeDisabled();
    await user.click(confirm);
    expect(deleteSkill).toHaveBeenCalledTimes(1);
    resolveDelete?.(backups[1]);
  });

  it("暂停成功后刷新为已暂停并显示恢复按钮", async () => {
    const pausedSummary: SkillSummary = {
      ...skills[0],
      status: "paused",
      currentPath: "/Users/demo/.skill-manager/paused/brainstorming",
    };
    const pausedDetail: SkillDetail = {
      ...details["cursor:brainstorming"],
      ...pausedSummary,
    };
    const scanSkills = vi
      .fn<() => Promise<ScanResult>>()
      .mockResolvedValueOnce(scanResult(skills))
      .mockResolvedValue(scanResult([pausedSummary, skills[1]]));
    const getSkillDetail = vi
      .fn<(skillId: string) => Promise<SkillDetail>>()
      .mockResolvedValueOnce(details["cursor:brainstorming"])
      .mockResolvedValue(pausedDetail);
    const pauseSkill = vi.fn(async () => pausedDetail);
    const user = await renderLoaded(createApi({ scanSkills, getSkillDetail, pauseSkill }));

    await user.click(await screen.findByRole("button", { name: "暂停" }));

    expect(await screen.findByRole("button", { name: "恢复" })).toBeEnabled();
    expect(screen.getAllByText("已暂停").length).toBeGreaterThan(0);
    expect(pauseSkill).toHaveBeenCalledWith("cursor:brainstorming");
  });

  it("手动备份调用 createBackup 并可进入备份中心查看", async () => {
    const createBackup = vi.fn(async () => backups[0]);
    const listBackups = vi.fn(async () => [backups[0]]);
    const user = await renderLoaded(createApi({ createBackup, listBackups }));

    await user.click(await screen.findByRole("button", { name: "备份" }));
    await waitFor(() =>
      expect(createBackup).toHaveBeenCalledWith("cursor:brainstorming"),
    );
    await waitFor(() => expect(listBackups).toHaveBeenCalled());
    expect(screen.getByRole("button", { name: /备份记录/ })).toHaveTextContent("1");
    await user.click(screen.getByRole("button", { name: /备份记录/ }));

    const list = await screen.findByRole("region", { name: "备份列表" });
    expect(within(list).getByRole("button", { name: /brainstorming/ })).toBeInTheDocument();
  });

  it("备份中心按时间倒序展示并在确认后恢复", async () => {
    const restoreBackup = vi.fn(async () => details["claude:tdd-test"]);
    const user = userEvent.setup();
    await renderLoaded(createApi({ listBackups: async () => backups, restoreBackup }));

    await user.click(screen.getByRole("button", { name: /备份记录/ }));
    const list = await screen.findByRole("region", { name: "备份列表" });
    const items = within(list).getAllByRole("button");
    expect(items[0]).toHaveTextContent("tdd-test");
    expect(items[1]).toHaveTextContent("brainstorming");

    await user.click(items[0]);
    expect(screen.getByText("删除前")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "恢复备份" }));
    expect(restoreBackup).not.toHaveBeenCalled();
    expect(screen.getByText(/目标已存在时不会覆盖/)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "确认恢复" }));
    await waitFor(() =>
      expect(restoreBackup).toHaveBeenCalledWith("backup-new"),
    );
  });

  it("恢复目标冲突展示中文错误且保留备份详情", async () => {
    const restoreBackup = vi.fn(async () => {
      throw {
        code: "TARGET_CONFLICT",
        message: "目标位置已存在",
        stack: "rust::backtrace",
      };
    });
    const user = userEvent.setup();
    await renderLoaded(createApi({ listBackups: async () => backups, restoreBackup }));

    await user.click(screen.getByRole("button", { name: /备份记录/ }));
    await user.click(await screen.findByRole("button", { name: /tdd-test/ }));
    await user.click(screen.getByRole("button", { name: "恢复备份" }));
    await user.click(screen.getByRole("button", { name: "确认恢复" }));

    expect(await screen.findByText("目标位置已存在")).toBeInTheDocument();
    expect(screen.queryByText("rust::backtrace")).not.toBeInTheDocument();
    expect(screen.getByText("checksum-new")).toBeInTheDocument();
  });

  it("操作失败展示中文 message 且保留 Skill 详情", async () => {
    const pauseSkill = vi.fn(async () => {
      throw {
        code: "IO",
        message: "暂停失败：目录被占用",
        stack: "rust::backtrace",
      };
    });
    const user = await renderLoaded(createApi({ pauseSkill }));

    await user.click(await screen.findByRole("button", { name: "暂停" }));

    expect(await screen.findByText("暂停失败：目录被占用")).toBeInTheDocument();
    expect(screen.queryByText("rust::backtrace")).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Brainstorming" })).toBeInTheDocument();
  });

  it("备份加载失败时展示错误并支持重试", async () => {
    const listBackups = vi
      .fn<() => Promise<BackupRecord[]>>()
      .mockRejectedValueOnce({ code: "IO", message: "备份目录读取失败" })
      .mockResolvedValueOnce(backups);
    const user = userEvent.setup();
    await renderLoaded(createApi({ listBackups }));

    await user.click(screen.getByRole("button", { name: /备份记录/ }));
    expect(await screen.findByText("备份目录读取失败")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "重试" }));

    expect(await screen.findByRole("button", { name: /tdd-test/ })).toBeInTheDocument();
    expect(listBackups).toHaveBeenCalledTimes(2);
  });

  it("可在 Skill 库、分组、标签、项目和已安装导航间切换", async () => {
    await renderLibrary();
    const user = userEvent.setup();
    const navigation = screen.getByRole("navigation", { name: "Skill 分类" });

    await user.click(within(navigation).getByRole("button", { name: /Skill 库/ }));
    expect(
      await within(screen.getByRole("region", { name: "库 Skill 列表" })).findByText(
        "reviewer",
      ),
    ).toBeInTheDocument();

    expect(within(navigation).getByRole("button", { name: /^开发/ })).toBeInTheDocument();
    expect(within(navigation).getByRole("button", { name: /^后端/ })).toBeInTheDocument();
    expect(within(navigation).getByRole("button", { name: /^项目/ })).toBeInTheDocument();

    await user.click(within(navigation).getByRole("button", { name: /已安装/ }));
    expect(
      await within(screen.getByRole("region", { name: "Skill 列表" })).findByText(
        "brainstorming",
      ),
    ).toBeInTheDocument();
  });

  it("从库勾选后进入安装页仍保留勾选数量", async () => {
    await renderLibrary();
    const user = userEvent.setup();
    const list = screen.getByRole("region", { name: "库 Skill 列表" });
    await user.click(within(list).getByRole("checkbox", { name: "选择 reviewer" }));

    const navigation = screen.getByRole("navigation", { name: "Skill 分类" });
    await user.click(within(navigation).getByRole("button", { name: /^安装/ }));

    expect(await screen.findByText("已选 1 个库 Skill")).toBeInTheDocument();
  });

  it("点击父 Skill 可收起和展开子 Skill", async () => {
    const user = userEvent.setup();
    await renderLibrary();
    const list = screen.getByRole("region", { name: "库 Skill 列表" });

    expect(within(list).getByText("atom-doc-parse")).toBeInTheDocument();
    await user.click(within(list).getByRole("button", { name: /收起 auto-code 的子 Skill/ }));
    expect(within(list).queryByText("atom-doc-parse")).not.toBeInTheDocument();

    await user.click(within(list).getByRole("button", { name: /展开 auto-code 的子 Skill/ }));
    expect(within(list).getByText("atom-doc-parse")).toBeInTheDocument();
  });

  it("库 Skill 可编辑标签和分组", async () => {
    const setSkillTags = vi.fn(async () => ({
      ...librarySkills[0],
      tagIds: ["tag-backend"],
    }));
    const setSkillGroup = vi.fn(async () => ({
      ...librarySkills[0],
      groupId: "group-dev",
    }));
    const user = userEvent.setup();
    await renderLibrary(createApi({ setSkillTags, setSkillGroup }));

    await user.click(
      await within(screen.getByRole("region", { name: "库 Skill 列表" })).findByText(
        "reviewer",
      ),
    );
    await user.click(screen.getByRole("checkbox", { name: "后端" }));
    await user.selectOptions(screen.getByRole("combobox", { name: "分组" }), "group-dev");

    await waitFor(() =>
      expect(setSkillTags).toHaveBeenCalledWith("library-reviewer", ["tag-backend"]),
    );
    expect(setSkillGroup).toHaveBeenCalledWith("library-reviewer", "group-dev");
  });

  it("侧栏可新建标签并筛选", async () => {
    let currentTags = [...tags];
    const createTag = vi.fn(async (name: string) => {
      const tag = { id: "tag-new", name, color: null };
      currentTags = [...currentTags, tag];
      return tag;
    });
    const user = userEvent.setup();
    await renderLibrary(
      createApi({
        createTag,
        listTags: async () => currentTags,
      }),
    );

    const navigation = screen.getByRole("navigation", { name: "Skill 分类" });
    await user.click(within(navigation).getByRole("button", { name: "新建标签" }));
    await user.type(screen.getByRole("textbox", { name: "名称" }), "前端");
    await user.click(screen.getByRole("button", { name: "创建" }));

    await waitFor(() => expect(createTag).toHaveBeenCalledWith("前端", null));
    expect(
      await within(navigation).findByRole("button", { name: /^前端/ }),
    ).toBeInTheDocument();
  });

  it("详情可新建分组并应用到当前 Skill", async () => {
    const created = { id: "group-ops", name: "运维", order: 2 };
    const createGroup = vi.fn(async () => created);
    const setSkillGroup = vi.fn(async () => ({
      ...librarySkills[0],
      groupId: created.id,
    }));
    const user = userEvent.setup();
    await renderLibrary(createApi({ createGroup, setSkillGroup }));

    await user.click(
      await within(screen.getByRole("region", { name: "库 Skill 列表" })).findByText(
        "reviewer",
      ),
    );
    const detail = screen.getByRole("region", { name: "库 Skill 详情" });
    await user.click(within(detail).getByRole("button", { name: "新建分组" }));
    await user.type(screen.getByRole("textbox", { name: "名称" }), "运维");
    await user.click(screen.getByRole("button", { name: "创建并应用" }));

    await waitFor(() => expect(createGroup).toHaveBeenCalled());
    await waitFor(() =>
      expect(setSkillGroup).toHaveBeenCalledWith("library-reviewer", "group-ops"),
    );
  });

  it("安装开关遇到目标冲突时展示中文错误并恢复开关", async () => {
    const installSkill = vi.fn(async () => {
      throw { code: "TARGET_CONFLICT", message: "目标位置已存在，请先移除冲突目录" };
    });
    const user = userEvent.setup();
    await renderLibrary(createApi({ installSkill }));

    await user.click(
      await within(screen.getByRole("region", { name: "库 Skill 列表" })).findByText(
        "reviewer",
      ),
    );
    const toggle = screen.getByRole("checkbox", { name: "安装到 Cursor" });
    await user.click(toggle);

    expect(await screen.findByText("目标位置已存在，请先移除冲突目录")).toBeInTheDocument();
    expect(toggle).not.toBeChecked();
    expect(installSkill).toHaveBeenCalledTimes(1);
  });

  it("项目面板展示名称与更新/拉取时间，以及添加与拉取错误", async () => {
    const addLocalProject = vi.fn(async () => {
      throw { code: "INVALID_PROJECT_PATH", message: "本地路径不存在或不可读" };
    });
    const pullGitProject = vi.fn(async () => {
      throw { code: "GIT_OPERATION", message: "Git 拉取失败：存在未提交修改" };
    });
    const user = userEvent.setup();
    await renderLoaded(createApi({ addLocalProject, pullGitProject }));

    await user.click(screen.getByRole("button", { name: /项目/ }));
    expect(await screen.findByText("team/skills")).toBeInTheDocument();
    expect(screen.getAllByText(/最后更新 .* · 拉取 .*/).length).toBeGreaterThan(0);
    expect(screen.getByText(/拉取 2026\/08\/07/)).toBeInTheDocument();

    await user.type(screen.getByRole("textbox", { name: "本地项目路径" }), "/missing");
    await user.click(screen.getByRole("button", { name: "添加本地项目" }));
    expect(await screen.findByText("本地路径不存在或不可读")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "拉取 team/skills" }));
    expect(await screen.findByText("Git 拉取失败：存在未提交修改")).toBeInTheDocument();
  });
});
