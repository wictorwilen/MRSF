//! Preservation is asserted at the byte level for untouched text, not merely by
//! reparsing a whole-document dump. The CST editor is exercised through public
//! APIs including real file replacement, structural changes, and failure paths.
mod support;
use mrsf::*;
use serde_json::json;
use std::fs;
use support::*;

const SOURCE: &str = "# human authored sidecar\nmrsf_version: \"1.0\" # format\ndocument: 'guide.md'\nx_workspace:\n  # nested extension comment\n  data: {a: [1, \"two\", true], 'odd.key': '日本語'}\ncomments:\n  # first review\n  - id: root\n    author: 'Alice'\n    timestamp: \"2026-01-01T00:00:00Z\"\n    text: |\n      First paragraph.\n      Second line.\n    resolved: false # status\n    x_shared:\n      # comment in a nested object\n      quoted: \"keep me\"\n      array: [1, {nested: '😀 日本語'}]\n  # second review\n  - id: child\n    author: Bob\n    timestamp: '2026-01-01T00:00:00Z'\n    text: >-\n      Folded prose that should\n      stay folded.\n    resolved: false\n    reply_to: root\n";

fn comments(source: &str) -> Vec<String> {
    // Fixture-only inspection, never used to edit YAML. These lines deliberately
    // contain no '#' inside quoted scalars.
    source
        .lines()
        .filter_map(|line| line.find('#').map(|i| line[i..].trim().to_owned()))
        .collect()
}

#[test]
fn no_op_is_byte_identical_lf_crlf_and_no_trailing_newline() {
    for source in [
        SOURCE.into(),
        SOURCE.replace('\n', "\r\n"),
        SOURCE.trim_end().into(),
    ] {
        let doc = parse_sidecar_content(&source, Format::Yaml).unwrap();
        assert_eq!(update_yaml(&source, &doc).unwrap(), source);
        let dir = TestDir::new();
        let path = dir.path("guide.md.review.yaml");
        fs::write(&path, &source).unwrap();
        write_sidecar(&path, &doc).unwrap();
        assert_eq!(fs::read_to_string(path).unwrap(), source);
    }
}

#[test]
fn targeted_scalar_write_changes_only_target_bytes() {
    for source in [SOURCE.into(), SOURCE.replace('\n', "\r\n")] {
        let mut doc = parse_sidecar_content(&source, Format::Yaml).unwrap();
        resolve_comment(&mut doc, "root");
        let output = update_yaml(&source, &doc).unwrap();
        assert_eq!(output, source.replace("false # status", "true # status"));
        assert_eq!(parse_sidecar_content(&output, Format::Yaml).unwrap(), doc);
    }
}

#[test]
fn edits_keep_quote_and_literal_folded_scalar_styles() {
    let mut doc = parse_sidecar_content(SOURCE, Format::Yaml).unwrap();
    doc.comments[0].author = "Alice's new name".into();
    doc.comments[0].text = "Changed first paragraph.\nSecond line.\n".into();
    doc.comments[1].text = "Changed folded prose.".into();
    let output = update_yaml(SOURCE, &doc).unwrap();
    assert!(output.contains("author: 'Alice''s new name'"), "{output}");
    assert!(output.contains("text: |"), "{output}");
    assert!(output.contains("text: >-"), "{output}");
    assert!(output.contains("quoted: \"keep me\""));
    assert_eq!(comments(&output), comments(SOURCE));
    assert_eq!(parse_sidecar_content(&output, Format::Yaml).unwrap(), doc);
}

#[test]
fn nested_extension_edits_preserve_unmodified_style_and_comments() {
    let mut doc = parse_sidecar_content(SOURCE, Format::Yaml).unwrap();
    doc.extra["x_workspace"]["data"]["odd.key"] = json!("変更");
    doc.comments[0].extra["x_shared"]["array"][1]["nested"] = json!("😀 changed");
    doc.comments[0].extra["x_shared"]["new.key"] = json!({"a":[1,null]});
    let output = update_yaml(SOURCE, &doc).unwrap();
    assert!(output.contains("'odd.key': '変更'"), "{output}");
    assert!(output.contains("nested: '😀 changed'"), "{output}");
    assert!(output.contains("quoted: \"keep me\""));
    assert_eq!(comments(&output), comments(SOURCE));
    assert_eq!(parse_sidecar_content(&output, Format::Yaml).unwrap(), doc);
}

