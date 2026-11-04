//! Normative requirements are named by specification section. Raw malformed
//! data is tested before Rust's type system can rule it out for typed callers.
mod support;
use mrsf::*;
use serde_json::{json, Value};
use std::fs;
use support::*;

#[test]
fn section4_required_fields_and_malformed_types_have_diagnostics() {
    let valid = serde_json::to_value(document()).unwrap();
    for field in ["mrsf_version", "document", "comments"] {
        let mut value = valid.clone();
        value.as_object_mut().unwrap().remove(field);
        let source = value.to_string();
        let Err(Error::Validation(report)) = parse_sidecar_content(&source, Format::Json) else {
            panic!("missing {field} accepted");
        };
        assert!(report.errors.iter().any(|e| e.message.contains(field)));
    }
    let mut invalid = valid;
    for (field, value) in [
        ("id", json!(5)),
        ("author", json!({})),
        ("timestamp", json!("bad")),
        ("text", json!([])),
        ("resolved", json!("yes")),
        ("line", json!(-1)),
        ("start_column", json!(0.5)),
    ] {
        invalid["comments"][0][field] = value;
    }
    let Err(Error::Validation(report)) = parse_sidecar_content(&invalid.to_string(), Format::Json)
    else {
        panic!("invalid fields accepted");
    };
    for field in [
        "id",
        "author",
        "timestamp",
        "text",
        "resolved",
        "line",
        "start_column",
    ] {
        assert!(
            report.errors.iter().any(|e| e.path.ends_with(field)),
            "missing diagnostic for {field}: {report}"
        );
    }
}

#[test]
fn section5_version_negotiation_is_independent_of_crate_version() {
    let mut doc = document();
    assert_eq!(doc.mrsf_version, "1.0");
    doc.mrsf_version = "1.42".into();
    assert!(validate(&doc).valid);
    assert!(!validate(&doc).warnings.is_empty());
    assert!(parse_sidecar_content(&to_json(&doc).unwrap(), Format::Json).is_ok());
    for version in ["2.0", "0.9", "42.1"] {
        let value = json!({"mrsf_version":version,"document":"a.md","comments":[]});
        for lenient in [false, true] {
            let result = if lenient {
                parse_sidecar_content_lenient(&value.to_string(), Format::Json).map(|p| p.document)
            } else {
                parse_sidecar_content(&value.to_string(), Format::Json)
            };
            assert!(matches!(result, Err(Error::UnsupportedVersion(_))));
        }
    }
    doc.mrsf_version = "1.x".into();
    assert!(!validate(&doc).valid);
}

#[test]
fn section6_required_fields_and_timezone() {
    let valid = serde_json::to_value(document()).unwrap();
    for field in ["id", "author", "timestamp", "text", "resolved"] {
        let mut value = valid.clone();
        value["comments"][0].as_object_mut().unwrap().remove(field);
        assert!(matches!(
            parse_sidecar_content(&value.to_string(), Format::Json),
            Err(Error::Validation(_))
        ));
    }
    for timestamp in ["2026-01-01T00:00:00Z", "2026-01-01T01:00:00+01:00"] {
        let mut doc = document();
        doc.comments[0].timestamp = timestamp.into();
        assert!(validate(&doc).valid);
    }
    for timestamp in ["2026-01-01T00:00:00", "2026-02-31T00:00:00Z", "not a date"] {
        let mut doc = document();
        doc.comments[0].timestamp = timestamp.into();
        assert!(!validate(&doc).valid);
    }
}

#[test]
fn section6_lengths_use_unicode_characters_not_bytes() {
    let mut doc = document();
    doc.comments[0].selected_text = Some("😀".repeat(4096));
    assert!(validate(&doc).valid);
    doc.comments[0].selected_text = Some("😀".repeat(4097));
    assert!(!validate(&doc).valid);
    doc.comments[0].selected_text = None;
    doc.comments[0].text = "a".repeat(16385);
    assert!(!validate(&doc).warnings.is_empty());
}

