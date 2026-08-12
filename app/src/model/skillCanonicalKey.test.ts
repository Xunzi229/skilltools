import { describe, expect, it } from "vitest";
import { normalizePathKey, skillCanonicalKey } from "./skill";

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
    expect(normalizePathKey(String.raw`\\?\unc\Server\Share\Skills`)).toBe(
      "//server/share/skills",
    );
  });

  it("折叠中间重复斜杠（对齐 Rust path_norm）", () => {
    // 末尾反斜杠不能写在 String.raw`...` 里（会转义结束反引号）
    expect(normalizePathKey("C:\\Users\\\\Demo\\\\\\library\\skill\\")).toBe(
      "c:/users/demo/library/skill",
    );
    expect(normalizePathKey("//server//share///a//")).toBe("//server/share/a");
  });

  it("POSIX 保留大小写且 Windows 仅折叠 ASCII 大小写", () => {
    expect(normalizePathKey("/Users/Demo/技能")).toBe("/Users/Demo/技能");
    expect(normalizePathKey(String.raw`C:\Users\Demo\ÄSkill`)).toBe(
      "c:/users/demo/Äskill",
    );
  });
});
