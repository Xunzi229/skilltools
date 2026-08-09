import { describe, expect, it } from "vitest";
import {
  errorMessage,
  formatUpdaterError,
  normalizeCommandError,
} from "./errors";

describe("normalizeCommandError", () => {
  it("keeps CommandError shape", () => {
    expect(
      normalizeCommandError({ code: "PATH_DENIED", message: "拒绝访问" }),
    ).toEqual({ code: "PATH_DENIED", message: "拒绝访问" });
  });

  it("surfaces backend IO uninstall/link-delete messages as-is", () => {
    const message =
      "文件操作失败：删除安装链接失败（C:\\\\skills\\\\demo）：拒绝访问。(os error 5)";
    expect(normalizeCommandError({ code: "IO", message })).toEqual({
      code: "IO",
      message,
    });
  });

  it("accepts plain string errors from Tauri plugins", () => {
    expect(
      normalizeCommandError("Could not fetch a valid release JSON from the remote"),
    ).toEqual({
      code: "UNKNOWN",
      message: "Could not fetch a valid release JSON from the remote",
    });
  });

  it("accepts Error instances", () => {
    expect(errorMessage(new Error("boom"), "fallback")).toBe("boom");
  });

  it("falls back when empty", () => {
    expect(normalizeCommandError("   ", "fallback").message).toBe("fallback");
  });
});

describe("formatUpdaterError", () => {
  it("maps release JSON fetch failure", () => {
    expect(
      formatUpdaterError("Could not fetch a valid release JSON from the remote"),
    ).toContain("无法获取更新清单");
  });

  it("keeps unknown details", () => {
    expect(formatUpdaterError("custom failure")).toBe("检查失败：custom failure");
  });
});
