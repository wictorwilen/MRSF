//! Real repositories exercise native Git evidence without touching the parent
//! checkout or relying on global user identity/configuration.
mod support;
use mrsf::{git::*, *};
use std::{fs, path::Path, process::Command};
use support::*;

fn git(root: &Path, args: &[&str]) -> String {
    let output = Command::new("git")
        .current_dir(root)
        .args(args)
        .output()
        .unwrap();
    assert!(
        output.status.success(),
        "git {:?}: {}",
        args,
        String::from_utf8_lossy(&output.stderr)
    );
    String::from_utf8(output.stdout).unwrap().trim().into()
}

fn repo() -> TestDir {
    let dir = TestDir::new();
    git(&dir.0, &["init", "--quiet"]);
    git(&dir.0, &["config", "user.name", "MRSF tests"]);
    git(&dir.0, &["config", "user.email", "tests@example.invalid"]);
    git(&dir.0, &["config", "core.autocrlf", "false"]);
    dir
}

#[test]
fn missing_git_is_graceful_but_invalid_revision_is_explicit() {
    let dir = TestDir::new();
    let absent = Git::new(dir.path("git-does-not-exist").into_os_string());
    assert!(!absent.available().unwrap());
    assert_eq!(absent.find_repo_root(&dir.0).unwrap(), None);
    assert_eq!(absent.current_commit(&dir.0).unwrap(), None);
    assert_eq!(
        absent.file_at_commit("HEAD", "guide.md", &dir.0).unwrap(),
        None
    );
    assert!(matches!(
        absent.find_repo_root(dir.path("missing-directory")),
        Err(Error::Io(_))
    ));
    if !is_git_available() {
        return;
    }
    // Scratch data lives inside the checkout, so Git may legitimately discover
    // the containing repository here. No global PATH/environment mutation is
    // needed to simulate the missing executable above.
    assert!(Git::default().find_repo_root(&dir.0).is_ok());
    let root = repo();
    assert!(Git::default().resolve_commit("--help", &root.0).is_err());
    assert!(Git::default().current_commit(&root.0).is_err());
}

#[test]
fn unified_diff_insertion_deletion_and_modified_lines() {
    let hunks =
        parse_diff_hunks("@@ -1,0 +2,2 @@\n+new1\n+new2\n@@ -5,2 +7 @@\n-old1\n-old2\n+new\n");
    assert_eq!(hunks.len(), 2);
    assert_eq!(get_line_shift(&hunks, 1), (0, false));
    assert_eq!(get_line_shift(&hunks, 2), (2, false));
    assert_eq!(get_line_shift(&hunks, 5), (2, true));
    assert_eq!(get_line_shift(&hunks, 7), (1, false));
    assert_eq!(parse_diff_hunks("@@ -2 +2 @@\n-a\n+b\n")[0].old_count, 1);
}

#[test]
fn line_only_capture_never_makes_a_valid_sidecar_exceed_text_limits() {
    // Schema maxLength counts Unicode characters, not UTF-8 bytes or MRSF's
    // UTF-16 column units. Both boundary values must remain representable.
    for text in ["a".repeat(4096), "😀".repeat(4096)] {
        let mut doc = document();
        doc.comments[0].line = Some(1);
        let result = reanchor_comment(&doc.comments[0], &to_reanchor_lines(&text));
        assert_eq!(result.status, ReanchorStatus::Anchored);
        assert_eq!(result.anchored_text.as_deref(), Some(text.as_str()));
        apply_reanchor_results(&mut doc, &[result], &ReanchorOptions::default(), None);
        assert!(validate(&doc).valid);
    }

    let text = "a".repeat(4097);
    let source = to_reanchor_lines(&text);
    let target = to_reanchor_lines(&format!("inserted\n{text}"));
    let mut doc = document();
    doc.comments[0].line = Some(1);
    assert!(validate(&doc).valid);

    let current = reanchor_comment(&doc.comments[0], &source);
    assert_eq!(current.status, ReanchorStatus::Ambiguous);
    apply_reanchor_results(&mut doc, &[current], &ReanchorOptions::default(), None);
    assert!(validate(&doc).valid);
    assert!(doc.comments[0].anchored_text.is_none());

    let hunks = parse_diff_hunks("@@ -0,0 +1 @@\n+inserted\n");
    let projection = create_revision_projection(&source, &target);
    let shifted = reanchor_comment_with_evidence(
        &doc.comments[0],
        &target,
        &ReanchorOptions::default(),
        AnchorEvidence {
            diff_hunks: Some(&hunks),
            revision_projection: Some(&projection),
            ..Default::default()
        },
    );
    assert_eq!(shifted.status, ReanchorStatus::Ambiguous);
    apply_reanchor_results(&mut doc, &[shifted], &ReanchorOptions::default(), None);
    assert!(validate(&doc).valid);
    assert_eq!(doc.comments[0].line, Some(1));
}

