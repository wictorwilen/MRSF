"""Heading-scoped multi-comment anchor reconciliation."""

from __future__ import annotations

from dataclasses import dataclass, replace

from .anchor_context import (
    AnchorContextIndex,
    ContextAnchorCandidate,
    find_context_anchor_candidates,
    get_anchor_context_scope,
)
from .types import Comment, ReanchorResult

LOCAL_LANDMARK_WINDOW = 30
MIN_LANDMARK_SUPPORT = 0.65
MIN_SUPPORTING_LANDMARKS = 2
MIN_GLOBAL_MARGIN = 0.08
MAX_RECONCILIATION_ROUNDS = 4


@dataclass
class _Landmark:
    source_line: int
    target_line: int
    scope: str


@dataclass
class _ScoredCandidate:
    candidate: ContextAnchorCandidate
    global_score: float
    support: float
    supporting_landmarks: int


def reconcile_comment_anchors(
    comments: list[Comment],
    results: list[ReanchorResult],
    anchor_context: AnchorContextIndex,
) -> list[ReanchorResult]:
    reconciled = [replace(result) for result in results]
    if len(comments) < 3 or not any(result.status == "ambiguous" for result in reconciled):
        return reconciled
    result_indexes = {result.comment_id: index for index, result in enumerate(reconciled)}
    landmarks = _collect_landmarks(comments, reconciled, anchor_context)
    counts: dict[str, int] = {}
    for landmark in landmarks:
        counts[landmark.scope] = counts.get(landmark.scope, 0) + 1

    for _ in range(MAX_RECONCILIATION_ROUNDS):
        changed = False
        for comment in comments:
            if comment.line is None or not comment.selected_text:
                continue
            scope = get_anchor_context_scope(comment, anchor_context)
            if scope is None or counts.get(scope, 0) < MIN_SUPPORTING_LANDMARKS:
                continue
            result_index = result_indexes.get(comment.id)
            if result_index is None or reconciled[result_index].status != "ambiguous":
                continue
            candidates = _deduplicate(
                find_context_anchor_candidates(comment, anchor_context)
            )[:8]
            if len(candidates) < 2:
                continue
            ranked = sorted(
                (
                    _score_with_landmarks(comment.line, scope, candidate, landmarks)
                    for candidate in candidates
                ),
                key=lambda item: (
                    -item.global_score,
                    -item.candidate.score,
                    item.candidate.line,
                ),
            )
            best, second = ranked[0], ranked[1]
            if (
                not best.candidate.exact
                or best.supporting_landmarks < MIN_SUPPORTING_LANDMARKS
                or best.support < MIN_LANDMARK_SUPPORT
                or best.global_score - second.global_score < MIN_GLOBAL_MARGIN
            ):
                continue
            reconciled[result_index] = ReanchorResult(
                comment_id=comment.id,
                status="anchored",
                score=min(0.99, 0.8 + best.support * 0.19),
                new_line=best.candidate.line,
                new_end_line=best.candidate.end_line,
                new_start_column=best.candidate.start_column,
                new_end_column=best.candidate.end_column,
                reason=(
                    f"Global reconciliation selected this candidate from "
                    f"{best.supporting_landmarks} nearby landmark(s) "
                    f"(support {best.support:.3f}, margin "
                    f"{best.global_score - second.global_score:.3f})."
                ),
            )
            landmarks.append(_Landmark(comment.line, best.candidate.line, scope))
            counts[scope] = counts.get(scope, 0) + 1
            changed = True
        if not changed:
            break
    return reconciled


def _collect_landmarks(
    comments: list[Comment],
    results: list[ReanchorResult],
    context: AnchorContextIndex,
) -> list[_Landmark]:
    result_map = {result.comment_id: result for result in results}
    landmarks: list[_Landmark] = []
    for comment in comments:
        result = result_map.get(comment.id)
        if (
            comment.line is None
            or result is None
            or result.new_line is None
            or result.status not in ("anchored", "shifted")
            or result.score < 0.99
        ):
            continue
        scope = get_anchor_context_scope(comment, context)
        if scope is not None:
            landmarks.append(_Landmark(comment.line, result.new_line, scope))
    return landmarks


def _score_with_landmarks(
    source_line: int,
    scope: str,
    candidate: ContextAnchorCandidate,
    landmarks: list[_Landmark],
) -> _ScoredCandidate:
    weighted = total = 0.0
    supporting = 0
    candidate_shift = candidate.line - source_line
    for landmark in landmarks:
        distance = abs(source_line - landmark.source_line)
        if landmark.scope != scope or distance == 0 or distance > LOCAL_LANDMARK_WINDOW:
            continue
        error = abs(candidate_shift - (landmark.target_line - landmark.source_line))
        agreement = max(0.0, 1 - error / 8)
        weight = 1 / (1 + distance / 4)
        weighted += agreement * weight
        total += weight
        if agreement >= MIN_LANDMARK_SUPPORT:
            supporting += 1
    support = weighted / total if total else 0.0
    score = candidate.score * 0.5 + support * 0.45 + (0.05 if candidate.exact else 0)
    return _ScoredCandidate(candidate, score, support, supporting)


def _deduplicate(candidates: list[ContextAnchorCandidate]) -> list[ContextAnchorCandidate]:
    unique: dict[tuple[int, int, int | None, int | None], ContextAnchorCandidate] = {}
    for candidate in candidates:
        key = (
            candidate.line,
            candidate.end_line,
            candidate.start_column,
            candidate.end_column,
        )
        if key not in unique or candidate.score > unique[key].score:
            unique[key] = candidate
    return sorted(unique.values(), key=lambda item: (-item.score, item.line))
