"""Tests for the git integration module — 1:1 match with git.test.ts."""

from mrsf.git import get_line_shift, parse_diff_hunks
from mrsf.types import DiffHunk


# ---------------------------------------------------------------------------
# parseDiffHunks
# ---------------------------------------------------------------------------


class TestParseDiffHunks:
    def test_parses_a_simple_unified_diff(self):
        diff = (
            "diff --git a/file.md b/file.md\n"
            "index abc..def 100644\n"
            "--- a/file.md\n"
            "+++ b/file.md\n"
            "@@ -3,0 +4,2 @@ some context\n"
            "+inserted line 1\n"
            "+inserted line 2\n"
            "@@ -10,1 +13,1 @@ more context\n"
            "-old line\n"
            "+new line"
        )

        hunks = parse_diff_hunks(diff)
        assert len(hunks) == 2

        assert hunks[0].old_start == 3
        assert hunks[0].old_count == 0
        assert hunks[0].new_start == 4
        assert hunks[0].new_count == 2

        assert hunks[1].old_start == 10
        assert hunks[1].old_count == 1
        assert hunks[1].new_start == 13
        assert hunks[1].new_count == 1

    def test_returns_empty_for_no_hunks(self):
        assert parse_diff_hunks("") == []


# ---------------------------------------------------------------------------
# getLineShift
# ---------------------------------------------------------------------------


class TestGetLineShift:
    # 2 lines inserted at old line 3
    hunks = [DiffHunk(old_start=3, old_count=0, new_start=4, new_count=2, lines=[])]

    def test_returns_0_shift_for_lines_before_the_hunk(self):
        shift, modified = get_line_shift(self.hunks, 1)
        assert shift == 0
        assert modified is False

    def test_returns_positive_shift_for_lines_after_insertion(self):
        shift, modified = get_line_shift(self.hunks, 5)
        assert shift == 2
        assert modified is False

    def test_handles_deletion_hunks(self):
        delete_hunks = [DiffHunk(old_start=5, old_count=3, new_start=5, new_count=0, lines=[])]
        shift, modified = get_line_shift(delete_hunks, 10)
        assert shift == -3
        assert modified is False

    def test_marks_modified_lines(self):
        mod_hunks = [DiffHunk(old_start=5, old_count=2, new_start=5, new_count=2, lines=[])]
        shift, modified = get_line_shift(mod_hunks, 5)
        assert modified is True

    def test_handles_multiple_hunks_cumulatively(self):
        multi_hunks = [
            DiffHunk(old_start=2, old_count=0, new_start=2, new_count=1, lines=[]),  # +1
            DiffHunk(old_start=5, old_count=0, new_start=6, new_count=2, lines=[]),  # +2
        ]
        shift, modified = get_line_shift(multi_hunks, 10)
        assert shift == 3
        assert modified is False
