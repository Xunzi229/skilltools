import { describe, expect, it } from "vitest";
import { displayDescription, stripMarkdownFrontmatter } from "./skillDisplay";

describe("skillDisplay", () => {
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
});