#[test]
fn add_delete_and_reparent_preserve_yaml_comments_and_survivor_formatting() {
    for source in [SOURCE.into(), SOURCE.replace('\n', "\r\n")] {
        let mut doc = parse_sidecar_content(&source, Format::Yaml).unwrap();
        doc.comments[0].line = Some(3);
        doc.comments[0].selected_text = Some("selected".into());
        let with_anchor = update_yaml(&source, &doc).unwrap();
        add_comment(
            &mut doc,
            AddCommentOptions {
                id: Some("added".into()),
                author: "New".into(),
                text: "New review".into(),
                timestamp: Some("2026-01-02T00:00:00Z".into()),
                ..Default::default()
            },
        )
        .unwrap();
        let added = update_yaml(&with_anchor, &doc).unwrap();
        assert!(added.contains("text: >-"));
        assert_eq!(comments(&added), comments(SOURCE));
        assert!(remove_comment(
            &mut doc,
            "root",
            RemoveCommentOptions::default()
        ));
        let removed = update_yaml(&added, &doc).unwrap();
        for marker in comments(SOURCE) {
            assert!(removed.contains(&marker), "lost {marker}:\n{removed}");
        }
        assert!(removed.contains("author: Bob"));
        assert!(removed.contains("text: >-"));
        assert_eq!(parse_sidecar_content(&removed, Format::Yaml).unwrap(), doc);
        assert_eq!(doc.comments[0].line, Some(3));
        assert_eq!(doc.comments[0].reply_to, None);
        if source.contains("\r\n") {
            assert!(!removed.replace("\r\n", "").contains('\n'));
        }
    }
}

#[test]
fn empty_sequence_addition_and_last_removal_are_safe() {
    let source = "# header\nmrsf_version: \"1.0\"\ndocument: guide.md\ncomments: [] # notes\n";
    let mut doc = parse_sidecar_content(source, Format::Yaml).unwrap();
    doc.comments.push(comment("a"));
    let added = update_yaml(source, &doc).unwrap();
    assert_eq!(parse_sidecar_content(&added, Format::Yaml).unwrap(), doc);
    doc.comments.clear();
    let removed = update_yaml(&added, &doc).unwrap();
    assert_eq!(parse_sidecar_content(&removed, Format::Yaml).unwrap(), doc);
    assert!(removed.contains("# header"));
    assert!(removed.contains("# notes"));
}

#[test]
fn unsupported_reordering_leaves_original_file_and_no_scratch_files() {
    let dir = TestDir::new();
    let path = dir.path("guide.md.review.yaml");
    fs::write(&path, SOURCE).unwrap();
    let mut doc = parse_sidecar(&path).unwrap();
    doc.comments.reverse();
    assert!(matches!(
        write_sidecar(&path, &doc),
        Err(Error::Preservation(_))
    ));
    assert_eq!(fs::read_to_string(&path).unwrap(), SOURCE);
    assert_eq!(fs::read_dir(&dir.0).unwrap().count(), 1);
}

#[test]
fn aliases_cannot_silently_change_another_comment() {
    let source = "mrsf_version: \"1.0\"\ndocument: guide.md\ncomments:\n  - &shared\n    id: root\n    author: Alice\n    timestamp: '2026-01-01T00:00:00Z'\n    text: Review\n    resolved: false\nx_copy: *shared\n";
    let mut doc = parse_sidecar_content(source, Format::Yaml).unwrap();
    doc.comments[0].resolved = true;
    // The safe contract permits alias-aware edits or an explicit refusal, but
    // never changed extension values. Original source remains owned by caller.
    match update_yaml(source, &doc) {
        Ok(output) => assert_eq!(parse_sidecar_content(&output, Format::Yaml).unwrap(), doc),
        Err(Error::Preservation(_)) => (),
        Err(e) => panic!("unexpected error: {e}"),
    }
}

