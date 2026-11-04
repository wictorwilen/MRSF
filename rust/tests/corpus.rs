//! Language-neutral fixtures are copied verbatim into the package so installed
//! crate tests do not depend on a surrounding repository checkout.
use mrsf::*;
use serde_json::Value;
use std::{
    fs,
    path::{Path, PathBuf},
};

fn files(path: &Path) -> Vec<PathBuf> {
    let mut result = Vec::new();
    for entry in fs::read_dir(path).unwrap() {
        let entry = entry.unwrap();
        if entry.path().is_dir() {
            result.extend(files(&entry.path()));
        } else if entry.path().extension().is_some_and(|s| s == "json") {
            result.push(entry.path());
        }
    }
    result.sort();
    result
}

fn text(value: &Value, case: &Path) -> String {
    value
        .get("text")
        .and_then(Value::as_str)
        .map(str::to_owned)
        .unwrap_or_else(|| {
            fs::read_to_string(case.parent().unwrap().join(value["path"].as_str().unwrap()))
                .unwrap()
        })
}

fn comment(value: &Value) -> Comment {
    let mut anchor = value["anchor"].clone();
    let object = anchor.as_object_mut().unwrap();
    object.insert("id".into(), value["id"].clone());
    object.insert("author".into(), "evaluation".into());
    object.insert("timestamp".into(), "2025-01-01T00:00:00Z".into());
    object.insert("text".into(), "Evaluation comment".into());
    object.insert("resolved".into(), false.into());
    serde_json::from_value(anchor).unwrap()
}

