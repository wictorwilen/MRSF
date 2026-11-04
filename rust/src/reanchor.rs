//! Anchor Mesh orchestration: verified Git shifts, source-verified projection,
//! Markdown context, confidence calibration, bounded fuzzy fallback, and group
//! reconciliation. Pure text APIs do not touch the filesystem or spawn Git.
use crate::{
    calibration::{calibrate_anchor_evidence, empty_result},
    context::{create_anchor_context_index, resolve_context_anchor, AnchorContextIndex},
    fuzzy::{
        create_fuzzy_search_index, exact_match, fuzzy_search, fuzzy_search_thresholds,
        normalized_match, FuzzySearchIndex,
    },
    git::{get_line_shift, Git},
    reconciliation::reconcile_comment_anchors,
    revision::{create_revision_projection, project_comment_anchor, RevisionProjectionIndex},
    text::at_comment,
    Comment, DiffHunk, FuzzyCandidate, MrsfDocument, ReanchorOptions, ReanchorResult,
    ReanchorStatus, Result,
};
use std::{collections::BTreeMap, path::Path};

// A line-only range can span arbitrarily much Markdown, but its captured audit
// text still has the schema's 4096-character limit. Abstain instead of deriving
// an invalid sidecar or truncating the evidence used to verify a later run.
const MAX_CAPTURE_CHARACTERS: usize = 4096;

/// Borrowed shared evidence. `'a` means these references remain valid for the
/// duration of the call; no source text or indexes are copied per comment.
#[derive(Clone, Copy, Debug, Default)]
pub struct AnchorEvidence<'a> {
    pub diff_hunks: Option<&'a [DiffHunk]>,
    pub revision_projection: Option<&'a RevisionProjectionIndex>,
    pub anchor_context: Option<&'a AnchorContextIndex>,
    pub fuzzy_index: Option<&'a FuzzySearchIndex>,
    pub commit_is_stale: bool,
}

fn candidate_result(
    c: &Comment,
    candidate: &FuzzyCandidate,
    fuzzy: bool,
    reason: &str,
) -> ReanchorResult {
    ReanchorResult {
        new_line: Some(candidate.line),
        new_end_line: Some(candidate.end_line),
        new_start_column: Some(candidate.start_column),
        new_end_column: Some(candidate.end_column),
        anchored_text: fuzzy.then(|| candidate.text.clone()),
        previous_selected_text: if fuzzy { c.selected_text.clone() } else { None },
        ..empty_result(
            &c.id,
            if fuzzy {
                ReanchorStatus::Fuzzy
            } else {
                ReanchorStatus::Anchored
            },
            candidate.score,
            reason,
        )
    }
}

// Lines alone cannot distinguish two occurrences on the same line. Both stored
// and candidate columns are already UTF-16 offsets: comparing them directly
// avoids accidentally introducing UTF-8 byte distances for emoji/CJK text.
fn position_distance(c: &Comment, candidate: &FuzzyCandidate) -> (usize, usize, usize, usize) {
    (
        candidate.line.abs_diff(c.line.unwrap_or(1)),
        candidate
            .start_column
            .abs_diff(c.start_column.unwrap_or(candidate.start_column)),
        candidate
            .end_line
            .abs_diff(c.end_line.unwrap_or(candidate.end_line)),
        candidate
            .end_column
            .abs_diff(c.end_column.unwrap_or(candidate.end_column)),
    )
}

/// Reanchor a single comment using current text only and default thresholds.
pub fn reanchor_comment(comment: &Comment, lines: &[String]) -> ReanchorResult {
    reanchor_comment_with_evidence(
        comment,
        lines,
        &ReanchorOptions::default(),
        AnchorEvidence::default(),
    )
}

pub fn reanchor_comment_with_options(
    comment: &Comment,
    lines: &[String],
    options: &ReanchorOptions,
) -> ReanchorResult {
    reanchor_comment_with_evidence(comment, lines, options, AnchorEvidence::default())
}

