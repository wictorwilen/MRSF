//! A complete application of the published crate, using only in-memory data.
//! Run with `cargo run --locked`; no local SDK build or sidecar files are needed.
use mrsf::{
    add_comment, parse_sidecar_content, resolve_comment, to_json, to_yaml, validate,
    AddCommentOptions, Format, MrsfDocument,
};

const EMPTY_SIDECAR: &str = "mrsf_version: \"1.0\"\ndocument: guide.md\ncomments: []\n";

fn build_review() -> Result<MrsfDocument, Box<dyn std::error::Error>> {
    let mut doc = parse_sidecar_content(EMPTY_SIDECAR, Format::Yaml)?;

    // Imagine line 3 is "\u{1f600} foo bar". Rust stores that emoji as four UTF-8
    // bytes, but MRSF columns count UTF-16 units: the emoji is two units and the
    // space is one. The half-open range 3..6 therefore selects exactly "foo".
    //
    // add_comment returns a borrowed comment inside doc. Clone only its small id
    // so that borrow ends before adding a reply with another mutable doc borrow.
    let parent_id = add_comment(
        &mut doc,
        AddCommentOptions {
            author: "Reviewer".into(),
            text: "Please clarify this selection.".into(),
            line: Some(3),
            start_column: Some(3),
            end_column: Some(6),
            selected_text: Some("foo".into()),
            extensions: [("x_example".into(), "published crate".into())]
                .into_iter()
                .collect(),
            ..Default::default()
        },
    )?
    .id
    .clone();

    add_comment(
        &mut doc,
        AddCommentOptions {
            author: "Another reviewer".into(),
            text: "This reply remains open independently.".into(),
            reply_to: Some(parent_id.clone()),
            ..Default::default()
        },
    )?;
    if !resolve_comment(&mut doc, &parent_id) {
        return Err("The newly created parent comment was not found".into());
    }

    let report = validate(&doc);
    if !report.valid {
        return Err(format!("Sidecar validation failed: {:?}", report.errors).into());
    }
    Ok(doc)
}

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let doc = build_review()?;
    // These are fresh string serializations. For existing files, use the SDK's
    // write_sidecar API instead so human-authored YAML annotations are retained.
    let yaml = to_yaml(&doc)?;
    let json = to_json(&doc)?;
    for (text, format) in [(&yaml, Format::Yaml), (&json, Format::Json)] {
        let reparsed = parse_sidecar_content(text, format)?;
        if reparsed != doc {
            return Err(format!("{format:?} round trip changed the sidecar").into());
        }
    }
    println!("YAML:\n{yaml}");
    println!("JSON:\n{json}");
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn published_api_preserves_thread_state_extensions_and_both_formats() {
        let doc = build_review().unwrap();
        assert_eq!(doc.comments.len(), 2);
        assert!(doc.comments[0].resolved);
        assert!(!doc.comments[1].resolved);
        assert_eq!(
            doc.comments[1].reply_to.as_deref(),
            Some(doc.comments[0].id.as_str())
        );
        assert_eq!(doc.comments[0].extra["x_example"], "published crate");
        assert_eq!(
            mrsf::utf16_slice("\u{1f600} foo bar", 3, Some(6)).unwrap(),
            "foo"
        );
        for (text, format) in [
            (to_yaml(&doc).unwrap(), Format::Yaml),
            (to_json(&doc).unwrap(), Format::Json),
        ] {
            let reparsed = parse_sidecar_content(&text, format).unwrap();
            assert!(validate(&reparsed).valid);
            assert_eq!(reparsed, doc);
        }
    }
}
