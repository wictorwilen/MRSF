//! In-memory comment lifecycle operations. These helpers do not write files:
//! callers can inspect a complete transaction before persisting it.
use crate::{
    compute_hash, text::at_comment, validation::ensure_valid, AddCommentOptions, Comment,
    CommentFilter, CommentSummary, Error, Extensions, MrsfDocument, RemoveCommentOptions, Result,
};
use std::collections::{BTreeMap, HashSet};

/// Validate explicitly authored extensions. Parsers retain *all* unknown fields;
/// newly authored tool extensions must use the reserved `x_` namespace.
pub fn normalize_comment_extensions(extensions: Extensions) -> Result<Extensions> {
    if let Some(key) = extensions.keys().find(|k| !k.starts_with("x_")) {
        return Err(Error::Invalid(format!(
            "extension key '{key}' must start with x_"
        )));
    }
    Ok(extensions)
}

/// Add a validated comment, generating a UUID and UTC timestamp when omitted.
/// A validation failure does not mutate the document.
pub fn add_comment(doc: &mut MrsfDocument, options: AddCommentOptions) -> Result<&Comment> {
    let c = Comment {
        id: options
            .id
            .unwrap_or_else(|| uuid::Uuid::new_v4().to_string()),
        author: options.author,
        timestamp: options
            .timestamp
            .unwrap_or_else(|| chrono::Utc::now().to_rfc3339()),
        text: options.text,
        resolved: false,
        line: options.line,
        end_line: options.end_line,
        start_column: options.start_column,
        end_column: options.end_column,
        selected_text_hash: options.selected_text.as_deref().map(compute_hash),
        selected_text: options.selected_text,
        commit: options.commit,
        r#type: options.r#type,
        severity: options.severity,
        reply_to: options.reply_to,
        extra: normalize_comment_extensions(options.extensions)?,
        ..Default::default()
    };
    // Validate a prospective document before changing the caller's owned value.
    let mut prospective = doc.clone();
    prospective.comments.push(c);
    ensure_valid(&prospective)?;
    *doc = prospective;
    Ok(doc.comments.last().expect("just inserted a comment"))
}

/// Capture an original selection using the same 1-based line convention as the
/// reanchor APIs. Existing selections are deliberately not overwritten.
pub fn populate_selected_text(comment: &mut Comment, lines: &[String]) -> Result<()> {
    if comment.selected_text.is_some() || comment.line.is_none() {
        return Ok(());
    }
    let text = at_comment(lines, comment).ok_or_else(|| {
        Error::Invalid("anchor is out of bounds or splits a surrogate pair".into())
    })?;
    if text.chars().count() > 4096 {
        return Err(Error::Invalid(
            "selected_text exceeds 4096 characters".into(),
        ));
    }
    comment.selected_text_hash = Some(compute_hash(&text));
    comment.selected_text = Some(text);
    Ok(())
}

/// Resolve one comment only. Replies remain independently open (§9).
pub fn resolve_comment(doc: &mut MrsfDocument, id: &str) -> bool {
    set_resolved(doc, id, true)
}

pub fn unresolve_comment(doc: &mut MrsfDocument, id: &str) -> bool {
    set_resolved(doc, id, false)
}

fn set_resolved(doc: &mut MrsfDocument, id: &str, resolved: bool) -> bool {
    if let Some(c) = doc.comments.iter_mut().find(|c| c.id == id) {
        c.resolved = resolved;
        true
    } else {
        false
    }
}

fn descendants(doc: &MrsfDocument, id: &str) -> HashSet<String> {
    let mut ids = HashSet::from([id.to_owned()]);
    loop {
        let before = ids.len();
        for c in &doc.comments {
            if c.reply_to.as_ref().is_some_and(|p| ids.contains(p)) {
                ids.insert(c.id.clone());
            }
        }
        if ids.len() == before {
            return ids;
        }
    }
}

/// Explicit opt-in cascading resolution, bounded even for cyclic input.
pub fn resolve_thread(doc: &mut MrsfDocument, id: &str, resolved: bool) -> usize {
    let ids = descendants(doc, id);
    let mut changed = 0;
    for c in &mut doc.comments {
        if ids.contains(&c.id) && c.resolved != resolved {
            c.resolved = resolved;
            changed += 1;
        }
    }
    changed
}

