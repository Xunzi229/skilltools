import { describe, expect, it } from "vitest";
import { matchesLibrarySkillSearch } from "./skillDisplay";

describe("matchesLibrarySkillSearch taxonomy", () => {
  it("matches group and tag names", () => {
    const skill = {
      name: "foo",
      description: "bar",
      sourceRepo: null as string | null,
      groupId: "g1",
      tagIds: ["t1"],
    };
    const taxonomy = {
      groups: [{ id: "g1", name: "运维发布" }],
      tags: [{ id: "t1", name: "windows" }],
    };
    expect(matchesLibrarySkillSearch(skill, "运维", taxonomy)).toBe(true);
    expect(matchesLibrarySkillSearch(skill, "windows", taxonomy)).toBe(true);
    expect(matchesLibrarySkillSearch(skill, "macos", taxonomy)).toBe(false);
  });
});
