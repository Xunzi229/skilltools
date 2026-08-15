use std::env;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

use serde::Serialize;

use crate::error::AppError;

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExternalEditor {
    pub id: String,
    pub name: String,
}

#[derive(Debug, Clone)]
struct DetectedEditor {
    editor: ExternalEditor,
    path: PathBuf,
}

pub fn list_external_editors() -> Vec<ExternalEditor> {
    let mut editors = vec![ExternalEditor {
        id: "default".into(),
        name: "默认应用".into(),
    }];

    for detected in detect_editors() {
        editors.push(detected.editor);
    }

    if notepad_available() {
        editors.push(ExternalEditor {
            id: "notepad".into(),
            name: "记事本".into(),
        });
    }

    editors.push(ExternalEditor {
        id: "reveal".into(),
        name: "在资源管理器中显示".into(),
    });

    editors
}

pub fn open_path_with(path: &Path, editor_id: &str) -> Result<(), AppError> {
    if !path.exists() {
        return Err(AppError::Io {
            message: format!("文件不存在：{}", path.display()),
        });
    }

    match editor_id {
        "default" => open_with_default(path),
        "notepad" => open_with_notepad(path),
        "reveal" => reveal_in_file_manager(path),
        id => {
            let app = detect_editors()
                .into_iter()
                .find(|item| item.editor.id == id)
                .map(|item| item.path)
                .ok_or_else(|| AppError::Io {
                    message: format!("未找到应用：{id}"),
                })?;
            open_with_app(app, path)
        }
    }
}

fn detect_editors() -> Vec<DetectedEditor> {
    let mut found = Vec::new();
    let mut push = |id: &str, name: &str, path: Option<PathBuf>| {
        let Some(path) = path.filter(|candidate| candidate.is_file()) else {
            return;
        };
        if found.iter().any(|item: &DetectedEditor| item.editor.id == id) {
            return;
        }
        found.push(DetectedEditor {
            editor: ExternalEditor {
                id: id.into(),
                name: name.into(),
            },
            path,
        });
    };

    push("cursor", "Cursor", find_cursor());
    push("vscode", "VS Code", find_vscode());
    push(
        "vscode-insiders",
        "VS Code Insiders",
        find_named_exe(&[
            "Programs/Microsoft VS Code Insiders/Code - Insiders.exe",
            "Microsoft VS Code Insiders/Code - Insiders.exe",
        ])
        .or_else(|| {
            first_existing_file(
                macos_app_binaries(&[("Visual Studio Code - Insiders", "Electron")])
                    .into_iter()
                    .chain(which_exe("code-insiders")),
            )
        }),
    );
    push(
        "idea",
        "IntelliJ IDEA",
        find_jetbrains(&["idea64.exe", "idea.exe"], "IntelliJ IDEA"),
    );
    push(
        "pycharm",
        "PyCharm",
        find_jetbrains(&["pycharm64.exe", "pycharm.exe"], "PyCharm"),
    );
    push(
        "goland",
        "GoLand",
        find_jetbrains(&["goland64.exe", "goland.exe"], "GoLand"),
    );
    push(
        "webstorm",
        "WebStorm",
        find_jetbrains(&["webstorm64.exe", "webstorm.exe"], "WebStorm"),
    );
    push(
        "clion",
        "CLion",
        find_jetbrains(&["clion64.exe", "clion.exe"], "CLion"),
    );
    push(
        "rider",
        "Rider",
        find_jetbrains(&["rider64.exe", "rider.exe"], "Rider"),
    );
    push(
        "notepadpp",
        "Notepad++",
        find_named_exe(&["Notepad++/notepad++.exe"]),
    );
    push(
        "notepad3",
        "Notepad3",
        find_named_exe(&["Notepad3/Notepad3.exe", "Notepad3/notepad3.exe"]),
    );
    push(
        "sublime",
        "Sublime Text",
        find_named_exe(&[
            "Sublime Text/sublime_text.exe",
            "Programs/Sublime Text/sublime_text.exe",
        ]),
    );

    found
}

fn find_cursor() -> Option<PathBuf> {
    first_existing_file(
        windows_rel_exes(&[
            "cursor/Cursor.exe",
            "Cursor/Cursor.exe",
            "Programs/cursor/Cursor.exe",
            "Programs/Cursor/Cursor.exe",
        ])
        .into_iter()
        .chain(macos_app_binaries(&[("Cursor", "Cursor")]))
        .chain(linux_abs_bins(&[
            "/usr/share/cursor/cursor",
            "/usr/bin/cursor",
            "/opt/Cursor/cursor",
            "/opt/cursor/cursor",
            "/snap/bin/cursor",
        ]))
        .chain(home_rel_bins(&[
            ".local/share/cursor/cursor",
            ".local/bin/cursor",
        ]))
        .chain(which_exe("cursor"))
        .chain(which_exe("Cursor")),
    )
}