#[test]
fn native_git_reads_commits_and_working_tree_diff() {
    if !is_git_available() {
        return;
    }
    let dir = repo();
    fs::write(
        dir.path("guide.md"),
        "intro\nbefore\nselected\nfollowing\nend\n",
    )
    .unwrap();
    git(&dir.0, &["add", "--", "guide.md"]);
    git(&dir.0, &["commit", "--quiet", "-m", "source"]);
    let engine = Git::default();
    let head = engine.current_commit(&dir.0).unwrap().unwrap();
    assert_eq!(head.len(), 40);
    assert_eq!(
        engine
            .resolve_commit(&head[..8], &dir.0)
            .unwrap()
            .as_deref(),
        Some(head.as_str())
    );
    assert_eq!(
        engine.user_name(&dir.0).unwrap().as_deref(),
        Some("MRSF tests")
    );
    assert_eq!(
        engine
            .file_at_commit(&head, "guide.md", &dir.0)
            .unwrap()
            .as_deref(),
        Some("intro\nbefore\nselected\nfollowing\nend\n")
    );
    fs::write(
        dir.path("guide.md"),
        "new1\nnew2\nintro\nbefore\nselected\nfollowing\nend\n",
    )
    .unwrap();
    let hunks = engine
        .diff(&head, None, "guide.md", &dir.0)
        .unwrap()
        .unwrap();
    assert_eq!(get_line_shift(&hunks, 3), (2, false));
    let mut doc = document();
    doc.comments[0].line = Some(3);
    doc.comments[0].selected_text = Some("selected".into());
    doc.comments[0].commit = Some(head[..8].into());
    let lines = read_document_lines(dir.path("guide.md")).unwrap();
    let result = reanchor_document_at_path(
        &doc,
        &lines,
        dir.path("guide.md"),
        &ReanchorOptions::default(),
    )
    .unwrap();
    assert_eq!(result[0].status, ReanchorStatus::Shifted);
    assert_eq!(result[0].new_line, Some(5));
    // Neither pure operation nor Git-aware orchestration mutates the input.
    assert_eq!(doc.comments[0].line, Some(3));
    doc.comments[0].commit = Some("does-not-exist".into());
    assert!(reanchor_document_at_path(
        &doc,
        &lines,
        dir.path("guide.md"),
        &ReanchorOptions::default()
    )
    .is_err());
    git(&dir.0, &["add", "--", "guide.md"]);
    assert_eq!(
        engine.staged_files(&dir.0).unwrap().unwrap(),
        vec![std::path::PathBuf::from("guide.md")]
    );
    assert!(engine.file_at_commit(&head, "../outside", &dir.0).is_err());
}

#[test]
fn reanchor_file_uses_authoritative_document_field_and_dry_run() {
    if !is_git_available() {
        return;
    }
    let dir = repo();
    fs::create_dir(dir.path("docs")).unwrap();
    fs::write(dir.path(".mrsf.yaml"), "sidecar_root: .reviews\n").unwrap();
    fs::write(dir.path("docs/guide.md"), "intro\nselected\nfollowing\n").unwrap();
    git(&dir.0, &["add", "--", "docs/guide.md"]);
    git(&dir.0, &["commit", "--quiet", "-m", "source"]);
    let commit = get_current_commit(&dir.0).unwrap().unwrap();
    let mut doc = document();
    doc.document = "docs/guide.md".into();
    doc.comments[0].line = Some(2);
    doc.comments[0].selected_text = Some("selected".into());
    doc.comments[0].selected_text_hash = Some(compute_hash("selected"));
    doc.comments[0].commit = Some(commit);
    let sidecar = discover_sidecar("docs/guide.md", &dir.0).unwrap();
    write_sidecar(&sidecar, &doc).unwrap();
    let original = fs::read_to_string(&sidecar).unwrap();
    fs::write(
        dir.path("docs/guide.md"),
        "inserted\nintro\nselected\nfollowing\n",
    )
    .unwrap();
    let dry = reanchor_file(
        &sidecar,
        &ReanchorOptions {
            dry_run: true,
            ..Default::default()
        },
    )
    .unwrap();
    assert_eq!(dry.results[0].new_line, Some(3));
    assert!(!dry.written);
    assert_eq!(fs::read_to_string(&sidecar).unwrap(), original);
    let result = reanchor_file(&sidecar, &ReanchorOptions::default()).unwrap();
    assert!(result.written);
    assert_eq!(result.changed, 1);
    let updated = parse_sidecar(&sidecar).unwrap();
    assert_eq!(updated.comments[0].line, Some(3));
    assert_eq!(
        updated.comments[0].selected_text.as_deref(),
        Some("selected")
    );
}

