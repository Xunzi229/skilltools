import { issueIsRebuildable, type InstallHealthIssue } from "./skill";

function issue(
  kind: InstallHealthIssue["kind"],
  librarySkillId: string | null = "lib-1",
): InstallHealthIssue {
  return {
    kind,
    provider: "cursor",
    librarySkillId,
    targetPath: "/tmp/skill",
    message: kind,
    repairable: kind !== "notSymlink",
  };
}

describe("issueIsRebuildable", () => {
  it("rebuilds missing, broken, mismatched links with a library skill", () => {
    expect(issueIsRebuildable(issue("missingTarget"))).toBe(true);
    expect(issueIsRebuildable(issue("brokenLink"))).toBe(true);
    expect(issueIsRebuildable(issue("sourceMismatch"))).toBe(true);
    expect(issueIsRebuildable(issue("diskOrphan", null))).toBe(true);
  });

  it("does not rebuild orphans without a source or real directories", () => {
    expect(issueIsRebuildable(issue("indexOrphan"))).toBe(false);
    expect(issueIsRebuildable(issue("notSymlink"))).toBe(false);
    expect(issueIsRebuildable(issue("missingTarget", null))).toBe(false);
  });
});
