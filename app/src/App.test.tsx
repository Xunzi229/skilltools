import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import App from "./App";
import type {
  BackupRecord,
  FileContent,
  FileNode,
  ScanResult,
  SkillDetail,
  SkillSummary,
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

function createApi(overrides: Partial<SkillApi> = {}): SkillApi {
  const unavailable = async (): Promise<never> => {
    throw new Error("本测试不应调用 Task 8 API");
  };

  return {
    scanSkills: async () => scanResult(skills),
    getSkillDetail: async (skillId) => details[skillId],
    listSkillTree: async (skillId) => fileTrees[skillId],
    readSkillFile: async (skillId, relativePath) => fileContent(skillId, relativePath),
    pauseSkill: unavailable,
    resumeSkill: unavailable,
    createBackup: unavailable,
    listBackups: async () => [],
    restoreBackup: unavailable,
    deleteSkill: unavailable,
    ...overrides,
  };
}

async function renderLoaded(api = createApi()) {
  render(<App api={api} />);
  await screen.findByText("brainstorming");
}

describe("Skill Manager", () => {
  it("首次加载后展示扫描到的 Skill", async () => {
    await renderLoaded();

    expect(screen.getByRole("heading", { name: "Skill Manager" })).toBeInTheDocument();
    expect(screen.getByText("brainstorming")).toBeInTheDocument();
    expect(screen.getByText("tdd-test")).toBeInTheDocument();
  });

  it("按来源和暂停状态筛选", async () => {
    const user = userEvent.setup();
    await renderLoaded();
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
    const user = userEvent.setup();
    await renderLoaded();
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
    const user = userEvent.setup();
    await renderLoaded();

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
    const user = userEvent.setup();
    await renderLoaded(createApi({ listSkillTree, readSkillFile }));

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
    const user = userEvent.setup();
    await renderLoaded(api);

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
    const user = userEvent.setup();
    await renderLoaded(createApi({ getSkillDetail, readSkillFile }));

    expect(await screen.findByText("探索并澄清想法。")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /刷新扫描/ }));

    expect(await screen.findByText("刷新后的最新内容。")).toBeInTheDocument();
    expect(screen.getByText("内容已更新")).toBeInTheDocument();
    expect(getSkillDetail).toHaveBeenCalledTimes(2);
  });

  it("扫描结果为空时展示空状态", async () => {
    render(<App api={createApi({ scanSkills: async () => scanResult([]) })} />);

    expect(await screen.findByText("未扫描到 Skill")).toBeInTheDocument();
    expect(screen.getByText("请确认本地 Skill 目录中已有内容。")).toBeInTheDocument();
  });

  it("展示根目录扫描警告且保留其它 Skill", async () => {
    render(
      <App
        api={createApi({
          scanSkills: async () =>
            scanResult(skills, ["无法读取 Skill 根目录 /restricted：拒绝访问"]),
        })}
      />,
    );

    expect(await screen.findByText("brainstorming")).toBeInTheDocument();
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
    const user = userEvent.setup();
    await renderLoaded(createApi({ deleteSkill, scanSkills }));

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
    const user = userEvent.setup();
    await renderLoaded(createApi({ deleteSkill }));

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
    const user = userEvent.setup();
    await renderLoaded(createApi({ scanSkills, getSkillDetail, pauseSkill }));

    await user.click(await screen.findByRole("button", { name: "暂停" }));

    expect(await screen.findByRole("button", { name: "恢复" })).toBeEnabled();
    expect(screen.getAllByText("已暂停").length).toBeGreaterThan(0);
    expect(pauseSkill).toHaveBeenCalledWith("cursor:brainstorming");
  });

  it("手动备份调用 createBackup 并可进入备份中心查看", async () => {
    const createBackup = vi.fn(async () => backups[0]);
    const listBackups = vi.fn(async () => [backups[0]]);
    const user = userEvent.setup();
    await renderLoaded(createApi({ createBackup, listBackups }));

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
    const user = userEvent.setup();
    await renderLoaded(createApi({ pauseSkill }));

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
});