#[test]
fn selected_text_hash_only_changes_on_opt_in_and_orphans_are_retained() {
    let mut doc = document();
    doc.comments[0].line = Some(1);
    doc.comments[0].selected_text = Some("original selected text".into());
    doc.comments[0].selected_text_hash = Some(compute_hash("original selected text"));
    let result = ReanchorResult {
        comment_id: "root".into(),
        status: ReanchorStatus::Fuzzy,
        score: 0.9,
        new_line: Some(1),
        new_end_line: Some(1),
        new_start_column: None,
        new_end_column: None,
        reason: "test".into(),
        anchored_text: Some("modified selected text".into()),
        previous_selected_text: Some("original selected text".into()),
    };
    apply_reanchor_results(
        &mut doc,
        std::slice::from_ref(&result),
        &ReanchorOptions::default(),
        None,
    );
    assert_eq!(
        doc.comments[0].selected_text.as_deref(),
        Some("original selected text")
    );
    assert_eq!(
        doc.comments[0].selected_text_hash.as_deref(),
        Some(compute_hash("original selected text").as_str())
    );
    assert_eq!(
        doc.comments[0].anchored_text.as_deref(),
        Some("modified selected text")
    );
    apply_reanchor_results(
        &mut doc,
        &[result],
        &ReanchorOptions {
            update_text: true,
            ..Default::default()
        },
        None,
    );
    assert_eq!(
        doc.comments[0].selected_text.as_deref(),
        Some("modified selected text")
    );
    assert_eq!(
        doc.comments[0].selected_text_hash.as_deref(),
        Some(compute_hash("modified selected text").as_str())
    );
    assert_eq!(doc.comments[0].anchored_text, None);
    doc.comments[0].line = Some(999);
    let orphan = reanchor_comment(&doc.comments[0], &to_reanchor_lines("unrelated"));
    assert_eq!(orphan.status, ReanchorStatus::Orphaned);
    assert_eq!(
        apply_reanchor_results(&mut doc, &[orphan], &ReanchorOptions::default(), None),
        1
    );
    assert_eq!(doc.comments.len(), 1);
    assert_eq!(doc.comments[0].extra["x_reanchor_status"], "orphaned");
}

#[test]
fn source_verification_proximity_guard_and_ambiguous_occurrences() {
    let mut c = comment("root");
    c.selected_text = Some("same text".into());
    let lines = to_reanchor_lines("same text\nother\nsame text");
    assert_eq!(
        reanchor_comment(&c, &lines).status,
        ReanchorStatus::Ambiguous
    );
    c.line = Some(3);
    assert_eq!(reanchor_comment(&c, &lines).new_line, Some(3));
    c.line = Some(1);
    let target = to_reanchor_lines("changed\n1\n2\n3\n4\n5\n6\nsame text");
    let r = reanchor_comment(&c, &target);
    assert_eq!(r.status, ReanchorStatus::Fuzzy);
    assert_eq!(r.new_line, Some(1));
    assert_eq!(r.anchored_text.as_deref(), Some("changed"));
    let bad_source = to_reanchor_lines("wrong source\n1\n2");
    let projection = create_revision_projection(&bad_source, &target);
    assert!(project_comment_anchor(&c, &projection, 0.6).is_none());
}