/// Run the complete single-comment pipeline. `lines` uses the 1-based layout
/// returned by `to_reanchor_lines`. Results do not mutate the source comment.
pub fn reanchor_comment_with_evidence(
    c: &Comment,
    lines: &[String],
    options: &ReanchorOptions,
    evidence: AnchorEvidence<'_>,
) -> ReanchorResult {
    let selected = c.selected_text.as_deref().filter(|s| !s.is_empty());
    // A previous line-only relocation captures its actual text in the existing,
    // schema-validated anchored_text field. Its current coordinates no longer
    // necessarily belong to `commit`: force can even stamp HEAD while the
    // working tree still contains uncommitted insertions. Never interpret these
    // coordinates as source-revision coordinates again, including when a caller
    // supplies from_commit. Instead verify the captured range, or use tentative
    // text-only retrieval. This deliberately sacrifices later certain Git shifts
    // rather than manufacturing source-coordinate provenance we do not possess.
    if let Some(captured) = c
        .anchored_text
        .as_deref()
        .filter(|_| selected.is_none() && c.line.is_some())
    {
        if at_comment(lines, c).as_deref() == Some(captured) {
            let tentative =
                c.extra.get("x_reanchor_status").and_then(|v| v.as_str()) == Some("fuzzy");
            return ReanchorResult {
                new_line: c.line,
                new_end_line: c.end_line,
                new_start_column: c.start_column,
                new_end_column: c.end_column,
                anchored_text: Some(captured.into()),
                ..empty_result(
                    &c.id,
                    if tentative {
                        ReanchorStatus::Fuzzy
                    } else {
                        ReanchorStatus::Anchored
                    },
                    if tentative { 0.5 } else { 1.0 },
                    "Previously captured line-only range still verifies.",
                )
            };
        }
        if captured.is_empty() {
            return empty_result(
                &c.id,
                ReanchorStatus::Ambiguous,
                0.0,
                "Captured empty line changed; no defensible textual identity remains.",
            );
        }
        // The temporary owned copy supplies matching evidence only; the original
        // selected_text remains untouched. Clearing source evidence is essential:
        // this copy's coordinates still describe the previously applied target.
        let mut captured_comment = c.clone();
        captured_comment.selected_text = Some(captured.into());
        let mut result = reanchor_comment_with_evidence(
            &captured_comment,
            lines,
            options,
            AnchorEvidence {
                fuzzy_index: evidence.fuzzy_index,
                ..Default::default()
            },
        );
        if matches!(
            result.status,
            ReanchorStatus::Anchored | ReanchorStatus::Shifted | ReanchorStatus::Fuzzy
        ) {
            result.status = ReanchorStatus::Fuzzy;
            // Text identity alone cannot restore the lost source-coordinate
            // basis. Keep this explicit tentative calibration on later no-op
            // passes too, instead of silently promoting an applied guess.
            result.score = 0.5;
            result.anchored_text = result.new_line.and_then(|line| {
                crate::extract_text(
                    lines,
                    line,
                    result.new_end_line,
                    result.new_start_column,
                    result.new_end_column,
                )
            });
            if result
                .anchored_text
                .as_ref()
                .is_some_and(|text| text.chars().count() > MAX_CAPTURE_CHARACTERS)
            {
                return empty_result(
                    &c.id,
                    ReanchorStatus::Ambiguous,
                    0.0,
                    "Line-only range exceeds the capture limit; reviewer retargeting is required.",
                );
            }
        }
        result.previous_selected_text.clone_from(&c.selected_text);
        result.reason = format!("Tentative captured line-only text: {}", result.reason);
        return result;
    }
    if selected.is_none() && c.line.is_none() {
        return empty_result(
            &c.id,
            ReanchorStatus::Anchored,
            1.0,
            "Document-level comment (no anchor needed).",
        );
    }
    // Stage 0: a diff displacement is certain only when the text still verifies
    // at its shifted range. A modified hunk is not an unchanged-line mapping.
    if let (Some(line), Some(hunks)) = (c.line, evidence.diff_hunks.filter(|h| !h.is_empty())) {
        let (shift, modified) = get_line_shift(hunks, line);
        if let Some(new_line) = line
            .checked_add_signed(shift)
            .filter(|n| *n > 0 && *n < lines.len())
        {
            let span = c.end_line.unwrap_or(line).saturating_sub(line);
            let end = new_line.saturating_add(span);
            let text =
                crate::extract_text(lines, new_line, Some(end), c.start_column, c.end_column);
            // A line-only range has no original selection to verify. Its first
            // displacement is defensible only if the *entire* source span is
            // untouched, including insertions inside a multiline range.
            let source_end = c.end_line.unwrap_or(line);
            let span_unchanged = !modified
                && get_line_shift(hunks, source_end) == (shift, false)
                && !hunks.iter().any(|h| {
                    h.old_count > 0
                        && h.old_start <= source_end
                        && h.old_start.saturating_add(h.old_count) > line
                });
            let snapshot_verifies = evidence
                .revision_projection
                .is_none_or(|p| at_comment(&p.source_lines, c) == text);
            if (selected.is_none() && span_unchanged && text.is_some() && snapshot_verifies)
                || (!modified && selected.is_some() && text.as_deref() == selected)
            {
                if selected.is_none()
                    && text
                        .as_ref()
                        .is_some_and(|text| text.chars().count() > MAX_CAPTURE_CHARACTERS)
                {
                    return empty_result(
                        &c.id,
                        ReanchorStatus::Ambiguous,
                        0.0,
                        "Line-only range exceeds the capture limit; reviewer retargeting is required.",
                    );
                }
                return ReanchorResult {
                    new_line: Some(new_line),
                    new_end_line: c.end_line.map(|_| end),
                    anchored_text: selected.is_none().then_some(text).flatten(),
                    ..empty_result(
                        &c.id,
                        if shift == 0 {
                            ReanchorStatus::Anchored
                        } else {
                            ReanchorStatus::Shifted
                        },
                        1.0,
                        "Verified diff displacement.",
                    )
                };
            }
            if selected.is_none() {
                return empty_result(
                    &c.id,
                    ReanchorStatus::Ambiguous,
                    0.0,
                    "Line-only source range was modified or cannot be verified after displacement.",
                );
            }
        }
    }
    // A pure source-snapshot call may not supply Git hunks at all. Without an
    // unchanged-line mapping it cannot turn a changed line-only source range
    // into a certain current positional anchor merely because that line exists.
    if selected.is_none()
        && evidence.revision_projection.is_some_and(|p| {
            let source = at_comment(&p.source_lines, c);
            source.is_none() || source != at_comment(lines, c)
        })
    {
        return empty_result(
            &c.id,
            ReanchorStatus::Ambiguous,
            0.0,
            "Line-only source range changed without a verified displacement.",
        );
    }
    // Stages 1–3: source verification, structural context, and calibration.
    // Exact verified projection short-circuits expensive structural retrieval.
    if let Some(selected) = selected {
        let projected = evidence
            .revision_projection
            .and_then(|p| project_comment_anchor(c, p, options.threshold));
        if projected.as_ref().is_some_and(|p| p.exact) {
            if let Some(calibrated) =
                calibrate_anchor_evidence(&c.id, selected, projected.as_ref(), None)
            {
                return calibrated.result;
            }
        }
        let contextual = evidence
            .anchor_context
            .and_then(|context| resolve_context_anchor(c, context));
        if let Some(calibrated) =
            calibrate_anchor_evidence(&c.id, selected, projected.as_ref(), contextual.as_ref())
        {
            return calibrated.result;
        }
    }
    let mut fuzzy_sets = None;
    if let Some(selected) = selected {
        // Stage 4a: exact occurrences, disambiguated by the complete stored
        // position. Stable iteration resolves otherwise-equal distances.
        let exact = exact_match(lines, selected);
        if exact.len() > 1 && c.line.is_none() {
            return empty_result(
                &c.id,
                ReanchorStatus::Ambiguous,
                1.0,
                "Multiple exact matches without position or source context.",
            );
        }
        let chosen = if exact.len() == 1 {
            exact.first()
        } else {
            c.line.and_then(|_| {
                exact
                    .iter()
                    .min_by_key(|candidate| position_distance(c, candidate))
            })
        };
        if let Some(chosen) = chosen {
            if c.line.is_some_and(|line| {
                line > 0
                    && line < lines.len()
                    && chosen.line.abs_diff(line) > options.proximity_window
            }) && at_comment(lines, c).as_deref() != Some(selected)
            {
                return ReanchorResult { new_line: c.line, new_end_line: c.end_line,
                    new_start_column: c.start_column, new_end_column: c.end_column,
                    anchored_text: at_comment(lines, c), previous_selected_text: c.selected_text.clone(),
                    ..empty_result(&c.id, ReanchorStatus::Fuzzy, 0.5,
                        "Exact match exceeds proximity window while original text changed; kept tentative original range.") };
            }
            return candidate_result(c, chosen, false, "Exact text match.");
        }
        // Stage 4b: whitespace normalization, then high-confidence fuzzy.
        // Window-based normalized retrieval intentionally covers whole lines.
        // Prefer a verifying stored inline range before that broader fallback;
        // otherwise repeated inline phrases could expand or jump leftward.
        if c.start_column.is_some() && c.end_column.is_some() {
            if let Some(current) = at_comment(lines, c) {
                let normalized = |s: &str| s.split_whitespace().collect::<Vec<_>>().join(" ");
                if normalized(&current) == normalized(selected) {
                    return ReanchorResult {
                        new_line: c.line,
                        new_end_line: c.end_line,
                        new_start_column: c.start_column,
                        new_end_column: c.end_column,
                        anchored_text: Some(current),
                        previous_selected_text: c.selected_text.clone(),
                        ..empty_result(
                            &c.id,
                            ReanchorStatus::Fuzzy,
                            0.95,
                            "Stored inline range verifies after whitespace normalization.",
                        )
                    };
                }
            }
        }
        let normalized = normalized_match(lines, selected);
        if normalized.len() == 1 {
            return candidate_result(c, &normalized[0], true, "Normalized whitespace match.");
        }
        let sets = fuzzy_search_thresholds(
            lines,
            selected,
            &[0.8, options.threshold],
            c.line,
            evidence.fuzzy_index,
        );
        let high = &sets[0];
        if !high.is_empty() {
            let best = if high.len() == 1 {
                &high[0]
            } else {
                high.iter()
                    .min_by_key(|candidate| position_distance(c, candidate))
                    .expect("nonempty")
            };
            return candidate_result(c, best, true, "High-confidence fuzzy match.");
        }
        fuzzy_sets = Some(sets);
    }
    // Stage 5: positional fallback is best-effort. An explicit stale revision
    // lowers confidence; selected_text is never silently replaced.
    if let Some(line) = c.line.filter(|n| *n > 0 && *n < lines.len()) {
        if let Some(selected) = selected {
            let one_line = vec![String::new(), lines[line].clone()];
            let candidates = fuzzy_search(&one_line, selected, 0.6, None, None);
            if let Some(best) = candidates
                .iter()
                .min_by_key(|candidate| position_distance(c, candidate))
            {
                return ReanchorResult {
                    new_line: c.line,
                    new_end_line: c.end_line,
                    anchored_text: Some(best.text.clone()),
                    previous_selected_text: c.selected_text.clone(),
                    ..empty_result(
                        &c.id,
                        ReanchorStatus::Fuzzy,
                        best.score,
                        "Line fallback with fuzzy text match.",
                    )
                };
            }
        }
        if selected.is_none() || evidence.commit_is_stale {
            let captured = selected.is_none().then(|| at_comment(lines, c)).flatten();
            if captured
                .as_ref()
                .is_some_and(|text| text.chars().count() > MAX_CAPTURE_CHARACTERS)
            {
                return empty_result(
                    &c.id,
                    ReanchorStatus::Ambiguous,
                    0.0,
                    "Line-only range exceeds the capture limit; reviewer retargeting is required.",
                );
            }
            let (status, score) = if selected.is_none() {
                (ReanchorStatus::Anchored, 1.0)
            } else {
                (ReanchorStatus::Ambiguous, 0.5)
            };
            return ReanchorResult {
                new_line: c.line,
                new_end_line: c.end_line,
                // Capture an explicitly positional line-only range too. In
                // particular, force may now stamp a HEAD which does not contain
                // this working-tree coordinate; the capture prevents a later
                // run from mistaking that stamp for source-coordinate proof.
                anchored_text: captured,
                ..empty_result(
                    &c.id,
                    status,
                    score,
                    "Line/column fallback (best-effort position).",
                )
            };
        }
        // A surviving line number is not identity evidence for selected text.
        // Try lower-threshold document retrieval, otherwise orphan the comment.
    }
    // Stage 6: low-threshold retrieval is tentative, not certain relocation.
    if let Some(sets) = fuzzy_sets {
        let candidates = &sets[1];
        if candidates.len() == 1 {
            return candidate_result(c, &candidates[0], true, "Low-threshold fuzzy match.");
        }
        if let Some(best) = candidates.first() {
            return ReanchorResult {
                new_line: Some(best.line),
                new_end_line: Some(best.end_line),
                ..empty_result(
                    &c.id,
                    ReanchorStatus::Ambiguous,
                    best.score,
                    "Multiple lower-threshold fuzzy matches.",
                )
            };
        }
    }
    empty_result(
        &c.id,
        ReanchorStatus::Orphaned,
        0.0,
        "No defensible match remains; retain comment for reviewer action.",
    )
}

