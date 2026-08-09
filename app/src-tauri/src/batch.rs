use crate::model::{BatchItemResult, BatchItemStatus, BatchResult};

pub fn map_item<T, E: ToString>(
    id: String,
    result: Result<T, E>,
) -> BatchItemResult {
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

#[allow(dead_code)]
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
