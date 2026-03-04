"""Tests for the re-anchor engine — 1:1 match with reanchor.test.ts."""

from mrsf.reanchor import apply_reanchor_results, reanchor_comment
from mrsf.types import Comment, DiffHunk, MrsfDocument, ReanchorResult


def lines1(*content: str) -> list[str]:
    """Make a 1-based line array (index 0 is unused)."""
    return ["", *content]


def make_comment(**overrides) -> Comment:
    defaults = dict(
        id="test-001",
        author="tester",
        timestamp="2025-01-01T00:00:00Z",
        text="Fix this",
        resolved=False,
    )
    defaults.update(overrides)
    return Comment(**defaults)


def make_doc(comments: list[Comment]) -> MrsfDocument:
    return MrsfDocument(mrsf_version="1.0", document="test.md", comments=comments)


# ---------------------------------------------------------------------------
# Step 0: Diff-based shift
# ---------------------------------------------------------------------------


class TestReanchorCommentDiffBased:
    lines = lines1(
        "line 1",
        "inserted",
        "line 2",
        "The selected text here",
        "line 4",
    )

    def test_shifts_line_correctly_with_diff_hunks(self):
        comment = make_comment(line=3, selected_text="The selected text here")
        hunks = [DiffHunk(old_start=2, old_count=0, new_start=2, new_count=1, lines=["+inserted"])]
        result = reanchor_comment(comment, self.lines, diff_hunks=hunks)
        assert result.status == "shifted"
        assert result.new_line == 4
        assert result.score == 1.0

    def test_marks_as_anchored_when_no_shift_needed(self):
        comment = make_comment(line=4, selected_text="The selected text here")
        result = reanchor_comment(comment, self.lines, diff_hunks=[])
        assert result.status == "anchored"


# ---------------------------------------------------------------------------
# Step 1: Exact match
# ---------------------------------------------------------------------------


class TestReanchorCommentExactMatch:
    lines = lines1(
        "# Title",
        "",
        "Unique text to find.",
        "Other content.",
    )

    def test_finds_unique_exact_match(self):
        comment = make_comment(selected_text="Unique text to find.", line=10)
        result = reanchor_comment(comment, self.lines)
        assert result.status == "anchored"
        assert result.new_line == 3
        assert result.score == 1.0

    def test_disambiguates_multiple_exact_matches_by_proximity(self):
        dupe_lines = lines1("the", "some stuff", "the", "other stuff", "the")
        comment = make_comment(selected_text="the", line=5)
        result = reanchor_comment(comment, dupe_lines)
        assert result.status == "anchored"
        assert result.new_line == 5


# ---------------------------------------------------------------------------
# Step 4: Orphan
# ---------------------------------------------------------------------------


class TestReanchorCommentOrphan:
    lines = lines1("# Title", "Some text.", "More text.")

    def test_marks_as_orphaned_when_nothing_matches(self):
        comment = make_comment(
            selected_text="This text does not exist anywhere in the document at all.",
            line=999,
        )
        result = reanchor_comment(comment, self.lines)
        assert result.status == "orphaned"
        assert result.score == 0


# ---------------------------------------------------------------------------
# Document-level
# ---------------------------------------------------------------------------


class TestReanchorCommentDocumentLevel:
    def test_returns_anchored_for_comments_without_anchor(self):
        comment = make_comment()  # no line, no selected_text
        result = reanchor_comment(comment, lines1("anything"))
        assert result.status == "anchored"
        assert "Document-level" in result.reason


# ---------------------------------------------------------------------------
# applyReanchorResults — --force flag
# ---------------------------------------------------------------------------


class TestApplyReanchorResultsForce:
    def test_updates_commit_to_head_and_clears_audit_fields_for_high_confidence_results(self):
        comment = make_comment(id="c1", line=5, commit="old-commit-abc", selected_text="Some text")
        doc = make_doc([comment])
        results = [ReanchorResult(
            comment_id="c1", status="shifted", score=1.0, new_line=7, reason="Shifted via diff",
        )]
        changed = apply_reanchor_results(doc, results, force=True, head_commit="new-head-def")
        assert changed == 1
        assert comment.line == 7
        assert comment.commit == "new-head-def"
        assert comment.extra.get("x_reanchor_status") is None
        assert comment.extra.get("x_reanchor_score") is None

    def test_does_not_force_anchor_low_confidence_results(self):
        comment = make_comment(id="c2", line=3, commit="old-commit", selected_text="Some text")
        doc = make_doc([comment])
        results = [ReanchorResult(
            comment_id="c2", status="fuzzy", score=0.7, new_line=4, reason="Fuzzy match",
        )]
        changed = apply_reanchor_results(doc, results, force=True, head_commit="new-head")
        assert changed == 1
        assert comment.line == 4
        assert comment.commit == "old-commit"
        assert comment.extra.get("x_reanchor_status") == "fuzzy"
        assert comment.extra.get("x_reanchor_score") == 0.7

    def test_does_not_force_anchor_orphaned_results(self):
        comment = make_comment(id="c3", line=10, commit="old-commit", selected_text="Gone text")
        doc = make_doc([comment])
        results = [ReanchorResult(
            comment_id="c3", status="orphaned", score=0, reason="No match found",
        )]
        changed = apply_reanchor_results(doc, results, force=True, head_commit="new-head")
        assert changed == 0
        assert comment.commit == "old-commit"
        assert comment.extra.get("x_reanchor_status") == "orphaned"

    def test_requires_head_commit_does_nothing_without_it_even_when_force_true(self):
        comment = make_comment(id="c4", line=5, commit="old-commit", selected_text="Text")
        doc = make_doc([comment])
        results = [ReanchorResult(
            comment_id="c4", status="anchored", score=1.0, reason="Exact match",
        )]
        changed = apply_reanchor_results(doc, results, force=True)
        assert changed == 0
        assert comment.commit == "old-commit"

    def test_clears_anchored_text_when_it_matches_selected_text_during_force(self):
        comment = make_comment(
            id="c5", line=3, commit="old-commit",
            selected_text="Hello world", anchored_text="Hello world",
        )
        doc = make_doc([comment])
        results = [ReanchorResult(
            comment_id="c5", status="anchored", score=1.0, reason="Exact match",
        )]
        changed = apply_reanchor_results(doc, results, force=True, head_commit="head-abc")
        assert changed == 1
        assert comment.commit == "head-abc"
        assert comment.anchored_text is None
        assert comment.extra.get("x_reanchor_status") is None

    def test_does_not_modify_when_force_false(self):
        comment = make_comment(id="c6", line=5, commit="old-commit", selected_text="Text")
        doc = make_doc([comment])
        results = [ReanchorResult(
            comment_id="c6", status="shifted", score=1.0, new_line=7, reason="Shifted",
        )]
        changed = apply_reanchor_results(doc, results, force=False)
        assert changed == 1
        assert comment.line == 7
        assert comment.commit == "old-commit"
        assert comment.extra.get("x_reanchor_status") == "shifted"
