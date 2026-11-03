"""UTF-16 column conformance across anchor producers and consumers."""

from mrsf.anchor_context import create_anchor_context_index, resolve_context_anchor
from mrsf.fuzzy import exact_match, fuzzy_search, normalized_match
from mrsf.reanchor import _extract_text
from mrsf.revision_projection import create_revision_projection, project_comment_anchor
from mrsf.text import utf16_length, utf16_slice
from mrsf.types import Comment


def make_comment(selected_text: str = "foo") -> Comment:
    return Comment(
        id="unicode", author="tester", timestamp="2026-01-01T00:00:00Z",
        text="Review", resolved=False, line=2, start_column=3, end_column=6,
        selected_text=selected_text,
    )


def test_utf16_string_operations():
    assert utf16_length("\U0001f600 foo") == 6
    assert utf16_slice("\U0001f600 foo", 3, 6) == "foo"
    assert utf16_slice("\U0001f600 foo", end=2) == "\U0001f600"
    assert utf16_slice("\U0001f600 foo", 3) == "foo"
    assert utf16_length("e\u0301\t") == 3


def test_exact_and_normalized_candidates_use_utf16():
    lines = ["", "\U0001f600 foo"]
    candidate = exact_match(lines, "foo")[0]
    assert (candidate.start_column, candidate.end_column) == (3, 6)
    candidate = normalized_match(lines, "\U0001f600  foo")[0]
    assert candidate.end_column == 6
    candidate = exact_match(["", "\U0001f600 first", "\U00020000 last"], "first\n\U00020000 l")[0]
    assert (candidate.start_column, candidate.end_column) == (3, 4)


def test_fuzzy_candidates_use_utf16():
    candidates = fuzzy_search(["", "\U0001f600 food"], "foo", threshold=0.1)
    exact = next(candidate for candidate in candidates if candidate.text == "foo")
    assert (exact.start_column, exact.end_column) == (3, 6)
    whole = next(candidate for candidate in candidates if candidate.text == "\U0001f600 food")
    assert whole.end_column == 7


def test_fallback_extracts_utf16_columns():
    assert _extract_text(["", "\U0001f600 foo"], 1, start_column=3, end_column=6) == "foo"
    assert _extract_text(
        ["", "\U0001f600 first", "\U00020000 last"], 1, 2, 3, 4,
    ) == "first\n\U00020000 l"


def test_source_verified_context_preserves_utf16_columns():
    lines = ["", "# Heading", "\U0001f600 foo"]
    result = resolve_context_anchor(make_comment(), create_anchor_context_index(lines, lines))
    assert result is not None
    assert result.status == "anchored"
    assert (result.start_column, result.end_column) == (3, 6)


def test_context_relocation_produces_utf16_columns():
    source = ["", "# Heading", "\U0001f600 foo"]
    target = ["", "# Heading", "new context", "\U0001f600 foo"]
    result = resolve_context_anchor(make_comment(), create_anchor_context_index(source, target))
    assert result is not None
    assert (result.line, result.start_column, result.end_column) == (3, 3, 6)


def test_revision_projection_slices_and_emits_utf16():
    source = ["", "# Heading", "\U0001f600 foo bar", "after"]
    target = ["", "# Heading", "\U0001f600 food baz", "after"]
    comment = make_comment("foo bar")
    comment.end_column = 10
    result = project_comment_anchor(comment, create_revision_projection(source, target), 0.3)
    assert result is not None
    assert result.text == "food baz"
    assert (result.start_column, result.end_column) == (3, 11)
