"""Tests for the re-anchor engine — 1:1 match with reanchor.test.ts."""

import os
from unittest.mock import patch

from mrsf.reanchor import (
    _extract_text,
    apply_reanchor_results,
    reanchor_comment,
    reanchor_document,
    reanchor_file,
)
from mrsf.types import Comment, DiffHunk, MrsfDocument, ReanchorOptions, ReanchorResult


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

    def test_matches_multiline_selection_with_blank_edges(self):
        blank_edge_lines = lines1(
            "# Title",
            "intro",
            "",
            "text text",
            "",
            "tail",
        )
        comment = make_comment(
            selected_text="\ntext text\n",
            line=7,
            end_line=9,
        )

        result = reanchor_comment(comment, blank_edge_lines)

        assert result.status == "anchored"
        assert result.new_line == 3
        assert result.new_end_line == 5


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


# ---------------------------------------------------------------------------
# Step 0: Diff-based shift — additional tests
# ---------------------------------------------------------------------------


class TestReanchorCommentDiffShiftExtended:
    def test_line_only_no_shift(self):
        # Line-only comment, diff confirms position unchanged
        lines = lines1("first", "second", "third")
        comment = make_comment(line=2)  # no selected_text
        hunks = [DiffHunk(old_start=5, old_count=0, new_start=5, new_count=1, lines=[])]
        result = reanchor_comment(comment, lines, diff_hunks=hunks)
        assert result.status == "anchored"
        assert result.score == 1.0

    def test_line_only_shifted(self):
        lines = lines1("first", "inserted", "second", "third")
        comment = make_comment(line=2)  # no selected_text
        hunks = [DiffHunk(old_start=2, old_count=0, new_start=2, new_count=1, lines=["+inserted"])]
        result = reanchor_comment(comment, lines, diff_hunks=hunks)
        assert result.status == "shifted"
        assert result.new_line == 3

    def test_end_line_span_shifts(self):
        lines = lines1("a", "inserted", "b", "c", "d")
        comment = make_comment(line=2, end_line=4)  # no selected_text, spans 3 lines
        hunks = [DiffHunk(old_start=2, old_count=0, new_start=2, new_count=1, lines=["+inserted"])]
        result = reanchor_comment(comment, lines, diff_hunks=hunks)
        assert result.status == "shifted"
        assert result.new_line == 3
        assert result.new_end_line == 5  # preserves span

    def test_falls_through_when_selected_text_mismatches_after_shift(self):
        lines = lines1("first", "inserted", "CHANGED TEXT", "third")
        comment = make_comment(line=2, selected_text="original text")
        hunks = [DiffHunk(old_start=2, old_count=0, new_start=2, new_count=1, lines=["+inserted"])]
        result = reanchor_comment(comment, lines, diff_hunks=hunks)
        # Falls through to next steps since text doesn't match at shifted position
        assert result.status != "shifted" or result.score < 1.0

    def test_multi_line_with_columns_shift(self):
        lines = lines1("foo", "inserted", "Hello World", "bar baz end")
        comment = make_comment(
            line=2, end_line=3, start_column=6, end_column=7,
            selected_text="World\nbar baz",
        )
        hunks = [DiffHunk(old_start=2, old_count=0, new_start=2, new_count=1, lines=["+inserted"])]
        result = reanchor_comment(comment, lines, diff_hunks=hunks)
        assert result.status == "shifted"
        assert result.new_line == 3
        assert result.new_end_line == 4


# ---------------------------------------------------------------------------
# Step 1.5: Normalized whitespace match
# ---------------------------------------------------------------------------


