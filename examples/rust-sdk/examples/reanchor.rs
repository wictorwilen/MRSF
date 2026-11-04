//! Source-aware reanchoring with the published crate, without filesystem or Git
//! access. A host editor can retain equivalent source and target snapshots.
use mrsf::{
    add_comment, apply_reanchor_results, reanchor_document_with_source, to_reanchor_lines, to_yaml,
    validate, AddCommentOptions, MrsfDocument, ReanchorOptions, ReanchorStatus,
};

fn reanchored_review() -> Result<MrsfDocument, Box<dyn std::error::Error>> {
    // The helpers produce 1-based line arrays: element zero is a placeholder.
    // Neighboring unchanged lines supply evidence for the selection's new range.
    let source = to_reanchor_lines(
        "# Guide\n\nDurable selection.\nUnique following context.\nAnother context line.\n",
    );
    let target = to_reanchor_lines(
        "# Guide\n\nInserted paragraph.\n\nDurable selection.\nUnique following context.\nAnother context line.\n",
    );
    let mut doc = MrsfDocument::new("guide.md");
    add_comment(
        &mut doc,
        AddCommentOptions {
            author: "Reviewer".into(),
            text: "Review this paragraph.".into(),
            line: Some(3),
            selected_text: Some("Durable selection.".into()),
            ..Default::default()
        },
    )?;

    let options = ReanchorOptions::default();
    // Resolving returns evidence without mutating doc. Inspect it before applying
    // the transaction; ambiguous/orphaned comments need reviewer attention.
    let results = reanchor_document_with_source(&doc, &source, &target, &options);
    for result in &results {
        if matches!(
            result.status,
            ReanchorStatus::Ambiguous | ReanchorStatus::Orphaned
        ) {
            return Err(format!("Anchor needs review: {}", result.reason).into());
        }
    }
    // No selected-text update is opted in, so its original value/hash survive.
    // None means there is no Git HEAD to stamp in this pure snapshot example.
    apply_reanchor_results(&mut doc, &results, &options, None);
    let report = validate(&doc);
    if !report.valid {
        return Err(format!("Reanchored sidecar is invalid: {:?}", report.errors).into());
    }
    Ok(doc)
}

fn main() -> Result<(), Box<dyn std::error::Error>> {
    println!("{}", to_yaml(&reanchored_review()?)?);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn published_api_moves_the_range_without_replacing_the_selection() {
        let doc = reanchored_review().unwrap();
        let comment = &doc.comments[0];
        assert_eq!(comment.line, Some(5));
        assert_eq!(comment.selected_text.as_deref(), Some("Durable selection."));
        assert_eq!(
            comment.selected_text_hash.as_deref(),
            Some(mrsf::compute_hash("Durable selection.").as_str())
        );
        assert!(validate(&doc).valid);
    }
}
