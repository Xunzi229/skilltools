import { open, save } from "@tauri-apps/plugin-dialog";

export async function pickDirectory(
  title = "选择目录",
): Promise<string | null> {
  const selected = await open({
    directory: true,
    multiple: false,
    title,
  });
  return typeof selected === "string" ? selected : null;
}

export async function pickZipFile(title = "选择 ZIP 文件"): Promise<string | null> {
  const selected = await open({
    multiple: false,
    title,
    filters: [{ name: "ZIP", extensions: ["zip"] }],
  });
  return typeof selected === "string" ? selected : null;
}

export async function pickSaveZip(
  defaultPath: string,
  title = "导出 ZIP",
): Promise<string | null> {
  const selected = await save({
    title,
    defaultPath,
    filters: [{ name: "ZIP", extensions: ["zip"] }],
  });
  return selected ?? null;
}
