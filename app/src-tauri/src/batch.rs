use crate::error::AppError;
use crate::library_repository::LibraryRepository;
use crate::model::{
    BatchItemResult, BatchItemStatus, BatchResult, Provider, SkillDetail, SkillStatus,
};
use crate::skill_repository::SkillRepository;

pub fn map_item<T, E: ToString>(id: String, result: Result<T, E>) -> BatchItemResult {
    match result {
        Ok(_) => BatchItemResult {
            id,
            status: BatchItemStatus::Success,
            message: None,
        },
        Err(error) => BatchItemResult {
            id,
            status: BatchItemStatus::Failed,
            message: Some(error.to_string()),
        },
    }
}

pub fn skipped(id: String, message: impl Into<String>) -> BatchItemResult {
    BatchItemResult {
        id,
        status: BatchItemStatus::Skipped,
        message: Some(message.into()),
    }
}

pub fn collect(items: Vec<BatchItemResult>) -> BatchResult {
    BatchResult::from_items(items)
}

pub(crate) fn require_active_for_migration(detail: SkillDetail) -> Result<SkillDetail, AppError> {
    if detail.status != SkillStatus::Active {
        return Err(AppError::Io {
            message: "请先恢复再迁移已暂停的 Skill".into(),
        });
    }
    Ok(detail)
}

pub fn run_ids<E, F>(skill_ids: Vec<String>, mut action: F) -> BatchResult
where
    E: ToString,
    F: FnMut(&str) -> Result<(), E>,
{
    let items = skill_ids
        .into_iter()
        .map(|id| {
            let result = action(&id);
            map_item(id, result)
        })
        .collect();
    collect(items)
}

pub fn batch_install_skills(
    library: &LibraryRepository,
    skill_ids: Vec<String>,
    provider: Provider,
) -> BatchResult {
    let items = skill_ids
        .into_iter()
        .map(|id| match library.has_installation(&id, provider) {
            Ok(true) => skipped(id, "已安装，已跳过"),
            Ok(false) => {
                let result = library.install_skill(&id, provider);
                map_item(id, result)
            }
            Err(error) => map_item::<(), _>(id, Err(error)),
        })
        .collect();
    collect(items)
}

pub fn batch_uninstall_skills(
    library: &LibraryRepository,
    skill_ids: Vec<String>,
    provider: Provider,
) -> BatchResult {
    let items = skill_ids
        .into_iter()
        .map(|id| match library.has_installation(&id, provider) {
            Ok(false) => skipped(id, "未安装，已跳过"),
            Ok(true) => {
                let result = library.uninstall_skill(&id, provider);
                map_item(id, result)
            }
            Err(error) => map_item::<(), _>(id, Err(error)),
        })
        .collect();
    collect(items)
}

pub fn batch_set_skill_group(
    library: &LibraryRepository,
    skill_ids: Vec<String>,
    group_id: Option<String>,
) -> BatchResult {
    let items = skill_ids
        .into_iter()
        .map(|id| map_item(id.clone(), library.set_skill_group(&id, group_id.clone())))
        .collect();
    collect(items)
}

pub fn batch_add_skill_tags(
    library: &LibraryRepository,
    skill_ids: Vec<String>,
    tag_id: String,
) -> BatchResult {
    let index_skills = match library.list_library_skills() {
        Ok(skills) => skills,
        Err(error) => {
            return collect(
                skill_ids
                    .into_iter()
                    .map(|id| map_item::<(), _>(id, Err(error.to_string())))
                    .collect(),
            );
        }
    };
    let items = skill_ids
        .into_iter()
        .map(|id| {
            let current = index_skills
                .iter()
                .find(|skill| skill.id == id)
                .map(|skill| skill.tag_ids.clone())
                .unwrap_or_default();
            let mut next = current;
            if !next.contains(&tag_id) {
                next.push(tag_id.clone());
            }
            map_item(id.clone(), library.set_skill_tags(&id, next))
        })
        .collect();
    collect(items)
}

