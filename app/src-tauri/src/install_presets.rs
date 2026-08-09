use std::path::Path;

use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::error::AppError;
use crate::json_store::{read_json_value, write_json_value};
use crate::model::{InstallPreset, Provider};

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
struct PresetStore {
    presets: Vec<InstallPreset>,
}

fn store_path(app_data_dir: &Path) -> std::path::PathBuf {
    app_data_dir.join("install-presets.json")
}

pub fn list_presets(app_data_dir: &Path) -> Result<Vec<InstallPreset>, AppError> {
    let store = read_json_value(&store_path(app_data_dir), PresetStore::default, |message| {
        AppError::Settings { message }
    })?;
    let mut presets = store.presets;
    presets.sort_by(|left, right| left.name.cmp(&right.name));
    Ok(presets)
}

pub fn save_preset(
    app_data_dir: &Path,
    id: Option<String>,
    name: String,
    skill_ids: Vec<String>,
    providers: Vec<Provider>,
) -> Result<InstallPreset, AppError> {
    let name = name.trim().to_string();
    if name.is_empty() {
        return Err(AppError::Settings {
            message: "预设名称不能为空".into(),
        });
    }
    if skill_ids.is_empty() {
        return Err(AppError::Settings {
            message: "预设至少包含一个 Skill".into(),
        });
    }
    if providers.is_empty() {
        return Err(AppError::Settings {
            message: "预设至少选择一个 Provider".into(),
        });
    }
    let path = store_path(app_data_dir);
    let mut store = read_json_value(&path, PresetStore::default, |message| AppError::Settings {
        message,
    })?;
    let preset = InstallPreset {
        id: id.unwrap_or_else(|| Uuid::new_v4().to_string()),
        name,
        skill_ids,
        providers,
    };
    if let Some(existing) = store
        .presets
        .iter_mut()
        .find(|item| item.id == preset.id)
    {
        *existing = preset.clone();
    } else {
        store.presets.push(preset.clone());
    }
    write_json_value(&path, &store, |message| AppError::Settings { message })?;
    Ok(preset)
}

pub fn delete_preset(app_data_dir: &Path, id: &str) -> Result<(), AppError> {
    let path = store_path(app_data_dir);
    let mut store = read_json_value(&path, PresetStore::default, |message| AppError::Settings {
        message,
    })?;
    let before = store.presets.len();
    store.presets.retain(|preset| preset.id != id);
    if store.presets.len() == before {
        return Err(AppError::Settings {
            message: format!("预设不存在：{id}"),
        });
    }
    write_json_value(&path, &store, |message| AppError::Settings { message })?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn save_list_delete_presets() {
        let dir = tempdir().unwrap();
        let saved = save_preset(
            dir.path(),
            None,
            "日常".into(),
            vec!["a".into()],
            vec![Provider::Cursor],
        )
        .unwrap();
        assert_eq!(list_presets(dir.path()).unwrap().len(), 1);
        delete_preset(dir.path(), &saved.id).unwrap();
        assert!(list_presets(dir.path()).unwrap().is_empty());
    }
}
