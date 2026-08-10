import { describe, expect, it } from "vitest";
import { skillCanonicalKey } from "./skill";

describe("skillCanonicalKey", () => {
  it("剥离 Windows verbatim 前缀并统一分隔符", () => {
    expect(
      skillCanonicalKey({
        currentPath: String.raw`C:\Users\Demo\library\skill`,
        resolvedPath: String.raw`\\?\C:\Users\Demo\library\skill`,
      }),
    ).toBe("c:/users/demo/library/skill");

    expect(
      skillCanonicalKey({
        currentPath: String.raw`\\?\UNC\server\share\skills\a`,
        resolvedPath: undefined,
      }),
    ).toBe("//server/share/skills/a");
  });
});