#[test]
fn shared_anchor_mesh_corpus_all_88_comments() {
    let mut failures = Vec::new();
    let mut evaluated = 0;
    for path in files(&Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/reanchor/cases"))
    {
        let parsed: Value = serde_json::from_str(&fs::read_to_string(&path).unwrap()).unwrap();
        let cases = if let Value::Array(cases) = parsed {
            cases
        } else {
            vec![parsed]
        };
        for case in cases {
            let source = to_reanchor_lines(&text(&case["source"], &path));
            let target = to_reanchor_lines(&text(&case["target"], &path));
            let comments: Vec<_> = case["comments"]
                .as_array()
                .unwrap()
                .iter()
                .map(comment)
                .collect();
            let doc = MrsfDocument {
                document: "guide.md".into(),
                comments: comments.clone(),
                ..Default::default()
            };
            let results =
                reanchor_document_with_source(&doc, &source, &target, &ReanchorOptions::default());
            for ((input, c), r) in case["comments"]
                .as_array()
                .unwrap()
                .iter()
                .zip(&comments)
                .zip(&results)
            {
                evaluated += 1;
                let expected = &input["expected"];
                let status_ok = serde_json::to_value(r.status).unwrap() == expected["status"];
                let range_ok =
                    expected
                        .get("ranges")
                        .and_then(Value::as_array)
                        .is_none_or(|ranges| {
                            ranges.is_empty()
                                || ranges.iter().any(|range| {
                                    [
                                        ("line", r.new_line.or(c.line)),
                                        ("end_line", r.new_end_line.or(c.end_line)),
                                        ("start_column", r.new_start_column.or(c.start_column)),
                                        ("end_column", r.new_end_column.or(c.end_column)),
                                    ]
                                    .iter()
                                    .all(|(field, actual)| {
                                        range.get(field).is_none_or(|v| {
                                            v.as_u64().map(|n| n as usize) == *actual
                                        })
                                    })
                                })
                        });
                if !status_ok || !range_ok {
                    failures.push(format!(
                        "{}/{} expected {}, received {:?}",
                        case["id"], c.id, expected, r
                    ));
                }
            }
        }
    }
    assert_eq!(evaluated, 88);
    assert!(
        failures.is_empty(),
        "{} failures:\n{}",
        failures.len(),
        failures.join("\n")
    );
}

#[test]
fn shared_column_conformance() {
    let cases: Value =
        serde_json::from_str(include_str!("fixtures/reanchor/column-conformance.json")).unwrap();
    for value in cases.as_array().unwrap() {
        let mut c = Comment {
            id: "columns".into(),
            ..Default::default()
        };
        c.line = value["line"].as_u64().map(|n| n as usize);
        c.end_line = value["end_line"].as_u64().map(|n| n as usize);
        c.start_column = value["start_column"].as_u64().map(|n| n as usize);
        c.end_column = value["end_column"].as_u64().map(|n| n as usize);
        let lines = to_reanchor_lines(value["text"].as_str().unwrap());
        populate_selected_text(&mut c, &lines).unwrap();
        assert_eq!(
            c.selected_text.as_deref(),
            value["selected_text"].as_str(),
            "{}",
            value["name"]
        );
        let candidate = fuzzy::exact_match(&lines, c.selected_text.as_deref().unwrap());
        assert!(candidate.iter().any(|r| r.line == c.line.unwrap()
            && c.start_column.is_none_or(|col| col == r.start_column)
            && c.end_column.is_none_or(|col| col == r.end_column)));
    }
}

#[test]
fn bundled_contracts_match_checkout_when_present() {
    let root = Path::new(env!("CARGO_MANIFEST_DIR")).parent().unwrap();
    for (name, bundled) in [
        ("mrsf.schema.json", SIDECAR_SCHEMA),
        ("mrsf-config.schema.json", CONFIG_SCHEMA),
    ] {
        if root.join(name).is_file() {
            assert_eq!(fs::read_to_string(root.join(name)).unwrap(), bundled);
        }
    }
    let fixture_root = Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/reanchor");
    let canonical_root = root.join("evaluation/reanchor");
    if canonical_root.is_dir() {
        for directory in ["cases", "documents"] {
            fn compare(local: &Path, canonical: &Path) {
                // Compare both directory inventories before checking bytes:
                // iterating only the bundled files would miss a newly added
                // canonical case and silently keep testing an outdated corpus.
                let names = |directory: &Path| -> std::collections::BTreeSet<_> {
                    fs::read_dir(directory)
                        .unwrap()
                        .map(|entry| entry.unwrap().file_name())
                        .collect()
                };
                assert_eq!(
                    names(local),
                    names(canonical),
                    "Bundled fixture inventory differs from {}",
                    canonical.display()
                );
                for entry in fs::read_dir(local).unwrap() {
                    let entry = entry.unwrap();
                    let reference = canonical.join(entry.file_name());
                    if entry.path().is_dir() {
                        compare(&entry.path(), &reference);
                    } else {
                        assert_eq!(
                            fs::read(entry.path()).unwrap(),
                            fs::read(reference).unwrap()
                        );
                    }
                }
            }
            compare(
                &fixture_root.join(directory),
                &canonical_root.join(directory),
            );
        }
        assert_eq!(
            fs::read(fixture_root.join("column-conformance.json")).unwrap(),
            fs::read(canonical_root.join("column-conformance.json")).unwrap()
        );
    }
}

#[test]
fn fuzzy_context_and_revision_emit_utf16_not_utf8_columns() {
    let source = to_reanchor_lines("# Heading\n😀 foo bar\nafter");
    let target = to_reanchor_lines("# Heading\n😀 food baz\nafter");
    let c = Comment {
        id: "unicode".into(),
        line: Some(2),
        start_column: Some(3),
        end_column: Some(10),
        selected_text: Some("foo bar".into()),
        ..Default::default()
    };
    let projected =
        project_comment_anchor(&c, &create_revision_projection(&source, &target), 0.3).unwrap();
    assert_eq!(projected.text, "food baz");
    assert_eq!(
        (projected.start_column, projected.end_column),
        (Some(3), Some(11))
    );
    let fuzzy = fuzzy::fuzzy_search(&to_reanchor_lines("😀 food"), "foo", 0.1, None, None);
    let substring = fuzzy.iter().find(|c| c.text == "foo").unwrap();
    assert_eq!((substring.start_column, substring.end_column), (3, 6));
    let whole = fuzzy.iter().find(|c| c.text == "😀 food").unwrap();
    assert_eq!(whole.end_column, 7);
    let source = to_reanchor_lines("# Heading\n😀 foo");
    let target = to_reanchor_lines("# Heading\nnew context\n😀 foo");
    let c = Comment {
        line: Some(2),
        end_column: Some(6),
        selected_text: Some("foo".into()),
        ..c
    };
    let resolved =
        resolve_context_anchor(&c, &create_anchor_context_index(&source, &target)).unwrap();
    assert_eq!(
        (resolved.line, resolved.start_column, resolved.end_column),
        (Some(3), Some(3), Some(6))
    );
}