/// Current-text-only batch operation; one fuzzy index is shared by all comments.
pub fn reanchor_document(
    doc: &MrsfDocument,
    lines: &[String],
    options: &ReanchorOptions,
) -> Vec<ReanchorResult> {
    let fuzzy = create_fuzzy_search_index(lines);
    doc.comments
        .iter()
        .map(|c| {
            reanchor_comment_with_evidence(
                c,
                lines,
                options,
                AnchorEvidence {
                    fuzzy_index: Some(&fuzzy),
                    ..Default::default()
                },
            )
        })
        .collect()
}

/// Full pure Anchor Mesh, useful to editors that retain a previous snapshot.
/// A wrong source snapshot cannot establish trusted evidence: each original
/// selection must verify against its source range before context is used.
pub fn reanchor_document_with_source(
    doc: &MrsfDocument,
    source: &[String],
    target: &[String],
    options: &ReanchorOptions,
) -> Vec<ReanchorResult> {
    let projection = create_revision_projection(source, target);
    let context = create_anchor_context_index(source, target);
    let fuzzy = create_fuzzy_search_index(target);
    let results: Vec<_> = doc
        .comments
        .iter()
        .map(|c| {
            reanchor_comment_with_evidence(
                c,
                target,
                options,
                AnchorEvidence {
                    revision_projection: Some(&projection),
                    anchor_context: Some(&context),
                    fuzzy_index: Some(&fuzzy),
                    ..Default::default()
                },
            )
        })
        .collect();
    reconcile_comment_anchors(&doc.comments, &results, &context)
}

