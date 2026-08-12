use std::collections::HashSet;

use uuid::Uuid;

use crate::error::AppError;
use crate::library_repository::{ensure_unique_name, find_skill_mut, LibraryRepository};
use crate::model::{LibrarySkillSummary, SkillGroup, Tag};

impl LibraryRepository {
    pub fn list_tags(&self) -> Result<Vec<Tag>, AppError> {
        let mut tags = self.load_index()?.tags;
        tags.sort_by(|left, right| left.name.cmp(&right.name));
        Ok(tags)
    }

    pub fn create_tag(&self, name: String, color: Option<String>) -> Result<Tag, AppError> {
        self.mutate_index(|index| {
            ensure_unique_name(&index.tags, &name, None, "标签", |tag| {
                (&tag.id, &tag.name)
            })?;
            let tag = Tag {
                id: Uuid::new_v4().to_string(),
                name,
                color,
            };
            index.tags.push(tag.clone());
            Ok(tag)
        })
    }

    pub fn rename_tag(&self, id: &str, name: String) -> Result<Tag, AppError> {
        self.mutate_index(|index| {
            ensure_unique_name(&index.tags, &name, Some(id), "标签", |tag| {
                (&tag.id, &tag.name)
            })?;
            let tag = index
                .tags
                .iter_mut()
                .find(|tag| tag.id == id)
                .ok_or_else(|| AppError::TagNotFound { id: id.to_owned() })?;
            tag.name = name;
            Ok(tag.clone())
        })
    }

    pub fn update_tag(
        &self,
        id: &str,
        name: String,
        color: Option<String>,
    ) -> Result<Tag, AppError> {
        self.mutate_index(|index| {
            ensure_unique_name(&index.tags, &name, Some(id), "标签", |tag| {
                (&tag.id, &tag.name)
            })?;
            let tag = index
                .tags
                .iter_mut()
                .find(|tag| tag.id == id)
                .ok_or_else(|| AppError::TagNotFound { id: id.to_owned() })?;
            tag.name = name;
            tag.color = color;
            Ok(tag.clone())
        })
    }

    pub fn delete_tag(&self, id: &str) -> Result<(), AppError> {
        self.mutate_index(|index| {
            let original_len = index.tags.len();
            index.tags.retain(|tag| tag.id != id);
            if index.tags.len() == original_len {
                return Err(AppError::TagNotFound { id: id.to_owned() });
            }
            for skill in &mut index.library_skills {
                skill.tag_ids.retain(|tag_id| tag_id != id);
            }
            Ok(())
        })
    }

    pub fn set_skill_tags(
        &self,
        skill_id: &str,
        tag_ids: Vec<String>,
    ) -> Result<LibrarySkillSummary, AppError> {
        self.mutate_index(|index| {
            let unique = tag_ids.iter().collect::<HashSet<_>>();
            if unique.len() != tag_ids.len()
                || tag_ids
                    .iter()
                    .any(|id| !index.tags.iter().any(|tag| tag.id == *id))
            {
                return Err(AppError::TagNotFound {
                    id: tag_ids
                        .into_iter()
                        .find(|id| !index.tags.iter().any(|tag| tag.id == *id))
                        .unwrap_or_else(|| "重复标签".to_string()),
                });
            }
            let skill = find_skill_mut(index, skill_id)?;
            skill.tag_ids = tag_ids;
            Ok(skill.clone())
        })
    }

    pub fn list_groups(&self) -> Result<Vec<SkillGroup>, AppError> {
        let mut groups = self.load_index()?.groups;
        groups.sort_by(|left, right| {
            left.order
                .cmp(&right.order)
                .then(left.name.cmp(&right.name))
        });
        Ok(groups)
    }

    pub fn create_group(
        &self,
        name: String,
        color: Option<String>,
    ) -> Result<SkillGroup, AppError> {
        self.mutate_index(|index| {
            ensure_unique_name(&index.groups, &name, None, "分组", |group| {
                (&group.id, &group.name)
            })?;
            let order = index
                .groups
                .iter()
                .map(|group| group.order)
                .max()
                .unwrap_or(-1)
                .saturating_add(1);
            let group = SkillGroup {
                id: Uuid::new_v4().to_string(),
                name,
                order,
                color,
            };
            index.groups.push(group.clone());
            Ok(group)
        })
    }

    pub fn rename_group(&self, id: &str, name: String) -> Result<SkillGroup, AppError> {
        self.mutate_index(|index| {
            ensure_unique_name(&index.groups, &name, Some(id), "分组", |group| {
                (&group.id, &group.name)
            })?;
            let group = index
                .groups
                .iter_mut()
                .find(|group| group.id == id)
                .ok_or_else(|| AppError::GroupNotFound { id: id.to_owned() })?;
            group.name = name;
            Ok(group.clone())
        })
    }

    pub fn update_group(
        &self,
        id: &str,
        name: String,
        color: Option<String>,
    ) -> Result<SkillGroup, AppError> {
        self.mutate_index(|index| {
            ensure_unique_name(&index.groups, &name, Some(id), "分组", |group| {
                (&group.id, &group.name)
            })?;
            let group = index
                .groups
                .iter_mut()
                .find(|group| group.id == id)
                .ok_or_else(|| AppError::GroupNotFound { id: id.to_owned() })?;
            group.name = name;
            group.color = color;
            Ok(group.clone())
        })
    }

    pub fn update_group_order(&self, id: &str, order: i32) -> Result<SkillGroup, AppError> {
        self.mutate_index(|index| {
            let group = index
                .groups
                .iter_mut()
                .find(|group| group.id == id)
                .ok_or_else(|| AppError::GroupNotFound { id: id.to_owned() })?;
            group.order = order;
            Ok(group.clone())
        })
    }

    pub fn delete_group(&self, id: &str) -> Result<(), AppError> {
        self.mutate_index(|index| {
            let original_len = index.groups.len();
            index.groups.retain(|group| group.id != id);
            if index.groups.len() == original_len {
                return Err(AppError::GroupNotFound { id: id.to_owned() });
            }
            for skill in &mut index.library_skills {
                if skill.group_id.as_deref() == Some(id) {
                    skill.group_id = None;
                }
            }
            Ok(())
        })
    }

    pub fn set_skill_group(
        &self,
        skill_id: &str,
        group_id: Option<String>,
    ) -> Result<LibrarySkillSummary, AppError> {
        self.mutate_index(|index| {
            if let Some(id) = &group_id {
                if !index.groups.iter().any(|group| group.id == *id) {
                    return Err(AppError::GroupNotFound { id: id.clone() });
                }
            }
            let skill = find_skill_mut(index, skill_id)?;
            skill.group_id = group_id;
            Ok(skill.clone())
        })
    }
}