#[test]
fn atomic_write_new_json_yaml_and_failed_destination() {
    let dir = TestDir::new();
    for name in ["nested/guide.md.review.yaml", "nested/guide.md.review.json"] {
        let path = dir.path(name);
        write_sidecar(&path, &document()).unwrap();
        assert_eq!(parse_sidecar(&path).unwrap(), document());
        let mut doc = parse_sidecar(&path).unwrap();
        doc.comments[0].resolved = true;
        write_sidecar(&path, &doc).unwrap();
        assert_eq!(parse_sidecar(path).unwrap(), doc);
    }
    fs::write(dir.path("not-a-directory"), "block").unwrap();
    assert!(write_sidecar(dir.path("not-a-directory/sidecar.yaml"), &document()).is_err());
    assert_eq!(
        fs::read_to_string(dir.path("not-a-directory")).unwrap(),
        "block"
    );
}

#[test]
fn displaced_comments_with_an_unusual_footer_fail_without_changing_original() {
    let source = format!("{SOURCE}#no-space-footer\n");
    let dir = TestDir::new();
    let path = dir.path("guide.md.review.yaml");
    fs::write(&path, &source).unwrap();
    let mut doc = parse_sidecar(&path).unwrap();
    remove_comment(&mut doc, "root", RemoveCommentOptions::default());
    assert!(matches!(
        write_sidecar(&path, &doc),
        Err(Error::Preservation(_))
    ));
    assert_eq!(fs::read_to_string(path).unwrap(), source);
}

#[test]
fn duplicate_annotations_are_retained_independently_on_deletion() {
    let source = SOURCE
        .replace("# status", "# repeated")
        .replace("# comment in a nested object", "# repeated");
    let mut doc = parse_sidecar_content(&source, Format::Yaml).unwrap();
    remove_comment(&mut doc, "root", RemoveCommentOptions::default());
    let output = update_yaml(&source, &doc).unwrap();
    assert_eq!(output.matches("# repeated").count(), 2);
}

#[test]
fn existing_footer_layout_is_not_silently_normalized() {
    let footer = "\n# original footer\n\n# second footer\n";
    let source = format!("{SOURCE}{footer}");
    let mut doc = parse_sidecar_content(&source, Format::Yaml).unwrap();
    remove_comment(&mut doc, "root", RemoveCommentOptions::default());
    match update_yaml(&source, &doc) {
        Ok(output) => assert!(output.contains(footer), "{output}"),
        Err(Error::Preservation(_)) => (),
        Err(e) => panic!("unexpected failure: {e}"),
    }
}

#[cfg(windows)]
#[test]
#[allow(
    clippy::permissions_set_readonly_false,
    reason = "Windows-only DOS attribute restoration"
)]
fn readonly_destination_failure_cleans_its_readonly_scratch_file() {
    let dir = TestDir::new();
    let path = dir.path("guide.md.review.yaml");
    fs::write(&path, SOURCE).unwrap();
    let mut doc = parse_sidecar(&path).unwrap();
    doc.comments[0].resolved = true;
    let mut permissions = fs::metadata(&path).unwrap().permissions();
    permissions.set_readonly(true);
    fs::set_permissions(&path, permissions).unwrap();
    let result = write_sidecar(&path, &doc);
    let mut permissions = fs::metadata(&path).unwrap().permissions();
    permissions.set_readonly(false);
    fs::set_permissions(&path, permissions).unwrap();
    assert!(matches!(result, Err(Error::Io(_))));
    assert_eq!(fs::read_to_string(path).unwrap(), SOURCE);
    assert_eq!(fs::read_dir(&dir.0).unwrap().count(), 1);
}

#[cfg(unix)]
#[test]
fn unix_destination_mode_survives_atomic_replacement() {
    use std::os::unix::fs::PermissionsExt;
    let dir = TestDir::new();
    let path = dir.path("guide.md.review.yaml");
    fs::write(&path, SOURCE).unwrap();
    fs::set_permissions(&path, fs::Permissions::from_mode(0o640)).unwrap();
    let mut doc = parse_sidecar(&path).unwrap();
    doc.comments[0].resolved = true;
    write_sidecar(&path, &doc).unwrap();
    assert_eq!(
        fs::metadata(path).unwrap().permissions().mode() & 0o777,
        0o640
    );
}