class TestReanchorCommentNormalizedMatch:
    def test_single_normalized_whitespace_match(self):
        # One-line doc: normalizedMatch returns exactly 1 candidate
        lines = lines1("function   foo(  bar  ) {")
        comment = make_comment(selected_text="function foo( bar ) {", line=10)
        result = reanchor_comment(comment, lines)
        assert result.status == "fuzzy"
        assert result.score == 0.95
        assert result.new_line == 1

    def test_high_threshold_fuzzy_match(self):
        lines = lines1(
            "# Title",
            "",
            "The quick brown fox jumps over the lazy dog.",
            "Other content.",
        )
        comment = make_comment(
            selected_text="The quick brown fox jumps over the lazy dogs.",  # slight diff
            line=10,
        )
        result = reanchor_comment(comment, lines)
        assert result.status == "fuzzy"
        assert result.score > 0.8


# ---------------------------------------------------------------------------
# Step 2: Line/column fallback
# ---------------------------------------------------------------------------


class TestReanchorCommentLineFallback:
    def test_uses_single_line_fuzzy_matching_before_plain_line_fallback(self):
        lines = lines1(
            "header",
            "The rough revised sentence that should still resemble the candidate after edits.",
            "footer",
        )
        comment = make_comment(
            selected_text="The precise original sentence that should only weakly resemble the candidate after edits.",
            line=2,
        )

        result = reanchor_comment(comment, lines, commit_is_stale=True)

        assert result.status == "fuzzy"
        assert result.new_line == 2
        assert result.reason is not None
        assert "Line-fallback with fuzzy text match" in result.reason

    def test_line_only_no_selected_text_returns_anchored(self):
        lines = lines1("first", "second", "third")
        comment = make_comment(line=2)
        result = reanchor_comment(comment, lines)
        assert result.status == "anchored"
        assert result.new_line == 2

    def test_stale_commit_returns_ambiguous(self):
        lines = lines1("AAAA", "BBBB", "CCCC")
        comment = make_comment(
            line=2,
            selected_text="ZZZZZZZZZZZ totally unrelated very long text",
        )
        result = reanchor_comment(comment, lines, commit_is_stale=True)
        assert result.status == "ambiguous"
        assert result.score == 0.5
        assert result.reason is not None
        assert "stale" in result.reason

    def test_non_stale_line_fallback(self):
        lines = lines1("AAAA", "BBBB", "CCCC")
        comment = make_comment(
            line=2,
            selected_text="ZZZZZZZZZZZZZZZZZ completely unrelated very long text",
        )
        result = reanchor_comment(comment, lines, commit_is_stale=False)
        assert result.status == "anchored"
        assert result.score == 0.8
        assert result.reason is not None
        assert "Line/column fallback" in result.reason


# ---------------------------------------------------------------------------
# Step 3: Lower-threshold fuzzy search
# ---------------------------------------------------------------------------


class TestReanchorCommentLowFuzzy:
    def test_single_fuzzy_match_with_long_string(self):
        # Use string >= 200 chars to avoid substring matching
        long_needle = "The implementation of the advanced caching mechanism provides significant performance improvements to the overall system architecture while maintaining backward compatibility with existing clients " + "x" * 10
        long_line = "The implementation of the advanced caching mechanism provided significant performance improvements to the overall system architecture while maintaining backward compatibility with existing clientsss " + "x" * 10
        lines = lines1("# Title", "", long_line, "Other content")
        comment = make_comment(selected_text=long_needle, line=999)
        result = reanchor_comment(comment, lines, threshold=0.5)
        assert result.status == "fuzzy"
        assert result.new_line == 3

    def test_ambiguous_multiple_matches(self):
        # Strings >= 200 chars that are similar but not exactly matching the needle
        base = "The implementation of the advanced caching mechanism provides significant performance improvements to the overall system architecture while maintaining backward compatibility with existing client applications and third-party integrations"
        similar1 = base.replace("advanced", "improved")
        similar2 = base.replace("advanced", "enhanced")
        needle = base.replace("advanced", "upgraded")
        lines = lines1("# Title", similar1, "gap", similar2)
        comment = make_comment(selected_text=needle, line=999)
        result = reanchor_comment(comment, lines, threshold=0.5)
        assert result.status in ("fuzzy", "ambiguous")