/// Delete a comment and promote its direct replies per §9.1. A reply with any
/// targeting of its own keeps that targeting as a unit: mixing a parent line
/// with a reply's columns would create a range that neither author selected.
pub fn remove_comment(doc: &mut MrsfDocument, id: &str, options: RemoveCommentOptions) -> bool {
    let Some(parent) = doc.comments.iter().find(|c| c.id == id).cloned() else {
        return false;
    };
    if options.cascade {
        let ids = descendants(doc, id);
        doc.comments.retain(|c| !ids.contains(&c.id));
        return true;
    }
    for c in &mut doc.comments {
        if c.reply_to.as_deref() != Some(id) {
            continue;
        }
        if c.line.is_none()
            && c.end_line.is_none()
            && c.start_column.is_none()
            && c.end_column.is_none()
            && c.selected_text.is_none()
        {
            c.line = parent.line;
            c.end_line = parent.end_line;
            c.start_column = parent.start_column;
            c.end_column = parent.end_column;
            c.selected_text.clone_from(&parent.selected_text);
            c.selected_text_hash.clone_from(&parent.selected_text_hash);
            c.anchored_text.clone_from(&parent.anchored_text);
            if c.commit.is_none() {
                c.commit.clone_from(&parent.commit);
            }
        }
        c.reply_to.clone_from(&parent.reply_to);
    }
    doc.comments.retain(|c| c.id != id);
    true
}

/// Borrow matching comments without copying their text or extension objects.
/// The returned references cannot outlive the input slice.
pub fn filter_comments<'a>(comments: &'a [Comment], f: &CommentFilter) -> Vec<&'a Comment> {
    comments
        .iter()
        .filter(|c| {
            f.open.is_none_or(|open| open != c.resolved)
                && f.resolved.is_none_or(|r| r == c.resolved)
                && f.orphaned.is_none_or(|o| {
                    o == (c
                        .extra
                        .get("x_reanchor_status")
                        .and_then(serde_json::Value::as_str)
                        == Some("orphaned"))
                })
                && f.author.as_ref().is_none_or(|a| a == &c.author)
                && f.r#type
                    .as_ref()
                    .is_none_or(|t| c.r#type.as_ref() == Some(t))
                && f.severity
                    .as_ref()
                    .is_none_or(|s| c.severity.as_ref() == Some(s))
        })
        .collect()
}

/// Group threads by root id. The root appears first (including forward
/// references), followed by replies in their original input order.
/// Dangling parents and cycles are retained rather than causing recursion.
pub fn get_threads(comments: &[Comment]) -> BTreeMap<String, Vec<&Comment>> {
    let mut threads: BTreeMap<String, Vec<&Comment>> = BTreeMap::new();
    for c in comments {
        let mut current = c;
        let mut visited = HashSet::new();
        let mut cycle = false;
        while let Some(parent) = current.reply_to.as_deref() {
            if !visited.insert(current.id.as_str()) {
                cycle = true;
                break;
            }
            let Some(found) = comments.iter().find(|c| c.id == parent) else {
                break;
            };
            current = found;
        }
        // All members of a cycle choose the same deterministic representative.
        let root = if cycle {
            visited.into_iter().min().unwrap_or(&current.id)
        } else {
            &current.id
        };
        threads.entry(root.to_owned()).or_default().push(c);
    }
    for (root, comments) in &mut threads {
        if let Some(position) = comments.iter().position(|c| &c.id == root) {
            let parent = comments.remove(position);
            comments.insert(0, parent);
        }
    }
    threads
}

pub fn summarize(comments: &[Comment]) -> CommentSummary {
    let mut s = CommentSummary {
        total: comments.len(),
        threads: get_threads(comments).len(),
        ..Default::default()
    };
    for c in comments {
        if c.resolved {
            s.resolved += 1;
        } else {
            s.open += 1;
        }
        if c.extra
            .get("x_reanchor_status")
            .and_then(serde_json::Value::as_str)
            == Some("orphaned")
        {
            s.orphaned += 1;
        }
        if let Some(t) = &c.r#type {
            *s.by_type.entry(t.clone()).or_default() += 1;
        }
        if let Some(t) = &c.severity {
            *s.by_severity.entry(t.clone()).or_default() += 1;
        }
    }
    s
}
