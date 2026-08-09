import { describe, expect, it } from "vitest";
import {
  displayDescription,
  displaySourceLabel,
  matchesLibrarySkillSearch,
  projectNameFromGitUrl,
  stripMarkdownFrontmatter,
} from "./skillDisplay";

describe("skillDisplay", () => {
  it("从 Git URL 解析 owner/repo 展示名", () => {
    expect(projectNameFromGitUrl("git@github.com:mattpocock/skills.git")).toBe(
      "mattpocock/skills",
    );
    expect(projectNameFromGitUrl("https://github.com/mattpocock/skills.git")).toBe(
      "mattpocock/skills",
    );
    expect(projectNameFromGitUrl("ssh://git@github.com/team/skills.git")).toBe(
      "team/skills",
    );
    expect(projectNameFromGitUrl("https://example.com/skills.git")).toBe("skills");
  });

  it("详情描述去掉 TRIGGER 段并截断", () => {
    const raw =
      "Evaluate Java project test coverage metrics. Parses JaCoCo XML reports. TRIGGER when user mentions: 'test coverage', 'JaCoCo'.";
    expect(displayDescription(raw)).toBe(
      "Evaluate Java project test coverage metrics. Parses JaCoCo XML reports.",
    );
    expect(displayDescription(raw, 40)).toBe(
      "Evaluate Java project test coverage metr…",
    );
  });

  it("预览时剥离 YAML frontmatter", () => {
    const markdown = `---
name: java-test-coverage-assessment
description: >
  Evaluate coverage.
type: skill
---

# Java Test Coverage Assessment Skill

## Overview
`;
    expect(stripMarkdownFrontmatter(markdown)).toBe(
      "# Java Test Coverage Assessment Skill\n\n## Overview\n",
    );
    expect(stripMarkdownFrontmatter("# Just a title\n")).toBe("# Just a title\n");
  });

  it("库搜索支持名称、描述与来源", () => {
    const skill = {
      name: "ask-matt",
      description: "Ask Matt workflow",
      sourceRepo: "acme/skills-kit",
    };
    expect(matchesLibrarySkillSearch(skill, "ask")).toBe(true);
    expect(matchesLibrarySkillSearch(skill, "workflow")).toBe(true);
    expect(matchesLibrarySkillSearch(skill, "acme")).toBe(true);
    expect(matchesLibrarySkillSearch(skill, "skills-kit")).toBe(true);
    expect(matchesLibrarySkillSearch(skill, "acme/skills")).toBe(true);
    expect(
      matchesLibrarySkillSearch(
        { name: "local", description: "only local", sourceRepo: null },
        "acme",
      ),
    ).toBe(false);
  });

  it("无来源时显示本地", () => {
    expect(displaySourceLabel("acme/skills")).toBe("acme/skills");
    expect(displaySourceLabel(null)).toBe("本地");
    expect(displaySourceLabel("  ")).toBe("本地");
  });
});