# ---------------------------------------------------------------------------
# reanchor_document
# ---------------------------------------------------------------------------


class TestReanchorDocument:
    def test_batch_reanchor_no_git(self):
        lines = lines1("# Title", "", "Unique text to find.", "Other content.")
        comments = [
            make_comment(id="c1", selected_text="Unique text to find.", line=10),
            make_comment(id="c2"),  # doc-level
        ]
        doc = make_doc(comments)
        opts = ReanchorOptions(no_git=True)
        results = reanchor_document(doc, lines, opts)
        assert len(results) == 2
        assert results[0].status == "anchored"
        assert results[1].status == "anchored"

    def test_custom_threshold(self):
        lines = lines1("# Title", "Some text.")
        comments = [
            make_comment(id="c1", selected_text="Totally different content that doesn't match.", line=5),
        ]
        doc = make_doc(comments)
        opts = ReanchorOptions(no_git=True, threshold=0.99)
        results = reanchor_document(doc, lines, opts)
        assert len(results) == 1
        # With impossible threshold, should be orphaned
        assert results[0].status == "orphaned"

    def test_empty_comments(self):
        lines = lines1("# Title")
        doc = make_doc([])
        opts = ReanchorOptions(no_git=True)
        results = reanchor_document(doc, lines, opts)
        assert len(results) == 0


# ---------------------------------------------------------------------------
# reanchor_file
# ---------------------------------------------------------------------------


class TestReanchorFile:
    def test_dry_run_does_not_write(self, tmp_path):
        sidecar = tmp_path / "doc.md.review.yaml"
        sidecar.write_text(
            "mrsf_version: '1.0'\n"
            "document: doc.md\n"
            "comments:\n"
            "  - id: c-1\n"
            "    author: Alice\n"
            "    timestamp: '2025-01-01T00:00:00Z'\n"
            "    text: Fix this\n"
            "    resolved: false\n"
            "    line: 1\n"
            "    selected_text: '# Hello'\n",
            encoding="utf-8",
        )
        doc_file = tmp_path / "doc.md"
        doc_file.write_text("# Hello\nWorld\n", encoding="utf-8")

        opts = ReanchorOptions(dry_run=True, no_git=True)
        results, changed, written = reanchor_file(str(sidecar), opts)
        assert len(results) == 1
        assert written is False

    def test_writes_changes_when_not_dry_run(self, tmp_path):
        sidecar = tmp_path / "doc.md.review.yaml"
        sidecar.write_text(
            "mrsf_version: '1.0'\n"
            "document: doc.md\n"
            "comments:\n"
            "  - id: c-1\n"
            "    author: Alice\n"
            "    timestamp: '2025-01-01T00:00:00Z'\n"
            "    text: Fix this\n"
            "    resolved: false\n"
            "    line: 5\n"
            "    selected_text: '# Hello'\n",
            encoding="utf-8",
        )
        doc_file = tmp_path / "doc.md"
        doc_file.write_text("# Hello\nWorld\n", encoding="utf-8")

        opts = ReanchorOptions(dry_run=False, no_git=True)
        results, changed, written = reanchor_file(str(sidecar), opts)
        assert len(results) == 1
        # Comment line was 5 but exact match is at line 1 → changed
        assert changed >= 1
        assert written is True

    def test_reanchors_blank_edge_multiline_selection(self, tmp_path):
        sidecar = tmp_path / "doc.md.review.yaml"
        sidecar.write_text(
            "mrsf_version: '1.0'\n"
            "document: doc.md\n"
            "comments:\n"
            "  - id: c-1\n"
            "    author: Alice\n"
            "    timestamp: '2025-01-01T00:00:00Z'\n"
            "    text: Fix this\n"
            "    resolved: false\n"
            "    line: 7\n"
            "    end_line: 9\n"
            "    selected_text: |\n"
            "      \n"
            "      text text\n"
            "\n",
            encoding="utf-8",
        )
        doc_file = tmp_path / "doc.md"
        doc_file.write_text("# Title\nintro\n\ntext text\n\ntail\n", encoding="utf-8")

        opts = ReanchorOptions(dry_run=False, no_git=True)
        results, changed, written = reanchor_file(str(sidecar), opts)

        assert len(results) == 1
        assert results[0].status == "anchored"
        assert results[0].new_line == 3
        assert results[0].new_end_line == 5
        assert changed >= 1
        assert written is True


