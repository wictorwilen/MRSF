"""MRSF Re-anchor Engine - §7.4 Anchoring Resolution Procedure.

Implements a four-step algorithm to re-locate each comment's
anchor within the current document revision:

  Step 0  – diff-based shift (git + commit available)
  Step 1  – exact text match
  Step 1.5– fuzzy match ≥ high threshold (0.8)
  Step 2  – line/column fallback (commit-aware staleness)
  Step 3  – lower-threshold fuzzy ≥ configured threshold (0.6)
  Step 4  – orphan
"""

from __future__ import annotations

import os
from collections.abc import Callable
from typing import Any

from .anchor_context import (
    AnchorContextIndex,
    create_anchor_context_index,
    resolve_context_anchor,
)
from .confidence_calibration import calibrate_anchor_evidence
from .discovery import sidecar_to_document
from .fuzzy import (
    FuzzySearchIndex,
    create_fuzzy_search_index,
    exact_match,
    fuzzy_search,
    fuzzy_search_thresholds,
    normalized_match,
)
from .git import (
    find_repo_root,
    get_current_commit,
    get_diff,
    get_file_at_commit,
    get_line_shift,
    is_git_available,
)
from .global_reconciliation import reconcile_comment_anchors
from .parser import parse_sidecar, read_document_lines
from .revision_projection import (
    RevisionProjectionIndex,
    create_revision_projection,
    project_comment_anchor,
)
from .types import (
    Comment,
    DiffHunk,
    MrsfDocument,
    ReanchorOptions,
    ReanchorResult,
)
from .writer import write_sidecar

HIGH_THRESHOLD = 0.8
DEFAULT_THRESHOLD = 0.6
DEFAULT_PROXIMITY_WINDOW = 5


# ---------------------------------------------------------------------------
# Single comment re-anchoring
# ---------------------------------------------------------------------------