fn find_vscode() -> Option<PathBuf> {
    first_existing_file(
        windows_rel_exes(&[
            "Microsoft VS Code/Code.exe",
            "Programs/Microsoft VS Code/Code.exe",
        ])
        .into_iter()
        .chain(resolve_cli_sibling("code", "Code.exe"))
        .chain(macos_app_binaries(&[("Visual Studio Code", "Electron")]))
        .chain(linux_abs_bins(&[
            "/usr/share/code/code",
            "/usr/bin/code",
            "/snap/bin/code",
            "/var/lib/flatpak/exports/bin/com.visualstudio.code",
        ]))
        .chain(home_rel_bins(&[".local/bin/code"]))
        .chain(which_exe("code"))
        .chain(which_exe("Code")),
    )
}

fn find_named_exe(relative_paths: &[&str]) -> Option<PathBuf> {
    first_existing_file(windows_rel_exes(relative_paths))
}

fn find_jetbrains(exe_names: &[&str], product_prefix: &str) -> Option<PathBuf> {
    let mut matches = Vec::new();
    for root in program_roots() {
        let jetbrains = root.join("JetBrains");
        let Ok(entries) = fs::read_dir(&jetbrains) else {
            continue;
        };
        for entry in entries.flatten() {
            let path = entry.path();
            if !path.is_dir() {
                continue;
            }
            let name = entry.file_name().to_string_lossy().into_owned();
            if !name
                .to_ascii_lowercase()
                .contains(&product_prefix.to_ascii_lowercase())
            {
                continue;
            }
            for exe_name in exe_names {
                let exe = path.join("bin").join(exe_name);
                if exe.is_file() {
                    matches.push((name.clone(), exe));
                    break;
                }
            }
        }
    }

    matches.sort_by(|left, right| right.0.cmp(&left.0));
    matches
        .into_iter()
        .next()
        .map(|(_, path)| path)
        .or_else(|| {
            first_existing_file(macos_app_binaries(&jetbrains_macos_apps(product_prefix)))
        })
}

fn jetbrains_macos_apps(product_prefix: &str) -> Vec<(&'static str, &'static str)> {
    match product_prefix {
        "IntelliJ IDEA" => vec![
            ("IntelliJ IDEA", "idea"),
            ("IntelliJ IDEA CE", "idea"),
        ],
        "PyCharm" => vec![("PyCharm", "pycharm"), ("PyCharm CE", "pycharm")],
        "GoLand" => vec![("GoLand", "goland")],
        "WebStorm" => vec![("WebStorm", "webstorm")],
        "CLion" => vec![("CLion", "clion")],
        "Rider" => vec![("Rider", "rider")],
        _ => vec![],
    }
}

fn open_with_app(app: PathBuf, path: &Path) -> Result<(), AppError> {
    #[cfg(target_os = "macos")]
    if let Some(bundle) = app_bundle_from_binary(&app) {
        return Command::new("open")
            .args(["-a"])
            .arg(bundle)
            .arg(path)
            .spawn()
            .map(|_| ())
            .map_err(|error| AppError::Io {
                message: format!("打开失败：{error}"),
            });
    }
    let mut command = spawn_command_for(&app);
    command
        .arg(path)
        .spawn()
        .map(|_| ())
        .map_err(|error| AppError::Io {
            message: format!("打开失败：{error}"),
        })
}

#[cfg(target_os = "macos")]
fn app_bundle_from_binary(binary: &Path) -> Option<PathBuf> {
    let macos_dir = binary.parent()?;
    if macos_dir.file_name()?.to_str()? != "MacOS" {
        return None;
    }
    let contents = macos_dir.parent()?;
    if contents.file_name()?.to_str()? != "Contents" {
        return None;
    }
    let bundle = contents.parent()?;
    if bundle.extension()?.to_str()? != "app" {
        return None;
    }
    Some(bundle.to_path_buf())
}

fn spawn_command_for(app: &Path) -> Command {
    #[cfg(windows)]
    {
        let is_script = app
            .extension()
            .and_then(|ext| ext.to_str())
            .is_some_and(|ext| {
                matches!(ext.to_ascii_lowercase().as_str(), "cmd" | "bat" | "ps1")
            });
        if is_script {
            let mut command = Command::new("cmd");
            command.arg("/C").arg(app);
            return command;
        }
    }
    Command::new(app)
}

#[cfg(windows)]
fn open_with_default(path: &Path) -> Result<(), AppError> {
    windows_shell_execute(path, "open")
}

