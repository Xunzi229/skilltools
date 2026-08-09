import type { CommandError } from "../model/skill";

export function normalizeCommandError(
  error: unknown,
  fallback = "操作失败，请重试",
): CommandError {
  if (typeof error === "string" && error.trim()) {
    return { code: "UNKNOWN", message: error };
  }
  if (typeof error === "object" && error !== null) {
    const candidate = error as Record<string, unknown>;
    if (typeof candidate.code === "string" && typeof candidate.message === "string") {
      return { code: candidate.code, message: candidate.message };
    }
    if (typeof candidate.message === "string" && candidate.message.trim()) {
      return { code: "UNKNOWN", message: candidate.message };
    }
  }
  if (error instanceof Error && error.message.trim()) {
    return { code: "UNKNOWN", message: error.message };
  }
  return { code: "UNKNOWN", message: fallback };
}

export function errorMessage(error: unknown, fallback = "操作失败，请重试"): string {
  return normalizeCommandError(error, fallback).message;
}

/** 将常见 updater / 网络错误转成更易读的中文提示。 */
export function formatUpdaterError(error: unknown): string {
  const raw = errorMessage(error, "检查更新失败");
  const lower = raw.toLowerCase();

  if (
    lower.includes("could not fetch a valid release json") ||
    lower.includes("release not found")
  ) {
    return "检查失败：无法获取更新清单（latest.json）。请确认能访问 GitHub Releases。";
  }
  if (
    lower.includes("error sending request") ||
    lower.includes("timed out") ||
    lower.includes("dns error") ||
    lower.includes("connection")
  ) {
    return `检查失败：网络请求失败（${raw}）。若在国内网络，可能需代理后重试。`;
  }
  if (lower.includes("platform") && lower.includes("not found")) {
    return `检查失败：当前平台在更新清单中无对应安装包（${raw}）。`;
  }
  if (lower.includes("permission") || lower.includes("not allowed")) {
    return `检查失败：缺少 updater 权限（${raw}）。`;
  }
  if (raw === "检查更新失败") {
    return raw;
  }
  return `检查失败：${raw}`;
}
