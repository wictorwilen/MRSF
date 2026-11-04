//! Confidence is an evidence band, not a probability. Conflicting signals
//! cause abstention; averaging two contradictory locations would hide risk.
use crate::{
    context::ContextAnchorResolution, revision::ProjectedAnchor, ReanchorResult, ReanchorStatus,
};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ConfidenceBand {
    Certain,
    Probable,
    Ambiguous,
    Orphaned,
}

#[derive(Clone, Debug)]
pub struct CalibratedAnchor {
    pub band: ConfidenceBand,
    pub result: ReanchorResult,
}

pub(crate) fn empty_result(
    id: &str,
    status: ReanchorStatus,
    score: f64,
    reason: impl Into<String>,
) -> ReanchorResult {
    ReanchorResult {
        comment_id: id.into(),
        status,
        score,
        reason: reason.into(),
        new_line: None,
        new_end_line: None,
        new_start_column: None,
        new_end_column: None,
        anchored_text: None,
        previous_selected_text: None,
    }
}

fn projected_result(id: &str, selected: &str, p: &ProjectedAnchor) -> ReanchorResult {
    ReanchorResult {
        new_line: Some(p.line),
        new_end_line: Some(p.end_line),
        new_start_column: p.start_column,
        new_end_column: p.end_column,
        anchored_text: (!p.exact).then(|| p.text.clone()),
        previous_selected_text: (!p.exact).then(|| selected.into()),
        ..empty_result(
            id,
            if p.exact {
                ReanchorStatus::Anchored
            } else {
                ReanchorStatus::Fuzzy
            },
            p.score,
            &p.reason,
        )
    }
}

fn context_result(id: &str, selected: &str, c: &ContextAnchorResolution) -> ReanchorResult {
    ReanchorResult {
        new_line: c.line,
        new_end_line: c.end_line,
        new_start_column: c.start_column,
        new_end_column: c.end_column,
        anchored_text: if c.status == ReanchorStatus::Fuzzy {
            c.text.clone()
        } else {
            None
        },
        previous_selected_text: (c.status == ReanchorStatus::Fuzzy).then(|| selected.into()),
        ..empty_result(id, c.status, c.score, &c.reason)
    }
}

fn strong(p: &ProjectedAnchor) -> bool {
    p.context_support >= 3 || (p.context_support >= 2 && p.context_margin >= 0.5)
}

pub fn calibrate_anchor_evidence(
    id: &str,
    selected: &str,
    projected: Option<&ProjectedAnchor>,
    contextual: Option<&ContextAnchorResolution>,
) -> Option<CalibratedAnchor> {
    if let Some(p) = projected.filter(|p| p.exact) {
        return Some(CalibratedAnchor {
            band: ConfidenceBand::Certain,
            result: projected_result(id, selected, p),
        });
    }
    if let Some(c) = contextual.filter(|c| c.status == ReanchorStatus::Anchored) {
        return Some(CalibratedAnchor {
            band: ConfidenceBand::Certain,
            result: context_result(id, selected, c),
        });
    }
    match (projected, contextual) {
        (Some(p), Some(c)) if Some(p.line) == c.line && Some(p.end_line) == c.end_line => {
            let mut result = context_result(id, selected, c);
            result.status = ReanchorStatus::Fuzzy;
            result.score = ((p.score + c.score) / 2.0 + 0.05).min(0.95);
            result.reason =
                "Probable anchor: revision projection and Markdown context agree.".into();
            Some(CalibratedAnchor {
                band: ConfidenceBand::Probable,
                result,
            })
        }
        (Some(p), Some(c)) if c.status == ReanchorStatus::Orphaned && !strong(p) => {
            Some(CalibratedAnchor {
                band: ConfidenceBand::Orphaned,
                result: context_result(id, selected, c),
            })
        }
        (Some(p), Some(c))
            if c.status == ReanchorStatus::Fuzzy
                && c.candidate_margin >= 0.15
                && c.score >= p.score + 0.1 =>
        {
            Some(CalibratedAnchor {
                band: ConfidenceBand::Probable,
                result: context_result(id, selected, c),
            })
        }
        (Some(p), Some(c)) => Some(CalibratedAnchor {
            band: ConfidenceBand::Ambiguous,
            result: empty_result(
                id,
                ReanchorStatus::Ambiguous,
                p.score.max(c.score),
                "Ambiguous evidence: revision projection and Markdown context disagree.",
            ),
        }),
        (_, Some(c)) => Some(CalibratedAnchor {
            band: match c.status {
                ReanchorStatus::Orphaned => ConfidenceBand::Orphaned,
                ReanchorStatus::Ambiguous => ConfidenceBand::Ambiguous,
                _ => ConfidenceBand::Probable,
            },
            result: context_result(id, selected, c),
        }),
        (Some(p), _) if strong(p) => Some(CalibratedAnchor {
            band: ConfidenceBand::Probable,
            result: projected_result(id, selected, p),
        }),
        _ => None,
    }
}