#[test]
fn line_only_git_displacement_is_idempotent_with_force_and_source_overrides() {
    if !is_git_available() {
        return;
    }
    for force in [false, true] {
        for override_source in [false, true] {
            let dir = repo();
            let source = "intro\nbefore\nselected\nfollowing\nend\n";
            let target = format!("new1\nnew2\n{source}");
            fs::write(dir.path("guide.md"), source).unwrap();
            git(&dir.0, &["add", "--", "guide.md"]);
            git(&dir.0, &["commit", "--quiet", "-m", "source"]);
            let source_commit = get_current_commit(&dir.0).unwrap().unwrap();
            let mut doc = document();
            doc.comments[0].line = Some(3);
            doc.comments[0].commit = Some(source_commit.clone());
            let sidecar = dir.path("guide.md.review.yaml");
            write_sidecar(&sidecar, &doc).unwrap();
            fs::write(dir.path("guide.md"), &target).unwrap();
            let options = ReanchorOptions {
                force,
                from_commit: override_source.then_some(source_commit.clone()),
                ..Default::default()
            };
            let first = reanchor_file(&sidecar, &options).unwrap();
            assert_eq!(first.results[0].status, ReanchorStatus::Shifted);
            assert_eq!(first.results[0].new_line, Some(5));
            assert_eq!(first.changed, 1);
            let applied = parse_sidecar(&sidecar).unwrap();
            assert_eq!(applied.comments[0].selected_text, None);
            assert_eq!(applied.comments[0].selected_text_hash, None);
            assert_eq!(
                applied.comments[0].anchored_text.as_deref(),
                Some("selected")
            );
            assert_eq!(applied.comments[0].commit.as_ref(), Some(&source_commit));

            // HEAD still names the source, not the uncommitted target. Even
            // force must not make another source->target displacement valid.
            let bytes = fs::read(&sidecar).unwrap();
            let repeated = reanchor_file(&sidecar, &options).unwrap();
            assert_eq!(repeated.results[0].new_line, Some(5));
            assert_eq!(repeated.changed, 0);
            assert!(!repeated.written);
            assert_eq!(fs::read(&sidecar).unwrap(), bytes);

            // Committing that target and editing again exercises a genuinely
            // different HEAD and displacement, not just repeated same-HEAD work.
            git(&dir.0, &["add", "--", "guide.md"]);
            git(&dir.0, &["commit", "--quiet", "-m", "target"]);
            fs::write(dir.path("guide.md"), format!("another\n{target}")).unwrap();
            let moved = reanchor_file(&sidecar, &options).unwrap();
            assert_eq!(moved.results[0].new_line, Some(6));
            assert_eq!(moved.results[0].status, ReanchorStatus::Fuzzy);
            assert_eq!(moved.results[0].score, 0.5);
            let repeated = reanchor_file(&sidecar, &options).unwrap();
            assert_eq!(repeated.results[0].new_line, Some(6));
            assert_eq!(repeated.results[0].status, ReanchorStatus::Fuzzy);
            assert_eq!(repeated.changed, 0);
            assert!(!repeated.written);
            let final_doc = parse_sidecar(&sidecar).unwrap();
            assert_eq!(final_doc.comments[0].selected_text, None);
            assert_eq!(final_doc.comments[0].commit.as_ref(), Some(&source_commit));
        }
    }
}

