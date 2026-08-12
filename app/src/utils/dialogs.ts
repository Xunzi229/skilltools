import { open, save } from "@tauri-apps/plugin-dialog";
import { t } from "../i18n";

export async function pickDirectory(
  title?: string,
): Promise<string | null> {
  const selected = await open({
    directory: true,
    multiple: false,
    title: title ?? t("dialogs.pickDirectory"),
  });
  return typeof selected === "string" ? selected : null;
}

export async function pickZipFile(title?: string): Promise<string | null> {
  const selected = await open({
    multiple: false,
    title: title ?? t("dialogs.pickZip"),
    filters: [{ name: "ZIP", extensions: ["zip"] }],
  });
  return typeof selected === "string" ? selected : null;
}

export async function pickSaveZip(
  defaultPath: string,
  title?: string,
): Promise<string | null> {
  const selected = await save({
    title: title ?? t("dialogs.exportZip"),
    defaultPath,
    filters: [{ name: "ZIP", extensions: ["zip"] }],
  });
  return selected ?? null;
}
