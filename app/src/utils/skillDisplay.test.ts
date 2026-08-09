import { describe, expect, it } from "vitest";
import type { SkillSummary } from "../model/skill";
import {
  countUniqueSkills,
  displayDescription,
  displaySourceLabel,
  formatProviderLabels,
  matchesLibrarySkillSearch,
  projectNameFromGitUrl,
  stripMarkdownFrontmatter,
} from "./skillDisplay";

function summary(
  partial: Partial<SkillSummary> & Pick<SkillSummary, "id" | "provider" | "currentPath">,
): SkillSummary {
  return {
    name: partial.name ?? "skill",
    description: partial.description ?? "",
    status: partial.status ?? "active",
    originalPath: partial.originalPath ?? partial.currentPath,
    resolvedPath: partial.resolvedPath,
    providers: partial.providers,
    alsoInstalled: partial.alsoInstalled,
    warnings: partial.warnings ?? [],
    ...partial,
  };
}

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

  it("按 resolvedPath 去重计数，同名不同源仍分开", () => {
    const skills = [
      summary({
        id: "c1",
        provider: "cursor",
        currentPath: "/cursor/grill-me",
        resolvedPath: "/library/grill-me",
        providers: ["cursor", "claude", "codex"],
        alsoInstalled: [
          {
            id: "a1",
            provider: "claude",
            currentPath: "/claude/grill-me",
            status: "active",
          },
          {
            id: "x1",
            provider: "codex",
            currentPath: "/codex/grill-me",
            status: "active",
          },
        ],
      }),
      summary({
        id: "c2",
        provider: "cursor",
        name: "grill-me",
        currentPath: "/cursor/grill-me-copy",
        resolvedPath: "/library/other-grill-me",
        providers: ["cursor"],
      }),
    ];

    expect(countUniqueSkills(skills, (skill) => skill.status === "active")).toBe(2);
    expect(
      countUniqueSkills(skills, (skill) =>
        (skill.providers ?? [skill.provider]).includes("claude"),
      ),
    ).toBe(1);
    expect(formatProviderLabels(skills[0]!)).toBe("Cursor+Claude+Codex");
  });
});
