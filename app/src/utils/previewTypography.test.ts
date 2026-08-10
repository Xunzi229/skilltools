import { describe, expect, it } from "vitest";
import { filterFontOptions } from "./previewTypography";

describe("filterFontOptions", () => {
  const options = [
    { label: "微软雅黑", family: "Microsoft YaHei" },
    { label: "Consolas", family: "Consolas" },
    { label: "JetBrains Mono", family: "JetBrains Mono" },
    { label: "苹方 / 系统黑体", family: "PingFang SC" },
  ];

  it("空关键字返回全部", () => {
    expect(filterFontOptions(options, "  ")).toHaveLength(options.length);
  });

  it("按关键字包含匹配", () => {
    expect(filterFontOptions(options, "mono").map((item) => item.family)).toEqual([
      "JetBrains Mono",
    ]);
    expect(filterFontOptions(options, "雅黑").map((item) => item.family)).toEqual([
      "Microsoft YaHei",
    ]);
  });

  it("支持空格分词与大小写不敏感", () => {
    expect(filterFontOptions(options, "jet mono").map((item) => item.family)).toEqual([
      "JetBrains Mono",
    ]);
  });

  it("支持子序列模糊匹配", () => {
    expect(filterFontOptions(options, "csl").map((item) => item.family)).toEqual([
      "Consolas",
    ]);
  });
});