/// Apply results without deleting any comments. Original selected_text and its
/// hash are immutable unless `update_text` is explicitly enabled. Metadata-only
/// changes are counted too, so orphan status is persisted by file helpers.
pub fn apply_reanchor_results(
    doc: &mut MrsfDocument,
    results: &[ReanchorResult],
    options: &ReanchorOptions,
    head_commit: Option<&str>,
) -> usize {
    let mut changed = 0;
    for c in &mut doc.comments {
        let Some(result) = results.iter().find(|r| r.comment_id == c.id) else {
            continue;
        };
        let before = c.clone();
        if let Some(line) = result.new_line {
            c.line = Some(line);
        }
        if let Some(line) = result.new_end_line {
            c.end_line = Some(line);
        }
        if let Some(column) = result.new_start_column {
            c.start_column = Some(column);
        }
        if let Some(column) = result.new_end_column {
            c.end_column = Some(column);
        }
        if let Some(text) = &result.anchored_text {
            if !text.is_empty() && Some(text) == c.selected_text.as_ref() {
                c.anchored_text = None;
            } else if options.update_text {
                c.selected_text = Some(text.clone());
                c.selected_text_hash = Some(crate::compute_hash(text));
                c.anchored_text = None;
            } else {
                c.anchored_text = Some(text.clone());
            }
        } else if matches!(
            result.status,
            ReanchorStatus::Anchored | ReanchorStatus::Shifted
        ) && (c.selected_text.is_some() || c.line.is_none())
        {
            c.anchored_text = None;
        }
        // A successful no-coordinate-change recovery must clear stale orphan/
        // fuzzy/ambiguous state too. Keep an already-certain Shifted marker as
        // movement history, so rerunning an applied shift is a true no-op.
        let tracked =
            c.extra.contains_key("x_reanchor_status") || c.extra.contains_key("x_reanchor_score");
        let previous_shift =
            c.extra.get("x_reanchor_status").and_then(|v| v.as_str()) == Some("shifted");
        if *c != before || result.status != ReanchorStatus::Anchored || (tracked && !previous_shift)
        {
            c.extra.insert(
                "x_reanchor_status".into(),
                serde_json::to_value(result.status).expect("enum serializes"),
            );
            c.extra
                .insert("x_reanchor_score".into(), serde_json::json!(result.score));
        }
        if options.force
            && matches!(
                result.status,
                ReanchorStatus::Anchored | ReanchorStatus::Shifted
            )
            && result.score >= 0.8
        {
            if let Some(head) = head_commit {
                c.commit = Some(head.into());
                c.extra.remove("x_reanchor_status");
                c.extra.remove("x_reanchor_score");
            }
        }
        if *c != before {
            changed += 1;
        }
    }
    changed
}

