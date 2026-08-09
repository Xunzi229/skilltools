use std::fs::{self, File};
use std::io::{Read, Write};
use std::path::{Component, Path, PathBuf};

use walkdir::WalkDir;
use zip::write::SimpleFileOptions;
use zip::{CompressionMethod, ZipArchive, ZipWriter};

use crate::error::AppError;

pub fn export_directory_to_zip(source_dir: &Path, dest_zip: &Path) -> Result<(), AppError> {
    if !source_dir.is_dir() {
        return Err(AppError::Zip {
            message: format!("导出源不是目录：{}", source_dir.display()),
        });
    }
    if let Some(parent) = dest_zip.parent() {
        fs::create_dir_all(parent)?;
    }
    let file = File::create(dest_zip).map_err(|error| AppError::Zip {
        message: format!("无法创建 ZIP：{error}"),
    })?;
    let mut writer = ZipWriter::new(file);
    let options = SimpleFileOptions::default().compression_method(CompressionMethod::Deflated);
    let root_name = source_dir
        .file_name()
        .map(|name| name.to_string_lossy().into_owned())
        .unwrap_or_else(|| "skill".to_string());

    for entry in WalkDir::new(source_dir).follow_links(false) {
        let entry = entry.map_err(|error| AppError::Zip {
            message: format!("遍历目录失败：{error}"),
        })?;
        let path = entry.path();
        let metadata = entry.metadata().map_err(|error| AppError::Zip {
            message: format!("读取元数据失败：{error}"),
        })?;
        if metadata.file_type().is_symlink() {
            continue;
        }
        let relative = path.strip_prefix(source_dir).map_err(|_| AppError::Zip {
            message: "路径逃逸导出根目录".into(),
        })?;
        if relative.as_os_str().is_empty() {
            continue;
        }
        let mut zip_path = PathBuf::from(&root_name);
        zip_path.push(relative);
        let name = zip_path
            .to_string_lossy()
            .replace('\\', "/")
            .trim_start_matches('/')
            .to_string();
        if metadata.is_dir() {
            writer
                .add_directory(format!("{name}/"), options)
                .map_err(|error| AppError::Zip {
                    message: format!("写入目录失败：{error}"),
                })?;
        } else if metadata.is_file() {
            writer
                .start_file(&name, options)
                .map_err(|error| AppError::Zip {
                    message: format!("写入文件失败：{error}"),
                })?;
            let mut input = File::open(path).map_err(|error| AppError::Zip {
                message: format!("读取文件失败：{error}"),
            })?;
            let mut buffer = Vec::new();
            input
                .read_to_end(&mut buffer)
                .map_err(|error| AppError::Zip {
                    message: format!("读取文件失败：{error}"),
                })?;
            writer.write_all(&buffer).map_err(|error| AppError::Zip {
                message: format!("写入 ZIP 失败：{error}"),
            })?;
        }
    }
    writer.finish().map_err(|error| AppError::Zip {
        message: format!("完成 ZIP 失败：{error}"),
    })?;
    Ok(())
}

pub fn import_zip_to_directory(zip_path: &Path, dest_dir: &Path) -> Result<(), AppError> {
    if dest_dir.exists() {
        return Err(AppError::TargetConflict {
            path: dest_dir.display().to_string(),
        });
    }
    fs::create_dir_all(dest_dir)?;
    let file = File::open(zip_path).map_err(|error| AppError::Zip {
        message: format!("无法打开 ZIP：{error}"),
    })?;
    let mut archive = ZipArchive::new(file).map_err(|error| AppError::Zip {
        message: format!("无效 ZIP：{error}"),
    })?;

    for index in 0..archive.len() {
        let mut entry = archive.by_index(index).map_err(|error| AppError::Zip {
            message: format!("读取 ZIP 条目失败：{error}"),
        })?;
        let Some(enclosed) = entry.enclosed_name() else {
            continue;
        };
        if enclosed.components().any(|component| {
            matches!(
                component,
                Component::ParentDir | Component::RootDir | Component::Prefix(_)
            )
        }) {
            let _ = fs::remove_dir_all(dest_dir);
            return Err(AppError::Zip {
                message: "ZIP 包含非法路径".into(),
            });
        }
        let out_path = dest_dir.join(enclosed);
        if entry.is_dir() || entry.name().ends_with('/') {
            fs::create_dir_all(&out_path)?;
            continue;
        }
        if let Some(parent) = out_path.parent() {
            fs::create_dir_all(parent)?;
        }
        let mut outfile = File::create(&out_path).map_err(|error| AppError::Zip {
            message: format!("解压写入失败：{error}"),
        })?;
        std::io::copy(&mut entry, &mut outfile).map_err(|error| AppError::Zip {
            message: format!("解压写入失败：{error}"),
        })?;
    }

    if !directory_contains_skill_md(dest_dir) {
        let _ = fs::remove_dir_all(dest_dir);
        return Err(AppError::Zip {
            message: "ZIP 中未找到 SKILL.md".into(),
        });
    }
    Ok(())
}

pub fn directory_contains_skill_md(dir: &Path) -> bool {
    WalkDir::new(dir)
        .follow_links(false)
        .into_iter()
        .filter_map(Result::ok)
        .any(|entry| {
            entry.file_type().is_file() && entry.file_name().eq_ignore_ascii_case("SKILL.md")
        })
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn export_import_round_trip() {
        let base = tempdir().unwrap();
        let skill = base.path().join("demo-skill");
        fs::create_dir_all(skill.join("refs")).unwrap();
        fs::write(skill.join("SKILL.md"), "# Demo").unwrap();
        fs::write(skill.join("refs/a.txt"), "a").unwrap();
        let zip_path = base.path().join("demo.zip");
        export_directory_to_zip(&skill, &zip_path).unwrap();

        let imported = base.path().join("imported");
        import_zip_to_directory(&zip_path, &imported).unwrap();
        assert!(directory_contains_skill_md(&imported));
    }
}