def reanchor_comment(
    comment: Comment,
    document_lines: list[str],
    *,
    diff_hunks: list[DiffHunk] | None = None,
    threshold: float = DEFAULT_THRESHOLD,
    commit_is_stale: bool = False,
    proximity_window: int = DEFAULT_PROXIMITY_WINDOW,
    revision_projection: RevisionProjectionIndex | None = None,
    anchor_context: AnchorContextIndex | None = None,
    fuzzy_search_index: FuzzySearchIndex | None = None,
    get_fuzzy_search_index: Callable[[], FuzzySearchIndex] | None = None,
) -> ReanchorResult:
    """Re-anchor a single comment against the current document lines."""
    comment_id = comment.id
    selected_text = comment.selected_text
    fuzzy_candidate_sets: dict[float, list[Any]] | None = None

    def get_fuzzy_index() -> FuzzySearchIndex:
        nonlocal fuzzy_search_index
        if fuzzy_search_index is None:
            fuzzy_search_index = (
                get_fuzzy_search_index()
                if get_fuzzy_search_index is not None
                else create_fuzzy_search_index(document_lines)
            )
        return fuzzy_search_index

    # No selected_text and no line — nothing to anchor
    if not selected_text and comment.line is None:
        return ReanchorResult(
            comment_id=comment_id,
            status="anchored",
            score=1.0,
            reason="Document-level comment (no anchor needed).",
        )

    # Step 0: Diff-based shift
    if comment.line is not None and diff_hunks:
        shift, modified = get_line_shift(diff_hunks, comment.line)

        if not selected_text:
            shifted_line = comment.line + shift
            line_span = (comment.end_line - comment.line) if comment.end_line is not None else 0
            shifted_end_line = shifted_line + line_span if comment.end_line is not None else None
            return ReanchorResult(
                comment_id=comment_id,
                status="anchored" if shift == 0 else "shifted",
                score=1.0,
                new_line=shifted_line,
                new_end_line=shifted_end_line,
                reason=(
                    "Line-only comment unchanged (diff confirms position)."
                    if shift == 0
                    else (
                        f"Line-only comment shifted by "
                        f"{'+' if shift > 0 else ''}{shift} line(s) via diff."
                    )
                ),
            )

        if not modified:
            shifted_line = comment.line + shift
            line_span = (comment.end_line - comment.line) if comment.end_line is not None else 0
            shifted_end_line = shifted_line + line_span if comment.end_line is not None else None

            text_at_shifted = _extract_text(
                document_lines,
                shifted_line,
                shifted_end_line,
                comment.start_column,
                comment.end_column,
            )

            if text_at_shifted == selected_text:
                return ReanchorResult(
                    comment_id=comment_id,
                    status="anchored" if shift == 0 else "shifted",
                    score=1.0,
                    new_line=shifted_line,
                    new_end_line=shifted_end_line,
                    reason=(
                        "Diff confirms text unchanged at original position."
                        if shift == 0
                        else f"Diff shifted by {'+' if shift > 0 else ''}{shift} line(s)."
                    ),
                )

    projected = (
        project_comment_anchor(comment, revision_projection, threshold)
        if selected_text and revision_projection is not None
        else None
    )
    if selected_text and projected is not None and projected.exact:
        calibrated = calibrate_anchor_evidence(comment_id, selected_text, projected)
        if calibrated is not None:
            return calibrated.result
    contextual = (
        resolve_context_anchor(comment, anchor_context)
        if selected_text and anchor_context is not None
        else None
    )
    if selected_text and (projected is not None or contextual is not None):
        calibrated = calibrate_anchor_evidence(
            comment_id, selected_text, projected, contextual
        )
        if calibrated is not None:
            return calibrated.result

    # Step 1: Exact text match
    if selected_text:
        exact_candidates = exact_match(document_lines, selected_text)

        if len(exact_candidates) > 1 and comment.line is None:
            return ReanchorResult(
                comment_id=comment_id,
                status="ambiguous",
                score=1.0,
                reason=(
                    f"Ambiguous: {len(exact_candidates)} exact matches and no position "
                    "or source context to disambiguate them."
                ),
            )

        if len(exact_candidates) == 1:
            c = exact_candidates[0]
            if _is_implausible_exact_relocation(
                comment, c, document_lines, proximity_window
            ):
                text_at_origin = _extract_text(
                    document_lines,
                    comment.line or 0,
                    comment.end_line,
                    comment.start_column,
                    comment.end_column,
                )
                return ReanchorResult(
                    comment_id=comment_id,
                    status="fuzzy",
                    score=0.5,
                    new_line=comment.line,
                    new_end_line=comment.end_line,
                    new_start_column=comment.start_column,
                    new_end_column=comment.end_column,
                    anchored_text=text_at_origin,
                    previous_selected_text=selected_text,
                    reason=(
                        f"Lone exact match at line {c.line} is beyond the proximity window "
                        f"(±{proximity_window}) of original line {comment.line} and the text "
                        "at the original position changed; kept at original position, "
                        "needs re-anchoring."
                    ),
                )
            return ReanchorResult(
                comment_id=comment_id,
                status="anchored",
                score=1.0,
                new_line=c.line,
                new_end_line=c.end_line,
                new_start_column=c.start_column,
                new_end_column=c.end_column,
                reason="Exact text match (unique).",
            )

        if len(exact_candidates) > 1 and comment.line is not None:
            best = _closest_to_line(exact_candidates, comment.line)
            return ReanchorResult(
                comment_id=comment_id,
                status="anchored",
                score=1.0,
                new_line=best.line,
                new_end_line=best.end_line,
                new_start_column=best.start_column,
                new_end_column=best.end_column,
                reason=(
                    f"Exact text match ({len(exact_candidates)} occurrences;"
                    f" chose nearest to original line {comment.line})."
                ),
            )

        # Step 1.5: Normalized + high-threshold fuzzy
        norm_candidates = normalized_match(document_lines, selected_text)
        if len(norm_candidates) == 1:
            c = norm_candidates[0]
            return ReanchorResult(
                comment_id=comment_id,
                status="fuzzy",
                score=c.score,
                new_line=c.line,
                new_end_line=c.end_line,
                new_start_column=c.start_column,
                new_end_column=c.end_column,
                anchored_text=c.text,
                previous_selected_text=selected_text,
                reason="Normalized whitespace match.",
            )

        fuzzy_candidate_sets = fuzzy_search_thresholds(
            document_lines,
            selected_text,
            [HIGH_THRESHOLD, threshold],
            comment.line,
            get_fuzzy_index(),
        )
        fuzzy_candidates = fuzzy_candidate_sets.get(HIGH_THRESHOLD, [])

        if len(fuzzy_candidates) == 1 or (
            fuzzy_candidates and fuzzy_candidates[0].score >= HIGH_THRESHOLD
        ):
            best = (
                fuzzy_candidates[0]
                if len(fuzzy_candidates) == 1
                else _closest_to_line(fuzzy_candidates, comment.line or 1)
            )
            return ReanchorResult(
                comment_id=comment_id,
                status="fuzzy",
                score=best.score,
                new_line=best.line,
                new_end_line=best.end_line,
                new_start_column=best.start_column,
                new_end_column=best.end_column,
                anchored_text=best.text,
                previous_selected_text=selected_text,
                reason=f"High-confidence fuzzy match (score {best.score:.3f}).",
            )

    # Step 2: Line/column fallback
    if comment.line is not None:
        line_idx = comment.line
        if 0 < line_idx < len(document_lines):
            qualifier = " (commit is stale — line may have shifted)" if commit_is_stale else ""

            if selected_text:
                line_text = document_lines[line_idx]
                candidates = fuzzy_search(["", line_text], selected_text, DEFAULT_THRESHOLD)
                if candidates:
                    return ReanchorResult(
                        comment_id=comment_id,
                        status="fuzzy",
                        score=candidates[0].score,
                        new_line=comment.line,
                        new_end_line=comment.end_line,
                        anchored_text=candidates[0].text,
                        previous_selected_text=selected_text,
                        reason=(
                            f"Line-fallback with fuzzy text match"
                            f" (score {candidates[0].score:.3f}){qualifier}."
                        ),
                    )

            is_line_only = not selected_text
            return ReanchorResult(
                comment_id=comment_id,
                status="anchored"
                if is_line_only
                else ("ambiguous" if commit_is_stale else "anchored"),
                score=1.0 if is_line_only else (0.5 if commit_is_stale else 0.8),
                new_line=comment.line,
                new_end_line=comment.end_line,
                reason=(
                    "Line-only comment (no selected_text to verify)."
                    if is_line_only
                    else f"Line/column fallback{qualifier}."
                ),
            )

    # Step 3: Lower-threshold fuzzy search
    if selected_text:
        low_candidates = (
            fuzzy_candidate_sets.get(threshold, [])
            if fuzzy_candidate_sets is not None
            else fuzzy_search(
                document_lines,
                selected_text,
                threshold,
                comment.line,
                get_fuzzy_index(),
            )
        )

        if len(low_candidates) == 1:
            c = low_candidates[0]
            return ReanchorResult(
                comment_id=comment_id,
                status="fuzzy",
                score=c.score,
                new_line=c.line,
                new_end_line=c.end_line,
                new_start_column=c.start_column,
                new_end_column=c.end_column,
                anchored_text=c.text,
                previous_selected_text=selected_text,
                reason=f"Low-threshold fuzzy match (score {c.score:.3f}).",
            )

        if len(low_candidates) > 1:
            best = low_candidates[0]
            return ReanchorResult(
                comment_id=comment_id,
                status="ambiguous",
                score=best.score,
                new_line=best.line,
                new_end_line=best.end_line,
                reason=(
                    f"Ambiguous: {len(low_candidates)} fuzzy matches"
                    f" (best score {best.score:.3f})."
                ),
            )

    # Step 4: Orphan
    return ReanchorResult(
        comment_id=comment_id,
        status="orphaned",
        score=0,
        reason="No match found. Comment is orphaned.",
    )