#[cfg(windows)]
fn windows_shell_execute(path: &Path, operation: &str) -> Result<(), AppError> {
    use std::os::windows::ffi::OsStrExt;

    #[link(name = "shell32")]
    extern "system" {
        fn ShellExecuteW(
            hwnd: *mut core::ffi::c_void,
            lp_operation: *const u16,
            lp_file: *const u16,
            lp_parameters: *const u16,
            lp_directory: *const u16,
            n_show_cmd: i32,
        ) -> isize;
    }

    const SW_SHOWNORMAL: i32 = 1;

    let op: Vec<u16> = std::ffi::OsStr::new(operation)
        .encode_wide()
        .chain(std::iter::once(0))
        .collect();
    let file: Vec<u16> = path
        .as_os_str()
        .encode_wide()
        .chain(std::iter::once(0))
        .collect();
    let result = unsafe {
        ShellExecuteW(
            std::ptr::null_mut(),
            op.as_ptr(),
            file.as_ptr(),
            std::ptr::null(),
            std::ptr::null(),
            SW_SHOWNORMAL,
        )
    };
    // 返回值 > 32 表示成功
    if result > 32 {
        Ok(())
    } else {
        Err(AppError::Io {
            message: format!("打开失败（ShellExecuteW={result}）：{}", path.display()),
        })
    }
}

#[cfg(target_os = "macos")]
fn open_with_default(path: &Path) -> Result<(), AppError> {
    Command::new("open")
        .arg(path)
        .spawn()
        .map(|_| ())
        .map_err(|error| AppError::Io {
            message: format!("打开失败：{error}"),
        })
}

#[cfg(all(unix, not(target_os = "macos")))]
fn open_with_default(path: &Path) -> Result<(), AppError> {
    Command::new("xdg-open")
        .arg(path)
        .spawn()
        .map(|_| ())
        .map_err(|error| AppError::Io {
            message: format!("打开失败：{error}"),
        })
}

#[cfg(windows)]
fn open_with_notepad(path: &Path) -> Result<(), AppError> {
    Command::new("notepad")
        .arg(path)
        .spawn()
        .map(|_| ())
        .map_err(|error| AppError::Io {
            message: format!("打开失败：{error}"),
        })
}

#[cfg(not(windows))]
fn open_with_notepad(_path: &Path) -> Result<(), AppError> {
    Err(AppError::Io {
        message: "当前系统不支持记事本".into(),
    })
}

pub fn reveal_path(path: &Path) -> Result<(), AppError> {
    reveal_in_file_manager(path)
}

#[cfg(windows)]
fn reveal_in_file_manager(path: &Path) -> Result<(), AppError> {
    use std::os::windows::process::CommandExt;

    // explorer `/select,"C:\path with spaces\file"` 必须作为单个 raw 参数，避免空格拆参。
    let absolute = path
        .canonicalize()
        .unwrap_or_else(|_| path.to_path_buf());
    let display = crate::path_norm::strip_windows_verbatim(&absolute.to_string_lossy());
    let select_arg = format!("/select,\"{display}\"");
    Command::new("explorer")
        .raw_arg(select_arg)
        .spawn()
        .map(|_| ())
        .map_err(|error| AppError::Io {
            message: format!("打开资源管理器失败：{error}"),
        })
}

#[cfg(target_os = "macos")]
fn reveal_in_file_manager(path: &Path) -> Result<(), AppError> {
    Command::new("open")
        .args(["-R"])
        .arg(path)
        .spawn()
        .map(|_| ())
        .map_err(|error| AppError::Io {
            message: format!("在访达中显示失败：{error}"),
        })
}

#[cfg(all(unix, not(target_os = "macos")))]
fn reveal_in_file_manager(path: &Path) -> Result<(), AppError> {
    let dir = path.parent().unwrap_or(path);
    Command::new("xdg-open")
        .arg(dir)
        .spawn()
        .map(|_| ())
        .map_err(|error| AppError::Io {
            message: format!("打开文件管理器失败：{error}"),
        })
}

#[cfg(windows)]
fn notepad_available() -> bool {
    true
}

#[cfg(not(windows))]
fn notepad_available() -> bool {
    false
}

fn windows_rel_exes(relative_paths: &[&str]) -> Vec<PathBuf> {
    #[cfg(windows)]
    {
        program_roots()
            .into_iter()
            .flat_map(|root| relative_paths.iter().map(move |rel| root.join(rel)))
            .collect()
    }
    #[cfg(not(windows))]
    {
        let _ = relative_paths;
        Vec::new()
    }
}

fn macos_app_binaries(apps: &[(&str, &str)]) -> Vec<PathBuf> {
    #[cfg(target_os = "macos")]
    {
        let mut roots = vec![PathBuf::from("/Applications")];
        if let Some(home) = env::var_os("HOME") {
            roots.push(PathBuf::from(home).join("Applications"));
        }
        let mut out = Vec::new();
        for root in roots {
            for (app, binary) in apps {
                out.push(root.join(format!("{app}.app/Contents/MacOS/{binary}")));
            }
        }
        out
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = apps;
        Vec::new()
    }
}

