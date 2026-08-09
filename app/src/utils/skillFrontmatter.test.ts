import { describe, expect, it } from "vitest";
import {
  customFrontmatterEntries,
  extractFrontmatterYaml,
  parseFrontmatterFields,
} from "./skillFrontmatter";

describe("skillFrontmatter", () => {
  it("提取并解析标准字段与缩进 metadata", () => {
    const markdown = `---
name: demo
description: "A skill"
license: MIT
metadata:
  author: org
  version: "1.0"
custom-key: hello
---

# Body
`;
    expect(extractFrontmatterYaml(markdown)).toContain("name: demo");
    const fields = parseFrontmatterFields(markdown);
    expect(fields.name).toBe("demo");
    expect(fields.description).toBe("A skill");
    expect(fields.license).toBe("MIT");
    expect(fields["custom-key"]).toBe("hello");
    expect(fields.metadata).toContain("author: org");
    expect(customFrontmatterEntries(fields)).toEqual([
      { key: "custom-key", value: "hello" },
    ]);
  });

  it("无 frontmatter 时返回空", () => {
    expect(parseFrontmatterFields("# bare\n")).toEqual({});
  });
});
