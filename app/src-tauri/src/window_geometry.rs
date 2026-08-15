use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use tauri::{LogicalSize, Manager, Size};

const DEFAULT_WIDTH: u32 = 1200;
const DEFAULT_HEIGHT: u32 = 800;
const MIN_WIDTH: u32 = 960;
const MIN_HEIGHT: u32 = 640;

static LAST: Mutex<Option<WindowGeometry>> = Mutex::new(None);

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WindowGeometry {
    pub width: u32,
    pub height: u32,
    #[serde(default)]
    pub maximized: bool,
}

impl Default for WindowGeometry {
    fn default() -> Self {
        Self {
            width: DEFAULT_WIDTH,
            height: DEFAULT_HEIGHT,
            maximized: false,
        }
    }
}

fn state_path(app_data_dir: &Path) -> PathBuf {
    app_data_dir.join("window-state.json")
}

pub(crate) fn merge_geometry(
    previous: WindowGeometry,
    width: u32,
    height: u32,
    maximized: bool,
    minimized: bool,
) -> WindowGeometry {
    if minimized {
        return previous;
    }
    if maximized {
        return WindowGeometry {
            width: previous.width,
            height: previous.height,
            maximized: true,
        };
    }
    if width == 0 || height == 0 {
        return previous;
    }
    WindowGeometry {
        width,
        height,
        maximized: false,
    }
}

fn load_from_disk(app_data_dir: &Path) -> WindowGeometry {
    let bytes = match fs::read(state_path(app_data_dir)) {
        Ok(bytes) => bytes,
        Err(_) => return WindowGeometry::default(),
    };
    serde_json::from_slice(&bytes).unwrap_or_default()
}

fn save_to_disk(app_data_dir: &Path, state: &WindowGeometry) {
    if let Some(parent) = state_path(app_data_dir).parent() {
        let _ = fs::create_dir_all(parent);
    }
    if let Ok(bytes) = serde_json::to_vec_pretty(state) {
        let _ = fs::write(state_path(app_data_dir), bytes);
    }
}

fn remember(state: WindowGeometry) {
    if let Ok(mut last) = LAST.lock() {
        *last = Some(state);
    }
}

fn previous_or_default() -> WindowGeometry {
    LAST.lock()
        .ok()
        .and_then(|guard| guard.clone())
        .unwrap_or_default()
}

pub(crate) fn clamp_logical_size(
    width: u32,
    height: u32,
    work_width: u32,
    work_height: u32,
) -> (u32, u32) {
    let max_w = work_width.max(1);
    let max_h = work_height.max(1);
    let min_w = MIN_WIDTH.min(max_w);
    let min_h = MIN_HEIGHT.min(max_h);
    (width.clamp(min_w, max_w), height.clamp(min_h, max_h))
}

fn size_for_restore(window: &tauri::WebviewWindow, state: &WindowGeometry) -> (u32, u32) {
    match window.current_monitor() {
        Ok(Some(monitor)) => {
            let scale = monitor.scale_factor().max(0.1);
            let area = monitor.work_area();
            let work_w = (f64::from(area.size.width) / scale).round() as u32;
            let work_h = (f64::from(area.size.height) / scale).round() as u32;
            clamp_logical_size(state.width, state.height, work_w, work_h)
        }
        _ => (state.width.max(1), state.height.max(1)),
    }
}

pub fn restore(window: &tauri::WebviewWindow) {
    let Ok(dir) = window.app_handle().path().app_data_dir() else {
        return;
    };
    let state = load_from_disk(&dir);
    remember(state.clone());
    let (width, height) = size_for_restore(window, &state);
    let _ = window.set_size(Size::Logical(LogicalSize::new(
        f64::from(width),
        f64::from(height),
    )));
    if state.maximized {
        let _ = window.maximize();
    }
}

pub fn persist(window: &tauri::Window) {
    let maximized = window.is_maximized().unwrap_or(false);
    let minimized = window.is_minimized().unwrap_or(false);
    let (width, height) = match (window.inner_size(), window.scale_factor()) {
        (Ok(physical), Ok(scale)) => {
            let logical = physical.to_logical::<f64>(scale);
            (logical.width.round() as u32, logical.height.round() as u32)
        }
        _ => return,
    };

    let next = merge_geometry(previous_or_default(), width, height, maximized, minimized);
    if previous_or_default() == next {
        return;
    }
    remember(next.clone());
    if let Ok(dir) = window.app_handle().path().app_data_dir() {
        save_to_disk(&dir, &next);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn resize_saves_normal_size() {
        let previous = WindowGeometry::default();
        let next = merge_geometry(previous, 1440, 900, false, false);
        assert_eq!(
            next,
            WindowGeometry {
                width: 1440,
                height: 900,
                maximized: false,
            }
        );
    }

    #[test]
    fn maximized_keeps_last_restored_size() {
        let previous = WindowGeometry {
            width: 1280,
            height: 720,
            maximized: false,
        };
        let next = merge_geometry(previous, 1920, 1080, true, false);
        assert_eq!(
            next,
            WindowGeometry {
                width: 1280,
                height: 720,
                maximized: true,
            }
        );
    }

    #[test]
    fn minimized_does_not_change_geometry() {
        let previous = WindowGeometry {
            width: 1100,
            height: 700,
            maximized: false,
        };
        let next = merge_geometry(previous.clone(), 0, 0, false, true);
        assert_eq!(next, previous);
    }

    #[test]
    fn clamp_fits_smaller_monitor_and_respects_minimum() {
        assert_eq!(clamp_logical_size(2560, 1440, 1280, 800), (1280, 800));
        assert_eq!(clamp_logical_size(800, 500, 1920, 1080), (960, 640));
        assert_eq!(clamp_logical_size(1200, 800, 800, 600), (800, 600));
    }

    #[test]
    fn round_trips_window_state_file() {
        let dir = tempdir().unwrap();
        let state = WindowGeometry {
            width: 1600,
            height: 900,
            maximized: true,
        };
        save_to_disk(dir.path(), &state);
        assert_eq!(load_from_disk(dir.path()), state);
    }
}
