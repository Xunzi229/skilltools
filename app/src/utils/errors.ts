import { t } from "../i18n";
import type { CommandError } from "../model/skill";

export function normalizeCommandError(
  error: unknown,
  fallback = t("common.operationFailed"),
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

export function errorMessage(
  error: unknown,
  fallback = t("common.operationFailed"),
): string {
  return normalizeCommandError(error, fallback).message;
}

/** Map common updater / network errors to readable messages. */
export function formatUpdaterError(error: unknown): string {
  const raw = errorMessage(error, t("errors.checkUpdateFailed"));
  const lower = raw.toLowerCase();

  if (
    lower.includes("could not fetch a valid release json") ||
    lower.includes("release not found")
  ) {
    return t("errors.updaterManifest");
  }
  if (
    lower.includes("error sending request") ||
    lower.includes("timed out") ||
    lower.includes("dns error") ||
    lower.includes("connection")
  ) {
    return t("errors.updaterNetwork", { raw });
  }
  if (lower.includes("platform") && lower.includes("not found")) {
    return t("errors.updaterPlatform", { raw });
  }
  if (lower.includes("permission") || lower.includes("not allowed")) {
    return t("errors.updaterPermission", { raw });
  }
  if (raw === t("errors.checkUpdateFailed")) {
    return raw;
  }
  return t("errors.updaterGeneric", { raw });
}