# ---------------------------------------------------------------------------
# apply_reanchor_results — additional tests
# ---------------------------------------------------------------------------


class TestApplyReanchorResultsExtended:
    def test_updates_columns(self):
        comment = make_comment(id="c1", line=3, start_column=0, end_column=5, selected_text="hello")
        doc = make_doc([comment])
        results = [ReanchorResult(
            comment_id="c1", status="anchored", score=1.0,
            new_line=3, new_start_column=10, new_end_column=15,
            reason="Exact match at new column",
        )]
        changed = apply_reanchor_results(doc, results)
        assert changed == 1
        assert comment.start_column == 10
        assert comment.end_column == 15

    def test_update_text_mode(self):
        comment = make_comment(
            id="c1", line=3, selected_text="old text",
        )
        doc = make_doc([comment])
        results = [ReanchorResult(
            comment_id="c1", status="fuzzy", score=0.9,
            new_line=4, anchored_text="new text",
            reason="Fuzzy match",
        )]
        changed = apply_reanchor_results(doc, results, update_text=True)
        assert changed == 1
        assert comment.selected_text == "new text"
        assert comment.anchored_text is None

    def test_sets_anchored_text_when_not_update_text(self):
        comment = make_comment(
            id="c1", line=3, selected_text="old text",
        )
        doc = make_doc([comment])
        results = [ReanchorResult(
            comment_id="c1", status="fuzzy", score=0.9,
            new_line=4, anchored_text="new text",
            reason="Fuzzy match",
        )]
        changed = apply_reanchor_results(doc, results, update_text=False)
        assert changed == 1
        assert comment.selected_text == "old text"
        assert comment.anchored_text == "new text"

    def test_skips_unmatched_comment(self):
        comment = make_comment(id="c1", line=5)
        doc = make_doc([comment])
        results = [ReanchorResult(
            comment_id="other", status="anchored", score=1.0, reason="",
        )]
        changed = apply_reanchor_results(doc, results)
        assert changed == 0

    def test_clears_anchored_text_when_same_as_selected_text(self):
        comment = make_comment(
            id="c1", line=3, selected_text="same text", anchored_text="same text",
        )
        doc = make_doc([comment])
        results = [ReanchorResult(
            comment_id="c1", status="anchored", score=1.0,
            anchored_text="same text",
            reason="Exact match",
        )]
        changed = apply_reanchor_results(doc, results)
        assert changed == 1
        assert comment.anchored_text is None


# ---------------------------------------------------------------------------
# _extract_text
# ---------------------------------------------------------------------------


class TestExtractText:
    def test_single_line(self):
        lines = lines1("line 1", "line 2", "line 3")
        assert _extract_text(lines, 2) == "line 2"

    def test_single_line_with_columns(self):
        lines = lines1("Hello World")
        assert _extract_text(lines, 1, 1, 6, 11) == "World"

    def test_multi_line(self):
        lines = lines1("aaa", "bbb", "ccc")
        result = _extract_text(lines, 1, 3)
        assert result == "aaa\nbbb\nccc"

    def test_multi_line_with_columns(self):
        lines = lines1("Hello World", "Middle", "End Part")
        result = _extract_text(lines, 1, 3, 6, 3)
        assert result == "World\nMiddle\nEnd"

    def test_returns_none_for_out_of_bounds(self):
        lines = lines1("only one line")
        assert _extract_text(lines, 0) is None  # line < 1
        assert _extract_text(lines, 5) is None  # beyond end


