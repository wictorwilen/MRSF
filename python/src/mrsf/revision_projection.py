"""Revision-aware line and range projection for re-anchoring."""

from __future__ import annotations

from dataclasses import dataclass

from .fuzzy import combined_score, exact_match
from .types import Comment

CONTEXT_RADIUS = 8


@dataclass
class RevisionProjectionIndex:
    source_lines: list[str]
    target_lines: list[str]
    line_map: dict[int, int]


@dataclass
class ProjectedAnchor:
    line: int
    end_line: int
    text: str
    score: float
    exact: bool
    context_support: int
    context_margin: float
    reason: str
    start_column: int | None = None
    end_column: int | None = None


def create_revision_projection(
    source_lines: list[str],
    target_lines: list[str],
) -> RevisionProjectionIndex:
    source_occurrences = _collect_line_occurrences(source_lines)
    target_occurrences = _collect_line_occurrences(target_lines)
    line_map: dict[int, int] = {}
    for text, source_numbers in source_occurrences.items():
        target_numbers = target_occurrences.get(text)
        if len(source_numbers) == 1 and target_numbers is not None and len(target_numbers) == 1:
            line_map[source_numbers[0]] = target_numbers[0]
    return RevisionProjectionIndex(source_lines, target_lines, line_map)


def project_comment_anchor(
    comment: Comment,
    projection: RevisionProjectionIndex,
    threshold: float,
) -> ProjectedAnchor | None:
    if comment.line is None or not comment.selected_text:
        return None
    source_text = _extract_text(
        projection.source_lines,
        comment.line,
        comment.end_line,
        comment.start_column,
        comment.end_column,
    )
    if source_text != comment.selected_text:
        return None

    exact_candidates = exact_match(projection.target_lines, comment.selected_text)
    if len(exact_candidates) == 1:
        candidate = exact_candidates[0]
        context_support = _count_independent_exact_support(
            comment, candidate.line, projection
        )
        if context_support >= 2:
            return ProjectedAnchor(
                line=candidate.line,
                end_line=candidate.end_line,
                start_column=candidate.start_column,
                end_column=candidate.end_column,
                text=candidate.text,
                score=1.0,
                exact=True,
                context_support=context_support,
                context_margin=1.0,
                reason="Source revision and neighboring line evidence confirm exact relocation.",
            )
    if exact_candidates:
        return None

    projected = _project_line_from_context(comment, projection)
    if projected is None:
        return None
    projected_line, support, margin = projected
    line_span = (comment.end_line or comment.line) - comment.line
    projected_end_line = projected_line + line_span
    if projected_line < 1 or projected_end_line >= len(projection.target_lines):
        return None

    start_column, end_column = _project_columns(comment, projection, projected_line)
    target_text = _extract_text(
        projection.target_lines,
        projected_line,
        projected_end_line,
        start_column,
        end_column,
    )
    if target_text is None:
        return None
    score = min(1.0, combined_score(comment.selected_text, target_text) + 0.1)
    if score < threshold:
        return None
    return ProjectedAnchor(
        line=projected_line,
        end_line=projected_end_line,
        start_column=start_column,
        end_column=end_column,
        text=target_text,
        score=score,
        exact=target_text == comment.selected_text,
        context_support=support,
        context_margin=margin,
        reason="Source revision context projects the edited anchor range.",
    )


def _collect_line_occurrences(lines: list[str]) -> dict[str, list[int]]:
    occurrences: dict[str, list[int]] = {}
    for line in range(1, len(lines)):
        text = lines[line]
        if text.strip():
            occurrences.setdefault(text, []).append(line)
    return occurrences


def _count_independent_exact_support(
    comment: Comment,
    candidate_line: int,
    projection: RevisionProjectionIndex,
) -> int:
    assert comment.line is not None
    source_end_line = comment.end_line or comment.line
    expected_shift = candidate_line - comment.line
    if (
        (comment.start_column is not None or comment.end_column is not None)
        and projection.line_map.get(comment.line) == candidate_line
    ):
        return 2
    support = 0
    for distance in range(1, CONTEXT_RADIUS + 1):
        for source_line in (comment.line - distance, source_end_line + distance):
            if source_line < 1 or source_line >= len(projection.source_lines):
                continue
            target_line = projection.line_map.get(source_line)
            if target_line is not None and target_line - source_line == expected_shift:
                support += 1
    return support


def _project_line_from_context(
    comment: Comment,
    projection: RevisionProjectionIndex,
) -> tuple[int, int, float] | None:
    assert comment.line is not None
    source_end_line = comment.end_line or comment.line
    votes: dict[int, tuple[int, int]] = {}
    for distance in range(1, CONTEXT_RADIUS + 1):
        for context_line in (comment.line - distance, source_end_line + distance):
            if context_line < 1 or context_line >= len(projection.source_lines):
                continue
            target_line = projection.line_map.get(context_line)
            if target_line is None:
                continue
            shift = target_line - context_line
            count, nearest = votes.get(shift, (0, distance))
            votes[shift] = (count + 1, min(nearest, distance))
    ranked = sorted(votes.items(), key=lambda item: (-item[1][0], item[1][1], abs(item[0])))
    if not ranked:
        return None
    shift, (count, nearest) = ranked[0]
    if count < 2 and nearest > 3:
        return None
    if len(ranked) > 1 and ranked[1][1] == (count, nearest):
        return None
    runner_up = ranked[1][1][0] if len(ranked) > 1 else 0
    return comment.line + shift, count, (count - runner_up) / count


def _project_columns(
    comment: Comment,
    projection: RevisionProjectionIndex,
    target_line: int,
) -> tuple[int | None, int | None]:
    if (
        comment.line is None
        or (comment.end_line is not None and comment.end_line != comment.line)
        or comment.start_column is None
        or comment.end_column is None
    ):
        return comment.start_column, comment.end_column
    source = projection.source_lines[comment.line]
    target = projection.target_lines[target_line]
    prefix = source[: comment.start_column]
    suffix = source[comment.end_column :]
    start = len(prefix) if target.startswith(prefix) else min(comment.start_column, len(target))
    end = (
        len(target) - len(suffix)
        if target.endswith(suffix)
        else min(len(target), start + comment.end_column - comment.start_column)
    )
    return start, end


def _extract_text(
    lines: list[str],
    line: int,
    end_line: int | None = None,
    start_column: int | None = None,
    end_column: int | None = None,
) -> str | None:
    final_line = end_line or line
    if line < 1 or final_line >= len(lines):
        return None
    if line == final_line:
        text = lines[line]
        if start_column is not None and end_column is not None:
            return text[start_column:end_column]
        return text
    result = lines[line : final_line + 1]
    if start_column is not None:
        result[0] = result[0][start_column:]
    if end_column is not None:
        result[-1] = result[-1][:end_column]
    return "\n".join(result)