#[test]
fn line_only_diff_rejects_modified_spans_and_retains_empty_capture() {
    let options = ReanchorOptions::default();
    let mut doc = document();
    doc.comments[0].line = Some(2);
    doc.comments[0].end_line = Some(4);
    let source = to_reanchor_lines("intro\nbefore\nselected\nfollowing\nend");
    let target = to_reanchor_lines("intro\nbefore\nedited\nfollowing\nend");
    let pure = reanchor_document_with_source(&doc, &source, &target, &options);
    assert_eq!(pure[0].status, ReanchorStatus::Ambiguous);
    assert_eq!(pure[0].new_line, None);
    assert_eq!(pure[0].anchored_text, None);
    for hunks in [
        parse_diff_hunks("@@ -3 +3 @@\n-selected\n+edited\n"),
        parse_diff_hunks("@@ -2,0 +3 @@\n+inserted\n"),
    ] {
        let result = reanchor_comment_with_evidence(
            &doc.comments[0],
            &target,
            &options,
            AnchorEvidence {
                diff_hunks: Some(&hunks),
                ..Default::default()
            },
        );
        assert_eq!(result.status, ReanchorStatus::Ambiguous);
        assert_eq!(result.new_line, None);
        assert_eq!(result.anchored_text, None);
    }

    doc.comments[0].line = Some(3);
    doc.comments[0].end_line = None;
    let target = to_reanchor_lines("new1\nnew2\nintro\nbefore\n\nfollowing\nend");
    let hunks = parse_diff_hunks("@@ -0,0 +1,2 @@\n+new1\n+new2\n");
    let result = reanchor_comment_with_evidence(
        &doc.comments[0],
        &target,
        &options,
        AnchorEvidence {
            diff_hunks: Some(&hunks),
            ..Default::default()
        },
    );
    assert_eq!(result.new_line, Some(5));
    assert_eq!(result.anchored_text.as_deref(), Some(""));
    assert_eq!(
        apply_reanchor_results(&mut doc, &[result], &options, None),
        1
    );
    let repeated = reanchor_comment_with_evidence(
        &doc.comments[0],
        &target,
        &options,
        AnchorEvidence {
            diff_hunks: Some(&hunks),
            ..Default::default()
        },
    );
    assert_eq!(repeated.new_line, Some(5));
    assert_eq!(
        apply_reanchor_results(&mut doc, &[repeated], &options, None),
        0
    );
    let changed = reanchor_comment(&doc.comments[0], &to_reanchor_lines("a\nb\nc\nd\nchanged"));
    assert_eq!(changed.status, ReanchorStatus::Ambiguous);

    // The guard uses an already-modeled string, not an unchecked extension
    // object. A malformed capture is rejected by normal strict validation.
    let mut raw = serde_json::to_value(&doc).unwrap();
    raw["comments"][0]["anchored_text"] = serde_json::json!({"not": "a string"});
    assert!(matches!(
        parse_sidecar_content(&raw.to_string(), Format::Json),
        Err(Error::Validation(_))
    ));

    // Removing all targeting deliberately makes this a document-level comment;
    // a stale text capture must not reattach it to an arbitrary inline match.
    let c = &mut doc.comments[0];
    c.line = None;
    c.anchored_text = Some("selected".into());
    let document_level = reanchor_comment(c, &to_reanchor_lines("selected"));
    assert_eq!(document_level.status, ReanchorStatus::Anchored);
    assert_eq!(document_level.new_line, None);
}

#[test]
fn line_only_force_without_source_revision_does_not_invent_source_coordinates() {
    if !is_git_available() {
        return;
    }
    let dir = repo();
    let source = "intro\nbefore\nselected\nfollowing\nend\n";
    fs::write(dir.path("guide.md"), source).unwrap();
    git(&dir.0, &["add", "--", "guide.md"]);
    git(&dir.0, &["commit", "--quiet", "-m", "source"]);
    let head = get_current_commit(&dir.0).unwrap().unwrap();
    fs::write(dir.path("guide.md"), format!("new1\nnew2\n{source}")).unwrap();
    let mut doc = document();
    doc.comments[0].line = Some(3);
    let sidecar = dir.path("guide.md.review.yaml");
    write_sidecar(&sidecar, &doc).unwrap();
    let mut options = ReanchorOptions {
        force: true,
        ..Default::default()
    };
    // With no source revision this is explicitly a current positional anchor:
    // current line three is "intro", not source line three ("selected").
    let first = reanchor_file(&sidecar, &options).unwrap();
    assert_eq!(first.results[0].new_line, Some(3));
    let applied = parse_sidecar(&sidecar).unwrap();
    assert_eq!(applied.comments[0].anchored_text.as_deref(), Some("intro"));
    assert_eq!(applied.comments[0].commit.as_ref(), Some(&head));
    for source_override in [None, Some(head)] {
        options.from_commit = source_override;
        let next = reanchor_file(&sidecar, &options).unwrap();
        assert_eq!(next.results[0].new_line, Some(3));
        assert_eq!(next.changed, 0);
        assert!(!next.written);
    }
}