# ---------------------------------------------------------------------------
# Batch re-anchoring
# ---------------------------------------------------------------------------


def reanchor_document(
    doc: MrsfDocument,
    document_lines: list[str],
    opts: ReanchorOptions | None = None,
    *,
    document_path: str | None = None,
    repo_root: str | None = None,
) -> list[ReanchorResult]:
    """Re-anchor all comments in an MRSF document."""
    if opts is None:
        opts = ReanchorOptions()

    results: list[ReanchorResult] = []
    threshold = opts.threshold
    fuzzy_index: FuzzySearchIndex | None = None

    def get_fuzzy_index() -> FuzzySearchIndex:
        nonlocal fuzzy_index
        if fuzzy_index is None:
            fuzzy_index = create_fuzzy_search_index(document_lines)
        return fuzzy_index

    if not opts.no_git and is_git_available():
        effective_repo_root = repo_root or find_repo_root(opts.cwd)
        if effective_repo_root and document_path:
            rel_path = os.path.relpath(document_path, effective_repo_root)
            head = get_current_commit(effective_repo_root)

            global_from = opts.from_commit
            diff_cache: dict[str, list[DiffHunk]] = {}
            projection_cache: dict[str, RevisionProjectionIndex | None] = {}
            context_cache: dict[str, AnchorContextIndex | None] = {}
            groups: dict[str, tuple[list[Comment], list[int], AnchorContextIndex]] = {}

            for comment in doc.comments:
                comment_commit = global_from or comment.commit
                if comment_commit and head and comment_commit != head:
                    if comment_commit not in diff_cache:
                        diff_cache[comment_commit] = get_diff(
                            comment_commit, head, rel_path, effective_repo_root
                        )
                    hunks = diff_cache[comment_commit]
                    if comment_commit not in projection_cache:
                        source_text = get_file_at_commit(
                            comment_commit, rel_path, effective_repo_root
                        )
                        if source_text is None:
                            projection_cache[comment_commit] = None
                            context_cache[comment_commit] = None
                        else:
                            source_lines = to_reanchor_lines(source_text)
                            projection_cache[comment_commit] = create_revision_projection(
                                source_lines, document_lines
                            )
                            context_cache[comment_commit] = create_anchor_context_index(
                                source_lines, document_lines
                            )
                    projection = projection_cache[comment_commit]
                    context = context_cache[comment_commit]
                    result = reanchor_comment(
                        comment,
                        document_lines,
                        diff_hunks=hunks,
                        threshold=threshold,
                        commit_is_stale=True,
                        revision_projection=projection,
                        anchor_context=context,
                        get_fuzzy_search_index=get_fuzzy_index,
                    )
                    result_index = len(results)
                    results.append(result)
                    if context is not None:
                        if comment_commit not in groups:
                            groups[comment_commit] = ([], [], context)
                        groups[comment_commit][0].append(comment)
                        groups[comment_commit][1].append(result_index)
                    continue

                results.append(
                    reanchor_comment(
                        comment,
                        document_lines,
                        threshold=threshold,
                        get_fuzzy_search_index=get_fuzzy_index,
                    )
                )

            for comments, indexes, context in groups.values():
                reconciled = reconcile_comment_anchors(
                    comments, [results[index] for index in indexes], context
                )
                for offset, result_index in enumerate(indexes):
                    results[result_index] = reconciled[offset]
            return results

    # No git — pure text-based
    for comment in doc.comments:
        results.append(
            reanchor_comment(
                comment,
                document_lines,
                threshold=threshold,
                get_fuzzy_search_index=get_fuzzy_index,
            )
        )

    return results