pub fn batch_remove_skill_tags(
    library: &LibraryRepository,
    skill_ids: Vec<String>,
    tag_id: String,
) -> BatchResult {
    let index_skills = match library.list_library_skills() {
        Ok(skills) => skills,
        Err(error) => {
            return collect(
                skill_ids
                    .into_iter()
                    .map(|id| map_item::<(), _>(id, Err(error.to_string())))
                    .collect(),
            );
        }
    };
    let items = skill_ids
        .into_iter()
        .map(|id| {
            let current = index_skills
                .iter()
                .find(|skill| skill.id == id)
                .map(|skill| skill.tag_ids.clone())
                .unwrap_or_default();
            if !current.iter().any(|t| t == &tag_id) {
                return skipped(id, "未包含该标签，已跳过");
            }
            let next: Vec<String> = current.into_iter().filter(|t| t != &tag_id).collect();
            map_item(id.clone(), library.set_skill_tags(&id, next))
        })
        .collect();
    collect(items)
}

pub fn batch_set_skill_tags(
    library: &LibraryRepository,
    skill_ids: Vec<String>,
    tag_ids: Vec<String>,
) -> BatchResult {
    let items = skill_ids
        .into_iter()
        .map(|id| map_item(id.clone(), library.set_skill_tags(&id, tag_ids.clone())))
        .collect();
    collect(items)
}

pub fn batch_migrate_provider_skills(
    skills: &SkillRepository,
    library: &LibraryRepository,
    skill_ids: Vec<String>,
    replace_with_link: bool,
) -> BatchResult {
    let items = skill_ids
        .into_iter()
        .map(|id| {
            let result = skills
                .detail(&id)
                .and_then(require_active_for_migration)
                .and_then(|detail| {
                    library.migrate_provider_skill(
                        &detail.name,
                        detail.provider,
                        &detail.current_path,
                        replace_with_link,
                    )
                });
            map_item(id, result)
        })
        .collect();
    collect(items)
}

pub fn apply_install_preset(
    library: &LibraryRepository,
    skill_ids: Vec<String>,
    providers: Vec<Provider>,
) -> BatchResult {
    let mut items = Vec::new();
    for provider in providers {
        let result = batch_install_skills(library, skill_ids.clone(), provider);
        for mut item in result.items {
            let provider_label = match provider {
                Provider::Cursor => "cursor",
                Provider::Claude => "claude",
                Provider::Codex => "codex",
            };
            item.id = format!("{}:{provider_label}", item.id);
            items.push(item);
        }
    }
    collect(items)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::library_repository::LibraryRepository;
    use crate::model::BatchItemStatus;
    use crate::paths::AppPaths;
    use tempfile::tempdir;

    #[test]
    fn batch_remove_and_set_tags_on_missing_skill() {
        let dir = tempdir().unwrap();
        let library = LibraryRepository::new(AppPaths::for_test(dir.path()));
        let tag = library.create_tag("cursor".into(), None).unwrap();
        // 索引中无该 skill：remove 视为未包含标签 → skipped
        let removed = batch_remove_skill_tags(&library, vec!["missing".into()], tag.id.clone());
        assert_eq!(removed.total, 1);
        assert_eq!(removed.skipped, 1);
        assert_eq!(removed.items[0].status, BatchItemStatus::Skipped);

        // set 会因 skill 不存在而 failed
        let set = batch_set_skill_tags(&library, vec!["missing".into()], vec![]);
        assert_eq!(set.total, 1);
        assert_eq!(set.items[0].status, BatchItemStatus::Failed);
    }

    #[test]
    fn batch_migration_rejects_paused_skill() {
        let dir = tempdir().unwrap();
        let paths = AppPaths::for_test(dir.path());
        let source = paths
            .provider_root(Provider::Cursor)
            .unwrap()
            .join("paused");
        std::fs::create_dir_all(&source).unwrap();
        std::fs::write(source.join("SKILL.md"), "# paused").unwrap();
        let skills = SkillRepository::new(paths.clone());
        let id = skills.scan().unwrap()[0].id.clone();
        skills.pause(&id).unwrap();
        let library = LibraryRepository::new(paths);

        let result = batch_migrate_provider_skills(&skills, &library, vec![id], false);

        assert_eq!(result.failed, 1);
        assert!(result.items[0]
            .message
            .as_deref()
            .is_some_and(|message| message.contains("恢复")));
        assert!(library.list_library_skills().unwrap().is_empty());
    }
}
