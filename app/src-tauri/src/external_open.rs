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
        ]),
    );
    push("idea", "IntelliJ IDEA", find_jetbrains("idea64.exe", "IntelliJ IDEA"));
    push("pycharm", "PyCharm", find_jetbrains("pycharm64.exe", "PyCharm"));
    push("goland", "GoLand", find_jetbrains("goland64.exe", "GoLand"));
    push(
        "webstorm",
        "WebStorm",
        find_jetbrains("webstorm64.exe", "WebStorm"),
    );
    push("clion", "CLion", find_jetbrains("clion64.exe", "CLion"));
    push("rider", "Rider", find_jetbrains("rider64.exe", "Rider"));
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
        program_roots()
            .into_iter()
            .flat_map(|root| {
                [
                    root.join("cursor/Cursor.exe"),
                    root.join("Cursor/Cursor.exe"),
                    root.join("Programs/cursor/Cursor.exe"),
                    root.join("Programs/Cursor/Cursor.exe"),
                ]
            })
            .chain(which_exe("Cursor"))
            .chain(which_exe("cursor")),
    )
}

fn find_vscode() -> Option<PathBuf> {
    first_existing_file(
        program_roots()
            .into_iter()
            .flat_map(|root| {
                [
                    root.join("Microsoft VS Code/Code.exe"),
                    root.join("Programs/Microsoft VS Code/Code.exe"),
                ]
            })
            .chain(resolve_cli_sibling("code", "Code.exe"))
            .chain(which_exe("Code")),
    )
}

fn find_named_exe(relative_paths: &[&str]) -> Option<PathBuf> {
    first_existing_file(
        program_roots()
            .into_iter()
            .flat_map(|root| relative_paths.iter().map(move |rel| root.join(rel))),
    )
}

fn find_jetbrains(exe_name: &str, product_prefix: &str) -> Option<PathBuf> {
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
            if !name.to_ascii_lowercase().contains(&product_prefix.to_ascii_lowercase()) {
                continue;
            }
            let exe = path.join("bin").join(exe_name);
            if exe.is_file() {
                matches.push((name, exe));
            }
        }
    }

    // Prefer the lexicographically latest install directory (usually newest version).
    matches.sort_by(|left, right| right.0.cmp(&left.0));
    matches.into_iter().next().map(|(_, path)| path)
}

fn open_with_app(app: PathBuf, path: &Path) -> Result<(), AppError> {
    let mut command = spawn_command_for(&app);
    command
        .arg(path)
        .spawn()
        .map(|_| ())
        .map_err(|error| AppError::Io {
            message: format!("打开失败：{error}"),
        })
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
    Command::new("cmd")
        .args(["/C", "start", "", &path.display().to_string()])
        .spawn()
        .map(|_| ())
        .map_err(|error| AppError::Io {
            message: format!("打开失败：{error}"),
        })
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
    Command::new("explorer")
        .arg(format!("/select,{}", path.display()))
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
    use super::{detect_editors, list_external_editors};

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
}