# ---------------------------------------------------------------------------
# Step 2: Line-fallback fuzzy on current line (line 207)
# NOTE: Line 207 is unreachable — fuzzy_search([line_text], ...) passes a
# 1-element list, but fuzzy_search iterates from index 1 (1-based convention).
# With len(lines)=1, no window or substring matches are produced.
# ---------------------------------------------------------------------------


# ---------------------------------------------------------------------------
# Step 3: Low-threshold fuzzy (lines 247-248, 262-263)
# ---------------------------------------------------------------------------


class TestReanchorCommentStep3LowFuzzy:
    """Cover Step 3 branches: single and multiple low-threshold fuzzy matches."""

    # Calibrated strings: combined_score ≈ 0.62, below HIGH_THRESHOLD (0.8)
    NEEDLE = (
        "The implementation of the advanced caching mechanism provides significant "
        "performance improvements to the overall system architecture while maintaining "
        "backward compatibility with existing clients and services in production environments"
    )
    CANDIDATE = (
        "Our development of the modern caching strategy delivers moderate scalability "
        "improvements to the overall system architecture while providing forward "
        "compatibility with current clients and services in staging environments"
    )
    CANDIDATE2 = (
        "Their development of the modern caching strategy delivers moderate scalability "
        "improvements to the overall system architecture while providing forward "
        "compatibility with current clients and services in staging environments"
    )

    def test_single_low_threshold_fuzzy_match(self):
        """Cover lines 247-248: exactly one low-threshold match."""
        lines = lines1("some header", self.CANDIDATE, "footer line")
        comment = make_comment(
            line=999,  # out of bounds so Step 2 is skipped
            selected_text=self.NEEDLE,
        )
        result = reanchor_comment(comment, lines)
        assert result.status == "fuzzy"
        assert result.new_line == 2

    def test_multiple_low_threshold_fuzzy_matches(self):
        """Cover lines 262-263: multiple low-threshold matches → ambiguous."""
        lines = lines1(self.CANDIDATE, "gap", self.CANDIDATE2)
        comment = make_comment(
            line=999,
            selected_text=self.NEEDLE,
        )
        result = reanchor_comment(comment, lines)
        assert result.status == "ambiguous"


# ---------------------------------------------------------------------------
# reanchor_document — git-aware path (lines 305-328)
# ---------------------------------------------------------------------------


class TestReanchorDocumentGitAware:
    """Cover the git-aware batch reanchoring path."""

    @patch("mrsf.reanchor.get_diff")
    @patch("mrsf.reanchor.get_current_commit")
    @patch("mrsf.reanchor.find_repo_root")
    @patch("mrsf.reanchor.is_git_available")
    def test_git_aware_with_stale_commit(self, mock_avail, mock_root, mock_head, mock_diff):
        mock_avail.return_value = True
        mock_root.return_value = "/repo"
        mock_head.return_value = "new-head-sha"
        mock_diff.return_value = []  # no diff hunks

        lines = lines1("# Title", "Some text here.")
        comment = make_comment(id="c1", line=2, selected_text="Some text here.", commit="old-sha")
        doc = make_doc([comment])
        results = reanchor_document(
            doc, lines,
            document_path="/repo/doc.md",
            repo_root="/repo",
        )
        assert len(results) == 1
        mock_diff.assert_called_once()

    @patch("mrsf.reanchor.get_current_commit")
    @patch("mrsf.reanchor.find_repo_root")
    @patch("mrsf.reanchor.is_git_available")
    def test_git_aware_same_commit_no_diff(self, mock_avail, mock_root, mock_head):
        """Cover line 328: comment commit == head → no diff needed."""
        mock_avail.return_value = True
        mock_root.return_value = "/repo"
        mock_head.return_value = "same-sha"

        lines = lines1("# Title", "Some text here.")
        comment = make_comment(id="c1", line=2, selected_text="Some text here.", commit="same-sha")
        doc = make_doc([comment])
        results = reanchor_document(
            doc, lines,
            document_path="/repo/doc.md",
            repo_root="/repo",
        )
        assert len(results) == 1
        assert results[0].status == "anchored"

    @patch("mrsf.reanchor.get_diff")
    @patch("mrsf.reanchor.get_current_commit")
    @patch("mrsf.reanchor.find_repo_root")
    @patch("mrsf.reanchor.is_git_available")
    def test_git_aware_uses_from_commit_option(self, mock_avail, mock_root, mock_head, mock_diff):
        mock_avail.return_value = True
        mock_root.return_value = "/repo"
        mock_head.return_value = "head-sha"
        mock_diff.return_value = []

        lines = lines1("# Title", "Text line")
        comment = make_comment(id="c1", line=2, selected_text="Text line")
        doc = make_doc([comment])
        opts = ReanchorOptions(from_commit="override-sha")
        results = reanchor_document(
            doc, lines, opts,
            document_path="/repo/doc.md",
            repo_root="/repo",
        )
        assert len(results) == 1
        # get_diff should be called with override-sha, not comment.commit
        mock_diff.assert_called_once_with("override-sha", "head-sha", "doc.md", "/repo")