#[test]
fn section6_hash_identity_and_integrity() {
    assert_eq!(
        compute_hash("hello"),
        "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824"
    );
    assert_eq!(compute_hash("😀 日本語"), compute_hash("😀 日本語"));
    let mut doc = document();
    doc.comments[0].selected_text = Some("hello".into());
    doc.comments[0].selected_text_hash = Some(compute_hash("hello"));
    assert!(validate(&doc).warnings.is_empty());
    doc.comments[0].selected_text_hash = Some("0".repeat(64));
    assert!(validate(&doc)
        .warnings
        .iter()
        .any(|d| d.message.contains("mismatch")));
}

#[test]
fn section7_range_constraints_and_utf16() {
    let mut doc = document();
    let c = &mut doc.comments[0];
    c.line = Some(3);
    c.end_line = Some(2);
    assert!(!validate(&doc).valid);
    doc.comments[0].end_line = Some(3);
    doc.comments[0].start_column = Some(10);
    doc.comments[0].end_column = Some(2);
    assert!(!validate(&doc).valid);
    doc.comments[0].end_line = Some(4);
    assert!(validate(&doc).valid);
    assert_eq!(utf16_length("😀e\u{301}\t𠀀"), 7);
    assert_eq!(utf16_slice("😀 foo", 3, Some(6)).unwrap(), "foo");
    assert!(utf16_slice("😀 foo", 1, None).is_err());
    assert_eq!(utf16_slice("😀 foo", 0, Some(2)).unwrap(), "😀");
}

#[test]
fn section9_resolve_independence_and_deletion_promotion() {
    let mut doc = document();
    doc.comments[0].line = Some(5);
    doc.comments[0].selected_text = Some("parent anchor".into());
    let mut reply = comment("reply");
    reply.reply_to = Some("root".into());
    let mut own = comment("own");
    own.reply_to = Some("root".into());
    own.line = Some(9);
    doc.comments.extend([reply, own]);
    assert!(resolve_comment(&mut doc, "root"));
    assert!(!doc.comments[1].resolved);
    assert!(remove_comment(
        &mut doc,
        "root",
        RemoveCommentOptions::default()
    ));
    assert_eq!(doc.comments[0].line, Some(5));
    assert_eq!(
        doc.comments[0].selected_text.as_deref(),
        Some("parent anchor")
    );
    assert_eq!(doc.comments[0].reply_to, None);
    assert_eq!(doc.comments[1].line, Some(9));
    assert_eq!(doc.comments[1].selected_text, None);
}

#[test]
fn section9_nested_threads_cascade_and_dangling_cycles_are_bounded() {
    let mut doc = document();
    let mut child = comment("child");
    child.reply_to = Some("root".into());
    let mut grandchild = comment("grandchild");
    grandchild.reply_to = Some("child".into());
    doc.comments.extend([child, grandchild]);
    assert_eq!(get_threads(&doc.comments)["root"].len(), 3);
    doc.comments.reverse();
    assert_eq!(get_threads(&doc.comments)["root"][0].id, "root");
    doc.comments.reverse();
    remove_comment(&mut doc, "child", RemoveCommentOptions::default());
    assert_eq!(doc.comments[1].reply_to.as_deref(), Some("root"));
    assert_eq!(resolve_thread(&mut doc, "root", true), 2);
    remove_comment(&mut doc, "root", RemoveCommentOptions { cascade: true });
    assert!(doc.comments.is_empty());
    let mut a = comment("a");
    a.reply_to = Some("b".into());
    let mut b = comment("b");
    b.reply_to = Some("a".into());
    let doc = MrsfDocument {
        comments: vec![a, b],
        ..document()
    };
    assert_eq!(get_threads(&doc.comments).len(), 1);
    assert!(validate(&doc)
        .warnings
        .iter()
        .any(|w| w.message.contains("cycle")));
    let mut dangling = comment("z");
    dangling.reply_to = Some("missing".into());
    let mut child = comment("a");
    child.reply_to = Some("z".into());
    assert_eq!(get_threads(&[dangling, child])["z"].len(), 2);
}

