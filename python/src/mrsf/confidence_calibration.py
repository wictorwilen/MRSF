"""Evidence agreement and confidence-band calibration."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Literal

from .anchor_context import ContextAnchorResolution
from .revision_projection import ProjectedAnchor
from .types import ReanchorResult

ConfidenceBand = Literal["certain", "probable", "ambiguous", "orphaned"]


@dataclass
class CalibratedAnchor:
    band: ConfidenceBand
    result: ReanchorResult


def calibrate_anchor_evidence(
    comment_id: str,
    selected_text: str,
    projected: ProjectedAnchor | None = None,
    contextual: ContextAnchorResolution | None = None,
) -> CalibratedAnchor | None:
    if projected is not None and projected.exact:
        return CalibratedAnchor("certain", _projected_result(comment_id, selected_text, projected))
    if contextual is not None and contextual.status == "anchored":
        return CalibratedAnchor(
            "certain",
            _contextual_result(comment_id, selected_text, contextual),
        )
    if projected is not None and contextual is not None:
        if projected.line == contextual.line and projected.end_line == contextual.end_line:
            result = _contextual_result(comment_id, selected_text, contextual)
            result.status = "fuzzy"
            result.score = min(0.95, (projected.score + contextual.score) / 2 + 0.05)
            result.reason = (
                "Probable anchor: revision projection and Markdown context agree "
                f"(confidence {result.score:.3f})."
            )
            return CalibratedAnchor("probable", result)
        if contextual.status == "orphaned" and not _strong_projection(projected):
            return CalibratedAnchor(
                "orphaned", _contextual_result(comment_id, selected_text, contextual)
            )
        if (
            contextual.status == "fuzzy"
            and contextual.candidate_margin >= 0.15
            and contextual.score >= projected.score + 0.1
        ):
            return CalibratedAnchor(
                "probable", _contextual_result(comment_id, selected_text, contextual)
            )
        return CalibratedAnchor(
            "ambiguous",
            ReanchorResult(
                comment_id=comment_id,
                status="ambiguous",
                score=max(projected.score, contextual.score),
                reason=(
                    f"Ambiguous evidence: revision projection points to line {projected.line}, "
                    f"while Markdown context points to {contextual.line or 'no location'}."
                ),
            ),
        )
    if contextual is not None:
        band: ConfidenceBand = (
            "orphaned"
            if contextual.status == "orphaned"
            else ("ambiguous" if contextual.status == "ambiguous" else "probable")
        )
        return CalibratedAnchor(band, _contextual_result(comment_id, selected_text, contextual))
    if projected is not None and _strong_projection(projected):
        return CalibratedAnchor("probable", _projected_result(comment_id, selected_text, projected))
    return None


def _strong_projection(projected: ProjectedAnchor) -> bool:
    return projected.context_support >= 3 or (
        projected.context_support >= 2 and projected.context_margin >= 0.5
    )


def _projected_result(
    comment_id: str, selected_text: str, projected: ProjectedAnchor
) -> ReanchorResult:
    return ReanchorResult(
        comment_id=comment_id,
        status="anchored" if projected.exact else "fuzzy",
        score=projected.score,
        new_line=projected.line,
        new_end_line=projected.end_line,
        new_start_column=projected.start_column,
        new_end_column=projected.end_column,
        anchored_text=None if projected.exact else projected.text,
        previous_selected_text=None if projected.exact else selected_text,
        reason=projected.reason,
    )


def _contextual_result(
    comment_id: str, selected_text: str, contextual: ContextAnchorResolution
) -> ReanchorResult:
    return ReanchorResult(
        comment_id=comment_id,
        status=contextual.status,
        score=contextual.score,
        new_line=contextual.line,
        new_end_line=contextual.end_line,
        new_start_column=contextual.start_column,
        new_end_column=contextual.end_column,
        anchored_text=contextual.text if contextual.status == "fuzzy" else None,
        previous_selected_text=selected_text if contextual.status == "fuzzy" else None,
        reason=contextual.reason,
    )