# ---------------------------------------------------------------------------
# reanchor_document — default opts (line 299)
# ---------------------------------------------------------------------------


class TestReanchorDocumentDefaultOpts:
    """Cover line 299: opts defaults to ReanchorOptions()."""

    @patch("mrsf.reanchor.is_git_available", return_value=False)
    def test_works_without_explicit_opts(self, mock_git):
        lines = lines1("# Title", "content")
        doc = make_doc([make_comment(id="c1")])
        results = reanchor_document(doc, lines)
        assert len(results) == 1


# ---------------------------------------------------------------------------
# reanchor_file — default opts (line 413)
# ---------------------------------------------------------------------------


class TestReanchorFileDefaultOpts:
    """Cover line 413: opts defaults to ReanchorOptions()."""

    @patch("mrsf.reanchor.is_git_available", return_value=False)
    @patch("mrsf.reanchor.find_repo_root", return_value=None)
    def test_works_without_explicit_opts(self, mock_root, mock_git, tmp_path):
        sidecar = tmp_path / "doc.md.review.yaml"
        sidecar.write_text(
            "mrsf_version: '1.0'\n"
            "document: doc.md\n"
            "comments:\n"
            "  - id: c-1\n"
            "    author: Alice\n"
            "    timestamp: '2025-01-01T00:00:00Z'\n"
            "    text: Fix this\n"
            "    resolved: false\n",
            encoding="utf-8",
        )
        doc_file = tmp_path / "doc.md"
        doc_file.write_text("# Hello\n", encoding="utf-8")
        results, changed, written = reanchor_file(str(sidecar))
        assert len(results) == 1


# ---------------------------------------------------------------------------
# reanchor_file — auto_update path
# ---------------------------------------------------------------------------


class TestReanchorFileAutoUpdate:
    @patch("mrsf.reanchor.is_git_available", return_value=False)
    @patch("mrsf.reanchor.find_repo_root", return_value=None)
    def test_auto_update_writes_even_without_changes(self, mock_root, mock_git, tmp_path):
        sidecar = tmp_path / "doc.md.review.yaml"
        sidecar.write_text(
            "mrsf_version: '1.0'\n"
            "document: doc.md\n"
            "comments:\n"
            "  - id: c-1\n"
            "    author: Alice\n"
            "    timestamp: '2025-01-01T00:00:00Z'\n"
            "    text: Fix this\n"
            "    resolved: false\n"
            "    line: 1\n"
            "    selected_text: '# Hello'\n",
            encoding="utf-8",
        )
        doc_file = tmp_path / "doc.md"
        doc_file.write_text("# Hello\n", encoding="utf-8")
        opts = ReanchorOptions(dry_run=False, no_git=True, auto_update=True)
        results, changed, written = reanchor_file(str(sidecar), opts)
        assert written is True
