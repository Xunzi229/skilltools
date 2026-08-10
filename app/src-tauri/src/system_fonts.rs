use crate::error::AppError;

/// 枚举本机已安装字体族（去重、按名称排序）。
pub fn list_system_font_families() -> Result<Vec<String>, AppError> {
    let source = font_kit::source::SystemSource::new();
    let mut families = source.all_families().map_err(|error| AppError::Io {
        message: format!("枚举系统字体失败：{error}"),
    })?;
    families.sort_by(|left, right| {
        left.to_ascii_lowercase()
            .cmp(&right.to_ascii_lowercase())
            .then_with(|| left.cmp(right))
    });
    families.dedup();
    Ok(families)
}

#[cfg(test)]
mod tests {
    use super::list_system_font_families;

    #[test]
    fn lists_at_least_one_system_font() {
        let fonts = list_system_font_families().expect("enumerate fonts");
        assert!(
            !fonts.is_empty(),
            "expected at least one system font family"
        );
    }
}