#[test]
fn same_line_exact_normalized_and_fuzzy_matches_respect_utf16_columns() {
    let mut c = comment("root");
    c.line = Some(1);
    c.end_line = Some(1);
    c.selected_text = Some("foo".into());
    for (text, start, end) in [("foo foo", 4, 7), ("😀 foo foo", 7, 10)] {
        c.start_column = Some(start);
        c.end_column = Some(end);
        let result = reanchor_comment(&c, &to_reanchor_lines(text));
        assert_eq!(result.status, ReanchorStatus::Anchored);
        assert_eq!(result.new_start_column, Some(start));
        assert_eq!(result.new_end_column, Some(end));
    }

    c.selected_text = Some("foo bar".into());
    c.start_column = Some(11);
    c.end_column = Some(18);
    let result = reanchor_comment(&c, &to_reanchor_lines("😀 foo\tbar foo\tbar"));
    assert_eq!(result.status, ReanchorStatus::Fuzzy);
    assert_eq!(result.new_start_column, Some(11));
    assert_eq!(result.new_end_column, Some(18));
    assert_eq!(result.anchored_text.as_deref(), Some("foo\tbar"));

    c.selected_text = Some("one two three fourX".into());
    let text = "😀 one two three fourY one two three fourY";
    let start = utf16_length("😀 one two three fourY ");
    let end = start + utf16_length("one two three fourY");
    c.start_column = Some(start);
    c.end_column = Some(end);
    let result = reanchor_comment(&c, &to_reanchor_lines(text));
    assert_eq!(result.status, ReanchorStatus::Fuzzy);
    assert_eq!(result.new_start_column, Some(start));
    assert_eq!(result.new_end_column, Some(end));
}

#[test]
fn unrelated_existing_line_is_not_high_confidence_identity_evidence() {
    let mut c = comment("root");
    c.line = Some(1);
    c.selected_text = Some("apples".into());
    let unrelated = reanchor_comment(&c, &to_reanchor_lines("ZZZZZZ"));
    assert_eq!(unrelated.status, ReanchorStatus::Orphaned);
    assert_eq!(unrelated.score, 0.0);
    assert_eq!(unrelated.anchored_text, None);
    c.selected_text = Some("apples are sweet".into());
    let plausible = reanchor_comment(&c, &to_reanchor_lines("apples are tasty"));
    assert_eq!(plausible.status, ReanchorStatus::Fuzzy);
    assert!(plausible.anchored_text.is_some());
}

#[test]
fn recovered_orphan_metadata_is_written_once_without_coordinate_changes() {
    let dir = TestDir::new();
    fs::write(dir.path(".mrsf.yaml"), "{}\n").unwrap();
    fs::write(dir.path("guide.md"), "hello\n").unwrap();
    let mut doc = document();
    let c = &mut doc.comments[0];
    c.line = Some(1);
    c.end_line = Some(1);
    c.start_column = Some(0);
    c.end_column = Some(5);
    c.selected_text = Some("hello".into());
    c.selected_text_hash = Some(compute_hash("hello"));
    c.extra
        .insert("x_reanchor_status".into(), serde_json::json!("orphaned"));
    c.extra
        .insert("x_reanchor_score".into(), serde_json::json!(0.0));
    let sidecar = dir.path("guide.md.review.yaml");
    write_sidecar(&sidecar, &doc).unwrap();
    let options = ReanchorOptions {
        no_git: true,
        ..Default::default()
    };
    let first = reanchor_file(&sidecar, &options).unwrap();
    assert_eq!(first.results[0].status, ReanchorStatus::Anchored);
    assert_eq!(first.changed, 1);
    assert!(first.written);
    let recovered = parse_sidecar(&sidecar).unwrap();
    assert_eq!(recovered.comments[0].line, Some(1));
    assert_eq!(recovered.comments[0].start_column, Some(0));
    assert_eq!(recovered.comments[0].end_column, Some(5));
    assert_eq!(recovered.comments[0].extra["x_reanchor_status"], "anchored");
    assert_eq!(summarize(&recovered.comments).orphaned, 0);
    assert!(filter_comments(
        &recovered.comments,
        &CommentFilter {
            orphaned: Some(true),
            ..Default::default()
        }
    )
    .is_empty());
    let bytes = fs::read(&sidecar).unwrap();
    let second = reanchor_file(&sidecar, &options).unwrap();
    assert_eq!(second.changed, 0);
    assert!(!second.written);
    assert_eq!(fs::read(&sidecar).unwrap(), bytes);
}