#[test]
fn section10_unknown_nested_extensions_and_json_yaml_equivalence() {
    let mut doc = document();
    doc.extra.insert(
        "future".into(),
        json!({"nested":[{"日本語":"😀"},null,true]}),
    );
    doc.comments[0]
        .extra
        .insert("x_tool".into(), json!({"a":[1,2.5,"yes",false]}));
    doc.comments[0]
        .extra
        .insert("unknown".into(), json!("preserve"));
    let yaml = to_yaml(&doc).unwrap();
    assert_eq!(parse_sidecar_content(&yaml, Format::Yaml).unwrap(), doc);
    assert_eq!(
        parse_sidecar_content(&to_json(&doc).unwrap(), Format::Json).unwrap(),
        doc
    );
    assert!(validate(&doc).valid);
    doc.comments.push(doc.comments[0].clone());
    assert!(validate(&doc)
        .errors
        .iter()
        .any(|d| d.message.contains("Duplicate")));
}

#[test]
fn explicit_lenient_recovery_never_hides_diagnostics() {
    let value = json!({"document":5, "x_data":{"preserve":true}, "comments":[null, {"id":"a","text":[],"resolved":"no","line":-1,"x_more":[1,2]}]});
    let source = value.to_string();
    assert!(parse_sidecar_content(&source, Format::Json).is_err());
    let parsed = parse_sidecar_content_lenient(&source, Format::Json).unwrap();
    assert!(!parsed.diagnostics.valid);
    assert!(parsed.diagnostics.errors.len() >= 5);
    assert_eq!(parsed.document.comments.len(), 1);
    assert_eq!(parsed.document.comments[0].line, None);
    assert_eq!(parsed.document.comments[0].extra["x_more"], json!([1, 2]));
    assert_eq!(parsed.document.extra["x_data"], json!({"preserve":true}));
    assert!(parse_sidecar_content_lenient("comments: [", Format::Yaml).is_err());
}

#[test]
fn yaml12_rejects_duplicate_keys_and_does_not_coerce_boolean_strings() {
    assert!(parse_value("key: a\nkey: b\n", Format::Yaml).is_err());
    let value = parse_value("yes: yes\non: on\nfalse: false\n", Format::Yaml).unwrap();
    assert_eq!(value, json!({"yes":"yes","on":"on","false":false}));
    assert_eq!(
        parse_value("a: yes\nb: on\nc: 2026-01-01T00:00:00Z\n", Format::Yaml).unwrap(),
        json!({"a":"yes","b":"on","c":"2026-01-01T00:00:00Z"})
    );
}

#[test]
fn crud_generation_filters_summary_and_invalid_add_are_transactional() {
    let mut doc = MrsfDocument::new("guide.md");
    let first = add_comment(
        &mut doc,
        AddCommentOptions {
            author: "A".into(),
            text: "hello".into(),
            selected_text: Some("😀 日本語".into()),
            ..Default::default()
        },
    )
    .unwrap()
    .clone();
    assert!(uuid::Uuid::parse_str(&first.id).is_ok());
    assert_eq!(
        first.selected_text_hash.as_deref(),
        Some(compute_hash("😀 日本語").as_str())
    );
    let before = doc.clone();
    assert!(add_comment(
        &mut doc,
        AddCommentOptions {
            id: Some(first.id.clone()),
            ..Default::default()
        }
    )
    .is_err());
    assert_eq!(doc, before);
    assert!(
        normalize_comment_extensions(serde_json::from_value(json!({"not_x":true})).unwrap())
            .is_err()
    );
    resolve_comment(&mut doc, &first.id);
    assert!(filter_comments(
        &doc.comments,
        &CommentFilter {
            open: Some(true),
            ..Default::default()
        }
    )
    .is_empty());
    assert_eq!(summarize(&doc.comments).resolved, 1);
}