struct RevisionEvidence {
    hunks: Vec<DiffHunk>,
    projection: RevisionProjectionIndex,
    context: AnchorContextIndex,
}

/// Git-aware batch helper. Canonical revisions, source text, diff hunks, and
/// indexes are cached per revision. Real Git operation failures propagate via
/// `Result`; a missing executable simply leaves the pure-text path available.
pub fn reanchor_document_at_path(
    doc: &MrsfDocument,
    lines: &[String],
    document_path: impl AsRef<Path>,
    options: &ReanchorOptions,
) -> Result<Vec<ReanchorResult>> {
    if options.no_git {
        return Ok(reanchor_document(doc, lines, options));
    }
    let git = Git::default();
    let path = std::fs::canonicalize(document_path.as_ref())?;
    let parent = path.parent().unwrap_or(Path::new("."));
    let Some(root) = git.find_repo_root(parent)? else {
        return Ok(reanchor_document(doc, lines, options));
    };
    let root_real = std::fs::canonicalize(&root)?;
    let relative = path
        .strip_prefix(root_real)
        .map_err(|_| crate::Error::Path(path.display().to_string()))?
        .to_string_lossy()
        .replace('\\', "/");
    let head = git.current_commit(&root)?;
    let fuzzy = create_fuzzy_search_index(lines);
    let mut canonical: BTreeMap<String, String> = BTreeMap::new();
    let mut cache: BTreeMap<String, RevisionEvidence> = BTreeMap::new();
    let mut groups: BTreeMap<String, Vec<usize>> = BTreeMap::new();
    let mut results = Vec::new();
    for (i, c) in doc.comments.iter().enumerate() {
        let revision = options.from_commit.as_ref().or(c.commit.as_ref());
        let Some(revision) = revision else {
            results.push(reanchor_comment_with_evidence(
                c,
                lines,
                options,
                AnchorEvidence {
                    fuzzy_index: Some(&fuzzy),
                    ..Default::default()
                },
            ));
            continue;
        };
        let commit = if let Some(commit) = canonical.get(revision) {
            commit.clone()
        } else {
            let Some(commit) = git.resolve_commit(revision, &root)? else {
                return Ok(reanchor_document(doc, lines, options));
            };
            canonical.insert(revision.clone(), commit.clone());
            commit
        };
        if !cache.contains_key(&commit) {
            let Some(source) = git.file_at_commit(&commit, &relative, &root)? else {
                return Ok(reanchor_document(doc, lines, options));
            };
            let source = crate::to_reanchor_lines(&source);
            let hunks = git
                .diff(&commit, None, &relative, &root)?
                .unwrap_or_default();
            cache.insert(
                commit.clone(),
                RevisionEvidence {
                    hunks,
                    projection: create_revision_projection(&source, lines),
                    context: create_anchor_context_index(&source, lines),
                },
            );
        }
        let shared = &cache[&commit];
        let selection = c.selected_text.as_deref().filter(|s| !s.is_empty());
        let source_verifies = selection.is_none()
            || at_comment(&shared.projection.source_lines, c).as_deref() == selection;
        let evidence = AnchorEvidence {
            // After application, selected-text coordinates can also belong to
            // a newer working snapshot than commit. Source verification avoids
            // treating an accidental target-text match as a valid Git shift.
            diff_hunks: source_verifies.then_some(shared.hunks.as_slice()),
            revision_projection: Some(&shared.projection),
            anchor_context: Some(&shared.context),
            fuzzy_index: Some(&fuzzy),
            commit_is_stale: head.as_ref() != Some(&commit) || !shared.hunks.is_empty(),
        };
        results.push(reanchor_comment_with_evidence(c, lines, options, evidence));
        groups.entry(commit).or_default().push(i);
    }
    for (commit, indexes) in groups {
        let comments: Vec<_> = indexes.iter().map(|i| doc.comments[*i].clone()).collect();
        let local: Vec<_> = indexes.iter().map(|i| results[*i].clone()).collect();
        for (i, result) in indexes.into_iter().zip(reconcile_comment_anchors(
            &comments,
            &local,
            &cache[&commit].context,
        )) {
            results[i] = result;
        }
    }
    Ok(results)
}

