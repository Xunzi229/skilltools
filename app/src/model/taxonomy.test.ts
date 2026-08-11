import { describe, expect, it } from "vitest";
import {
  EMPTY_LIBRARY_QUERY,
  isLibraryQueryActive,
  libraryQueryChips,
  matchesLibraryTaxonomy,
  toggleTagInQuery,
} from "./taxonomy";

describe("LibraryTaxonomyQuery", () => {
  it("matches ungrouped and AND tags", () => {
    const skill = { groupId: null as string | null, tagIds: ["t1", "t2"] };
    expect(
      matchesLibraryTaxonomy(skill, {
        groupScope: "ungrouped",
        tagIds: ["t1"],
        untaggedOnly: false,
      }),
    ).toBe(true);
    expect(
      matchesLibraryTaxonomy(skill, {
        groupScope: "ungrouped",
        tagIds: ["t1", "t3"],
        untaggedOnly: false,
      }),
    ).toBe(false);
    expect(
      matchesLibraryTaxonomy(skill, {
        groupScope: "all",
        tagIds: [],
        untaggedOnly: true,
      }),
    ).toBe(false);
  });

  it("toggle tag clears untaggedOnly", () => {
    const next = toggleTagInQuery(
      { ...EMPTY_LIBRARY_QUERY, untaggedOnly: true },
      "t1",
    );
    expect(next.untaggedOnly).toBe(false);
    expect(next.tagIds).toEqual(["t1"]);
    expect(isLibraryQueryActive(next)).toBe(true);
  });

  it("builds chips for group and tags", () => {
    const chips = libraryQueryChips(
      {
        groupScope: { groupId: "g1" },
        tagIds: ["t1"],
        untaggedOnly: false,
      },
      [{ id: "g1", name: "运维", order: 0, color: null }],
      [{ id: "t1", name: "windows", color: null }],
    );
    expect(chips.map((c) => c.label)).toEqual(["运维", "windows"]);
  });
});
