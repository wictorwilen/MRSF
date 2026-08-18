"""Run the language-neutral re-anchoring corpus against the Python port."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from mrsf.anchor_context import create_anchor_context_index
from mrsf.global_reconciliation import reconcile_comment_anchors
from mrsf.reanchor import reanchor_comment, to_reanchor_lines
from mrsf.revision_projection import create_revision_projection
from mrsf.types import Comment, ReanchorResult

CASES_ROOT = Path(__file__).parents[2] / "evaluation" / "reanchor" / "cases"


def test_shared_reanchor_corpus() -> None:
    failures: list[str] = []
    comments_evaluated = 0
    for case_path in sorted(CASES_ROOT.rglob("*.json")):
        parsed = json.loads(case_path.read_text())
        cases = parsed if isinstance(parsed, list) else [parsed]
        for case in cases:
            source = _document_text(case["source"], case_path)
            target = _document_text(case["target"], case_path)
            source_lines = to_reanchor_lines(source)
            target_lines = to_reanchor_lines(target)
            projection = create_revision_projection(source_lines, target_lines)
            context = create_anchor_context_index(source_lines, target_lines)
            comments = [_comment(value) for value in case["comments"]]
            results = [
                reanchor_comment(
                    comment,
                    target_lines,
                    revision_projection=projection,
                    anchor_context=context,
                )
                for comment in comments
            ]
            results = reconcile_comment_anchors(comments, results, context)
            for value, comment, result in zip(case["comments"], comments, results, strict=True):
                comments_evaluated += 1
                expected = value["expected"]
                if result.status != expected["status"] or not _range_matches(
                    result, comment, expected.get("ranges")
                ):
                    failures.append(
                        f"{case['id']}/{value['id']}: expected {expected}, "
                        f"received {result}"
                    )
    assert comments_evaluated == 80
    assert failures == []


def _document_text(value: dict[str, str], case_path: Path) -> str:
    if "text" in value:
        return value["text"]
    return (case_path.parent / value["path"]).read_text()


def _comment(value: dict[str, Any]) -> Comment:
    anchor = value["anchor"]
    return Comment(
        id=value["id"],
        author="evaluation",
        timestamp="2025-01-01T00:00:00Z",
        text="Evaluation comment",
        resolved=False,
        line=anchor.get("line"),
        end_line=anchor.get("end_line"),
        start_column=anchor.get("start_column"),
        end_column=anchor.get("end_column"),
        selected_text=anchor.get("selected_text"),
        commit=anchor.get("commit"),
    )


def _range_matches(
    result: ReanchorResult,
    comment: Comment,
    ranges: list[dict[str, int]] | None,
) -> bool:
    if not ranges:
        return True
    line = result.new_line if result.new_line is not None else comment.line
    end_line = result.new_end_line if result.new_end_line is not None else comment.end_line
    start = (
        result.new_start_column
        if result.new_start_column is not None
        else comment.start_column
    )
    end = result.new_end_column if result.new_end_column is not None else comment.end_column
    return any(
        line == expected["line"]
        and ("end_line" not in expected or end_line == expected["end_line"])
        and (
            "start_column" not in expected
            or start == expected["start_column"]
        )
        and ("end_column" not in expected or end == expected["end_column"])
        for expected in ranges
    )