#[test]
fn section3_authoritative_discovery_and_traversal_rejection() {
    let dir = TestDir::new();
    fs::create_dir(dir.path(".git")).unwrap();
    fs::create_dir(dir.path("docs")).unwrap();
    fs::write(dir.path("docs/guide.md"), "# Guide").unwrap();
    fs::write(dir.path("docs/guide.md.review.yaml"), "not authoritative").unwrap();
    assert_eq!(
        discover_sidecar("docs/guide.md", &dir.0).unwrap(),
        dir.path("docs/guide.md.review.yaml")
    );
    fs::write(dir.path(".mrsf.yaml"), "sidecar_root: .reviews\n").unwrap();
    assert_eq!(
        discover_sidecar("docs/guide.md", &dir.0).unwrap(),
        dir.path(".reviews/docs/guide.md.review.yaml")
    );
    assert_eq!(find_workspace_root(dir.path("docs")).unwrap(), dir.0);
    for root in [
        "/etc",
        "../out",
        r"..\out",
        r"C:\out",
        r"\out",
        r"\\server\out",
        "a/../out",
    ] {
        assert!(safe_relative_path(root).is_err(), "{root}");
        let source = format!("sidecar_root: {}\n", serde_json::to_string(root).unwrap());
        fs::write(dir.path(".mrsf.yaml"), source).unwrap();
        assert!(load_config(&dir.0).is_err(), "{root}");
    }
    fs::write(dir.path(".mrsf.yaml"), "sidecar_root: 5\n").unwrap();
    assert!(load_config(&dir.0).is_err());
    assert!(discover_sidecar("../escape.md", &dir.0).is_err());
    assert_eq!(
        sidecar_to_document("a.md.review.json"),
        std::path::PathBuf::from("a.md")
    );
}

#[test]
fn validation_file_reports_raw_errors_and_filesystem_failures() {
    let dir = TestDir::new();
    fs::write(dir.path("bad.review.json"), r#"{"comments":[{"id":5}]}"#).unwrap();
    let report = validate_file(dir.path("bad.review.json")).unwrap();
    assert!(!report.valid);
    assert!(report.errors.len() >= 6);
    assert!(parse_sidecar(dir.path("missing")).is_err());
    assert!(write_sidecar(dir.path("bad.review.json"), &document()).is_err());
    assert!(matches!(parse_sidecar(&dir.0), Err(Error::Io(_))));
    let mut bad = document();
    bad.comments[0].line = Some(0);
    assert!(write_sidecar(dir.path("bad.yaml"), &bad).is_err());
    assert!(!dir.path("bad.yaml").exists());
    assert_eq!(parse_value("null", Format::Json).unwrap(), Value::Null);
}

#[test]
fn extensions_cannot_shadow_typed_fields_and_warnings_can_be_escalated() {
    let mut doc = document();
    doc.comments[0].extra.insert("resolved".into(), json!(true));
    assert!(!validate(&doc).valid);
    assert!(to_yaml(&doc).is_err());
    doc.comments[0].extra.remove("resolved");
    doc.extra.insert("comments".into(), json!([]));
    assert!(!validate(&doc).valid);
    doc.extra.remove("comments");
    doc.comments[0].reply_to = Some("missing".into());
    assert!(validate(&doc).valid);
    let strict = validate_with_options(&doc, ValidateOptions { strict: true });
    assert!(!strict.valid);
    assert!(strict.errors.is_empty());
    assert_eq!(strict.warnings.len(), 1);
    assert!(strict.to_string().contains(&strict.warnings[0].message));
}

#[cfg(unix)]
#[test]
fn existing_symlink_ancestors_cannot_escape_workspace() {
    let root = TestDir::new();
    let outside = TestDir::new();
    fs::create_dir(root.path(".git")).unwrap();
    fs::write(outside.path("guide.md"), "outside").unwrap();
    std::os::unix::fs::symlink(&outside.0, root.path("linked")).unwrap();
    assert!(resolve_document_path(&root.0, "linked/guide.md").is_err());
    assert!(resolve_document_path(&root.0, "linked/not-created.md").is_err());
    assert!(discover_sidecar("linked/guide.md", &root.0).is_err());
}