fn linux_abs_bins(paths: &[&str]) -> Vec<PathBuf> {
    #[cfg(all(unix, not(target_os = "macos")))]
    {
        paths.iter().map(PathBuf::from).collect()
    }
    #[cfg(not(all(unix, not(target_os = "macos"))))]
    {
        let _ = paths;
        Vec::new()
    }
}

fn home_rel_bins(relative_paths: &[&str]) -> Vec<PathBuf> {
    let Some(home) = env::var_os("HOME").or_else(|| env::var_os("USERPROFILE")) else {
        return Vec::new();
    };
    let home = PathBuf::from(home);
    relative_paths.iter().map(|rel| home.join(rel)).collect()
}

fn program_roots() -> Vec<PathBuf> {
    let mut roots = Vec::new();
    let mut push_root = |path: PathBuf| {
        if path.is_dir() && !roots.iter().any(|existing| existing == &path) {
            roots.push(path);
        }
    };

    if let Some(local) = env::var_os("LOCALAPPDATA") {
        let local = PathBuf::from(local);
        push_root(local.join("Programs"));
        push_root(local);
    }
    if let Some(pf) = env::var_os("ProgramFiles") {
        push_root(PathBuf::from(pf));
    }
    if let Some(pf86) = env::var_os("ProgramFiles(x86)") {
        push_root(PathBuf::from(pf86));
    }

    if let Some(w6432) = env::var_os("ProgramW6432") {
        push_root(PathBuf::from(w6432));
    }

    // Also scan common alternate install drives (e.g. D:\Program Files).
    for drive in ["C", "D", "E", "F"] {
        push_root(PathBuf::from(format!(r"{drive}:\Program Files")));
        push_root(PathBuf::from(format!(r"{drive}:\Program Files (x86)")));
    }

    roots
}

fn first_existing_file<I>(candidates: I) -> Option<PathBuf>
where
    I: IntoIterator<Item = PathBuf>,
{
    candidates.into_iter().find(|path| path.is_file())
}

fn which_exe(name: &str) -> Option<PathBuf> {
    let path_var = env::var_os("PATH")?;
    for dir in env::split_paths(&path_var) {
        #[cfg(windows)]
        {
            let with_exe = dir.join(format!("{name}.exe"));
            if with_exe.is_file() {
                return Some(with_exe);
            }
        }
        #[cfg(not(windows))]
        {
            let candidate = dir.join(name);
            if candidate.is_file() {
                return Some(candidate);
            }
        }
    }
    None
}

/// Resolve `.../bin/code.cmd` -> `.../Code.exe`.
fn resolve_cli_sibling(cli_name: &str, exe_name: &str) -> Option<PathBuf> {
    let path_var = env::var_os("PATH")?;
    for dir in env::split_paths(&path_var) {
        #[cfg(windows)]
        {
            for shim in [
                dir.join(format!("{cli_name}.cmd")),
                dir.join(format!("{cli_name}.bat")),
                dir.join(cli_name),
            ] {
                if !shim.is_file() {
                    continue;
                }
                if let Some(parent) = shim.parent().and_then(Path::parent) {
                    let exe = parent.join(exe_name);
                    if exe.is_file() {
                        return Some(exe);
                    }
                }
            }
        }
        #[cfg(not(windows))]
        {
            let _ = (cli_name, exe_name, dir);
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::list_external_editors;
    #[cfg(windows)]
    use super::detect_editors;

    #[test]
    fn always_includes_default_and_reveal() {
        let editors = list_external_editors();
        assert!(editors.iter().any(|item| item.id == "default"));
        assert!(editors.iter().any(|item| item.id == "reveal"));
    }

    #[cfg(windows)]
    #[test]
    fn detected_editors_use_exe_files() {
        for item in detect_editors() {
            assert_eq!(
                item.path
                    .extension()
                    .and_then(|ext| ext.to_str())
                    .map(str::to_ascii_lowercase)
                    .as_deref(),
                Some("exe"),
                "expected exe for {}, got {}",
                item.editor.id,
                item.path.display()
            );
        }
    }

    #[test]
    fn linux_and_macos_candidate_lists_are_platform_gated() {
        let linux = super::linux_abs_bins(&["/usr/bin/code"]);
        let mac = super::macos_app_binaries(&[("Cursor", "Cursor")]);
        #[cfg(all(unix, not(target_os = "macos")))]
        {
            assert_eq!(linux.len(), 1);
            assert!(mac.is_empty());
        }
        #[cfg(target_os = "macos")]
        {
            assert!(linux.is_empty());
            assert!(!mac.is_empty());
        }
        #[cfg(windows)]
        {
            assert!(linux.is_empty());
            assert!(mac.is_empty());
        }
    }
}
