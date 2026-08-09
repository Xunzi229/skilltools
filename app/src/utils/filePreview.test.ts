import { describe, expect, it } from "vitest";
import { languageLabel, languageOf, previewKindOf } from "./filePreview";

describe("filePreview", () => {
  it("detects languages by extension", () => {
    expect(languageOf("scripts/assemble.py")).toBe("python");
    expect(languageOf("agents/openai.yaml")).toBe("yaml");
    expect(languageOf("SKILL.md")).toBe("markdown");
  });

  it("classifies preview kinds", () => {
    expect(previewKindOf("a.py", "text")).toBe("code");
    expect(previewKindOf("a.md", "markdown")).toBe("markdown");
    expect(previewKindOf("notes.txt", "text")).toBe("text");
  });

  it("labels languages", () => {
    expect(languageLabel("python")).toBe("Python");
  });
});