def apply_reanchor_results(
    doc: MrsfDocument,
    results: list[ReanchorResult],
    *,
    update_text: bool = False,
    force: bool = False,
    head_commit: str | None = None,
) -> int:
    """Apply re-anchor results to the document. Returns number of changed comments."""
    changed = 0
    result_map = {r.comment_id: r for r in results}

    for comment in doc.comments:
        result = result_map.get(comment.id)
        if not result:
            continue

        is_changed = False

        if result.new_line is not None and result.new_line != comment.line:
            comment.line = result.new_line
            is_changed = True
        if result.new_end_line is not None and result.new_end_line != comment.end_line:
            comment.end_line = result.new_end_line
            is_changed = True
        if result.new_start_column is not None and result.new_start_column != comment.start_column:
            comment.start_column = result.new_start_column
            is_changed = True
        if result.new_end_column is not None and result.new_end_column != comment.end_column:
            comment.end_column = result.new_end_column
            is_changed = True

        if result.anchored_text is not None and result.anchored_text != comment.selected_text:
            if update_text:
                comment.selected_text = result.anchored_text
                comment.anchored_text = None
            else:
                comment.anchored_text = result.anchored_text
            is_changed = True
        elif result.anchored_text is not None and result.anchored_text == comment.selected_text:
            if comment.anchored_text:
                comment.anchored_text = None
                is_changed = True

        if is_changed or result.status != "anchored":
            comment.extra["x_reanchor_status"] = result.status
            comment.extra["x_reanchor_score"] = result.score

        if (
            force
            and head_commit
            and result.status in ("anchored", "shifted")
            and result.score >= HIGH_THRESHOLD
        ):
            comment.commit = head_commit
            comment.extra.pop("x_reanchor_status", None)
            comment.extra.pop("x_reanchor_score", None)
            if comment.anchored_text and comment.anchored_text == comment.selected_text:
                comment.anchored_text = None
            is_changed = True

        if is_changed:
            changed += 1

    return changed