#[derive(Clone, Debug)]
pub struct ReanchorFileResult {
    pub results: Vec<ReanchorResult>,
    pub changed: usize,
    pub written: bool,
}

/// Resolve the document field against its workspace, including redirected
/// sidecars, then reanchor and safely write unless dry_run is requested.
pub fn reanchor_file(
    sidecar: impl AsRef<Path>,
    options: &ReanchorOptions,
) -> Result<ReanchorFileResult> {
    let sidecar = sidecar.as_ref();
    let mut doc = crate::parse_sidecar(sidecar)?;
    let parent = sidecar.parent().unwrap_or(Path::new("."));
    let root = crate::find_workspace_root(parent)?;
    let document_path = crate::resolve_document_path(&root, &doc.document)?;
    let lines = crate::read_document_lines(&document_path)?;
    let results = reanchor_document_at_path(&doc, &lines, &document_path, options)?;
    if options.dry_run {
        return Ok(ReanchorFileResult {
            results,
            changed: 0,
            written: false,
        });
    }
    let head = if options.no_git {
        None
    } else {
        match Git::default().find_repo_root(&root)? {
            Some(root) => Git::default().current_commit(root)?,
            None => None,
        }
    };
    let changed = apply_reanchor_results(&mut doc, &results, options, head.as_deref());
    if changed > 0 {
        crate::write_sidecar(sidecar, &doc)?;
    }
    Ok(ReanchorFileResult {
        results,
        changed,
        written: changed > 0,
    })
}
