//! Heading-scoped group reconciliation. At least two independent local
//! landmarks must agree; a lone neighboring comment cannot pull an ambiguous
//! anchor across the document. Four rounds bound propagation.
use crate::{
    calibration::empty_result,
    context::{
        find_context_anchor_candidates, get_anchor_context_scope, AnchorContextIndex,
        ContextAnchorCandidate,
    },
    Comment, ReanchorResult, ReanchorStatus,
};
use std::collections::BTreeMap;

struct Landmark {
    source: usize,
    target: usize,
    scope: String,
}

pub fn reconcile_comment_anchors(
    comments: &[Comment],
    results: &[ReanchorResult],
    context: &AnchorContextIndex,
) -> Vec<ReanchorResult> {
    let mut reconciled = results.to_vec();
    if comments.len() < 3
        || !results
            .iter()
            .any(|r| r.status == ReanchorStatus::Ambiguous)
    {
        return reconciled;
    }
    let mut landmarks = Vec::new();
    for c in comments {
        // A captured line-only target range is not a source-revision landmark.
        // Nor is an already-applied selected-text range that fails to verify in
        // this source snapshot. Using either would spread its stale coordinate
        // basis to otherwise unrelated comments during global reconciliation.
        let selection = c.selected_text.as_deref().filter(|s| !s.is_empty());
        if (selection.is_none() && c.anchored_text.is_some())
            || selection.is_some_and(|s| {
                crate::text::at_comment(&context.source.lines, c).as_deref() != Some(s)
            })
        {
            continue;
        }
        let Some(result) = results.iter().find(|r| r.comment_id == c.id) else {
            continue;
        };
        if !matches!(
            result.status,
            ReanchorStatus::Anchored | ReanchorStatus::Shifted
        ) || result.score < 0.99
        {
            continue;
        }
        if let (Some(source), Some(target), Some(scope)) = (
            c.line,
            result.new_line,
            get_anchor_context_scope(c, context),
        ) {
            landmarks.push(Landmark {
                source,
                target,
                scope,
            });
        }
    }
    for _ in 0..4 {
        let mut changed = false;
        for c in comments {
            let Some(line) = c.line else {
                continue;
            };
            if c.selected_text.is_none() {
                continue;
            }
            let Some(scope) = get_anchor_context_scope(c, context) else {
                continue;
            };
            if landmarks.iter().filter(|l| l.scope == scope).count() < 2 {
                continue;
            }
            let Some(i) = reconciled
                .iter()
                .position(|r| r.comment_id == c.id && r.status == ReanchorStatus::Ambiguous)
            else {
                continue;
            };
            let mut unique: BTreeMap<_, ContextAnchorCandidate> = BTreeMap::new();
            for candidate in find_context_anchor_candidates(c, context) {
                let key = (
                    candidate.line,
                    candidate.end_line,
                    candidate.start_column,
                    candidate.end_column,
                );
                if unique
                    .get(&key)
                    .is_none_or(|old| old.score < candidate.score)
                {
                    unique.insert(key, candidate);
                }
            }
            let mut candidates: Vec<_> = unique.into_values().collect();
            candidates.sort_by(|a, b| b.score.total_cmp(&a.score).then(a.line.cmp(&b.line)));
            let mut ranked: Vec<_> = candidates
                .into_iter()
                .take(8)
                .map(|candidate| {
                    let (mut weighted, mut total, mut supporting) = (0.0, 0.0, 0);
                    let shift = candidate.line as isize - line as isize;
                    for landmark in &landmarks {
                        let distance = line.abs_diff(landmark.source);
                        if landmark.scope != scope || distance == 0 || distance > 30 {
                            continue;
                        }
                        let error = (shift - (landmark.target as isize - landmark.source as isize))
                            .unsigned_abs();
                        let agreement = (1.0 - error as f64 / 8.0).max(0.0);
                        let weight = 1.0 / (1.0 + distance as f64 / 4.0);
                        weighted += agreement * weight;
                        total += weight;
                        if agreement >= 0.65 {
                            supporting += 1;
                        }
                    }
                    let support = if total > 0.0 { weighted / total } else { 0.0 };
                    let global = candidate.score * 0.5
                        + support * 0.45
                        + if candidate.exact { 0.05 } else { 0.0 };
                    (candidate, global, support, supporting)
                })
                .collect();
            ranked.sort_by(|a, b| {
                b.1.total_cmp(&a.1)
                    .then_with(|| b.0.score.total_cmp(&a.0.score))
                    .then(a.0.line.cmp(&b.0.line))
            });
            if ranked.len() < 2 {
                continue;
            }
            let (best, global, support, count) = &ranked[0];
            if !best.exact || *count < 2 || *support < 0.65 || global - ranked[1].1 < 0.08 {
                continue;
            }
            reconciled[i] = ReanchorResult {
                new_line: Some(best.line), new_end_line: Some(best.end_line),
                new_start_column: best.start_column, new_end_column: best.end_column,
                ..empty_result(&c.id, ReanchorStatus::Anchored, (0.8+support*0.19).min(0.99),
                    format!("Global reconciliation selected this candidate from {count} nearby landmarks (support {support:.3})."))
            };
            landmarks.push(Landmark {
                source: line,
                target: best.line,
                scope,
            });
            changed = true;
        }
        if !changed {
            break;
        }
    }
    reconciled
}