def reanchor_file(
    sidecar_path: str,
    opts: ReanchorOptions | None = None,
) -> tuple[list[ReanchorResult], int, bool]:
    """High-level re-anchor for a single sidecar file path.

    Returns (results, changed_count, was_written).
    """
    if opts is None:
        opts = ReanchorOptions()

    doc = parse_sidecar(sidecar_path)
    doc_path = sidecar_to_document(sidecar_path)
    document_lines = read_document_lines(doc_path)

    effective_repo_root = find_repo_root(opts.cwd) if not opts.no_git else None
    head_commit = get_current_commit(effective_repo_root) if effective_repo_root else None

    results = reanchor_document(
        doc,
        document_lines,
        opts,
        document_path=doc_path,
        repo_root=effective_repo_root,
    )

    changed = 0
    written = False

    if not opts.dry_run:
        changed = apply_reanchor_results(
            doc,
            results,
            update_text=opts.update_text,
            force=opts.force,
            head_commit=head_commit,
        )
        if changed > 0 or opts.auto_update:
            write_sidecar(sidecar_path, doc)
            written = True

    return results, changed, written


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _extract_text(
    lines: list[str],
    line: int,
    end_line: int | None = None,
    start_column: int | None = None,
    end_column: int | None = None,
) -> str | None:
    """Extract text from document lines at the given position (1-based array)."""
    start_idx = line
    end_idx = end_line if end_line is not None else line

    if start_idx < 1 or end_idx >= len(lines):
        return None

    if start_idx == end_idx:
        text = lines[start_idx]
        if start_column is not None and end_column is not None:
            return text[start_column:end_column]
        return text

    result: list[str] = []
    for i in range(start_idx, end_idx + 1):
        text = lines[i]
        if i == start_idx and start_column is not None:
            text = text[start_column:]
        if i == end_idx and end_column is not None:
            text = text[:end_column]
        result.append(text)
    return "\n".join(result)


def _closest_to_line(candidates: list[Any], target_line: int) -> Any:
    """Pick the candidate closest to a hint line."""
    return min(candidates, key=lambda c: abs(c.line - target_line))


def to_reanchor_lines(document_text: str) -> list[str]:
    """Normalize line endings and return the internal 1-based line array."""
    return ["", *document_text.replace("\r\n", "\n").split("\n")]


def _is_implausible_exact_relocation(
    comment: Comment,
    candidate: Any,
    lines: list[str],
    proximity_window: int,
) -> bool:
    if comment.line is None or comment.line <= 0 or comment.line >= len(lines):
        return False
    if abs(candidate.line - comment.line) <= proximity_window:
        return False
    return (
        _extract_text(
            lines,
            comment.line,
            comment.end_line,
            comment.start_column,
            comment.end_column,
        )
        != comment.selected_text
    )
