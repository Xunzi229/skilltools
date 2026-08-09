use crate::library_repository::LibraryRepository;
use crate::model::{BatchItemResult, BatchItemStatus, BatchResult, Provider};
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

pub fn batch_migrate_provider_skills(
    skills: &SkillRepository,
    library: &LibraryRepository,
    skill_ids: Vec<String>,
    replace_with_link: bool,
) -> BatchResult {
    let items = skill_ids
        .into_iter()
        .map(|id| {
            let result = skills.detail(&id).and_then(|detail| {
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
