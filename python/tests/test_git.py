"""Tests for the git integration module — 1:1 match with git.test.ts."""

import subprocess
from unittest.mock import MagicMock, patch

import pytest

from mrsf.git import (
    detect_renames,
    find_repo_root,
    get_current_commit,
    get_diff,
    get_file_at_commit,
    get_line_shift,
    get_staged_files,
    is_git_available,
    is_stale,
    parse_diff_hunks,
    reset_git_cache,
)
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

    def test_handles_implicit_count_of_1(self):
        diff = "@@ -5 +6 @@ context\n-removed\n+added"
        hunks = parse_diff_hunks(diff)
        assert len(hunks) == 1
        assert hunks[0].old_count == 1
        assert hunks[0].new_count == 1

    def test_collects_lines_in_hunk(self):
        diff = "@@ -1,2 +1,2 @@ ctx\n-old1\n-old2\n+new1\n+new2"
        hunks = parse_diff_hunks(diff)
        assert len(hunks[0].lines) == 4


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

    def test_returns_0_for_empty_hunks(self):
        shift, modified = get_line_shift([], 5)
        assert shift == 0
        assert modified is False


# ---------------------------------------------------------------------------
# is_git_available
# ---------------------------------------------------------------------------


class TestIsGitAvailable:
    def setup_method(self):
        reset_git_cache()

    def teardown_method(self):
        reset_git_cache()

    @patch("mrsf.git.subprocess.run")
    def test_returns_true_when_git_available(self, mock_run):
        mock_run.return_value = MagicMock(returncode=0)
        assert is_git_available() is True

    @patch("mrsf.git.subprocess.run", side_effect=FileNotFoundError)
    def test_returns_false_when_git_not_found(self, mock_run):
        assert is_git_available() is False

    @patch("mrsf.git.subprocess.run", side_effect=subprocess.SubprocessError)
    def test_returns_false_on_subprocess_error(self, mock_run):
        assert is_git_available() is False

    @patch("mrsf.git.subprocess.run")
    def test_caches_result(self, mock_run):
        mock_run.return_value = MagicMock(returncode=0)
        assert is_git_available() is True
        assert is_git_available() is True
        assert mock_run.call_count == 1  # cached after first call


# ---------------------------------------------------------------------------
# find_repo_root
# ---------------------------------------------------------------------------


class TestFindRepoRoot:
    def setup_method(self):
        reset_git_cache()

    def teardown_method(self):
        reset_git_cache()

    @patch("mrsf.git.subprocess.run")
    def test_returns_repo_root(self, mock_run):
        mock_run.return_value = MagicMock(returncode=0, stdout="/home/user/repo\n")
        result = find_repo_root("/home/user/repo/sub")
        assert result == "/home/user/repo"

    @patch("mrsf.git.subprocess.run")
    def test_returns_none_on_failure(self, mock_run):
        # First call: git --version (succeeds)
        # Second call: git rev-parse (fails)
        mock_run.side_effect = [
            MagicMock(returncode=0),  # git --version
            MagicMock(returncode=128, stdout=""),  # git rev-parse
        ]
        result = find_repo_root("/tmp/not-a-repo")
        assert result is None

    @patch("mrsf.git.subprocess.run", side_effect=FileNotFoundError)
    def test_returns_none_when_git_unavailable(self, mock_run):
        result = find_repo_root()
        assert result is None


# ---------------------------------------------------------------------------
# get_current_commit
# ---------------------------------------------------------------------------


class TestGetCurrentCommit:
    def setup_method(self):
        reset_git_cache()

    def teardown_method(self):
        reset_git_cache()

    @patch("mrsf.git.subprocess.run")
    def test_returns_commit_sha(self, mock_run):
        mock_run.side_effect = [
            MagicMock(returncode=0),  # git --version
            MagicMock(returncode=0, stdout="abc123def456\n"),  # git rev-parse HEAD
        ]
        result = get_current_commit("/repo")
        assert result == "abc123def456"

    @patch("mrsf.git.subprocess.run")
    def test_returns_none_on_failure(self, mock_run):
        mock_run.side_effect = [
            MagicMock(returncode=0),  # git --version
            MagicMock(returncode=128, stdout=""),  # rev-parse fails
        ]
        result = get_current_commit("/repo")
        assert result is None

    @patch("mrsf.git.subprocess.run", side_effect=FileNotFoundError)
    def test_returns_none_when_git_unavailable(self, mock_run):
        """Cover line 75: is_git_available() returns False."""
        result = get_current_commit("/repo")
        assert result is None


# ---------------------------------------------------------------------------
# is_stale
# ---------------------------------------------------------------------------


class TestIsStale:
    def setup_method(self):
        reset_git_cache()

    def teardown_method(self):
        reset_git_cache()

    @patch("mrsf.git.subprocess.run")
    def test_returns_true_when_commits_differ(self, mock_run):
        mock_run.side_effect = [
            MagicMock(returncode=0),  # git --version
            MagicMock(returncode=0, stdout="abc123\n"),  # HEAD
        ]
        assert is_stale("def456", "/repo") is True

    @patch("mrsf.git.subprocess.run")
    def test_returns_false_when_commits_match(self, mock_run):
        mock_run.side_effect = [
            MagicMock(returncode=0),  # git --version
            MagicMock(returncode=0, stdout="abc123\n"),  # HEAD
        ]
        assert is_stale("abc123", "/repo") is False

    @patch("mrsf.git.subprocess.run")
    def test_returns_false_when_head_unavailable(self, mock_run):
        mock_run.side_effect = [
            MagicMock(returncode=0),  # git --version
            MagicMock(returncode=128, stdout=""),  # rev-parse fails
        ]
        assert is_stale("abc123", "/repo") is False


# ---------------------------------------------------------------------------
# get_diff
# ---------------------------------------------------------------------------


class TestGetDiff:
    def setup_method(self):
        reset_git_cache()

    def teardown_method(self):
        reset_git_cache()

    @patch("mrsf.git.subprocess.run")
    def test_returns_parsed_hunks(self, mock_run):
        diff_output = "@@ -3,0 +4,2 @@ ctx\n+line1\n+line2"
        mock_run.side_effect = [
            MagicMock(returncode=0),  # git --version
            MagicMock(returncode=0, stdout=diff_output),  # git diff
        ]
        hunks = get_diff("abc", "def", "file.md", "/repo")
        assert len(hunks) == 1
        assert hunks[0].old_start == 3

    @patch("mrsf.git.subprocess.run")
    def test_returns_empty_on_failure(self, mock_run):
        mock_run.side_effect = [
            MagicMock(returncode=0),  # git --version
            MagicMock(returncode=128, stdout=""),  # git diff fails
        ]
        hunks = get_diff("abc", "def", "file.md", "/repo")
        assert hunks == []

    @patch("mrsf.git.subprocess.run", side_effect=FileNotFoundError)
    def test_returns_empty_when_git_unavailable(self, mock_run):
        hunks = get_diff("abc", "def", "file.md", "/repo")
        assert hunks == []


# ---------------------------------------------------------------------------
# get_file_at_commit
# ---------------------------------------------------------------------------


class TestGetFileAtCommit:
    def setup_method(self):
        reset_git_cache()

    def teardown_method(self):
        reset_git_cache()

    @patch("mrsf.git.subprocess.run")
    def test_returns_file_content(self, mock_run):
        mock_run.side_effect = [
            MagicMock(returncode=0),  # git --version
            MagicMock(returncode=0, stdout="# Hello\nWorld\n"),  # git show
        ]
        result = get_file_at_commit("abc123", "file.md", "/repo")
        assert result == "# Hello\nWorld\n"

    @patch("mrsf.git.subprocess.run")
    def test_returns_none_on_failure(self, mock_run):
        mock_run.side_effect = [
            MagicMock(returncode=0),  # git --version
            MagicMock(returncode=128, stdout=""),  # git show fails
        ]
        result = get_file_at_commit("abc123", "file.md", "/repo")
        assert result is None

    @patch("mrsf.git.subprocess.run", side_effect=FileNotFoundError)
    def test_returns_none_when_git_unavailable(self, mock_run):
        """Cover line 196: is_git_available() returns False."""
        result = get_file_at_commit("abc123", "file.md", "/repo")
        assert result is None


# ---------------------------------------------------------------------------
# get_staged_files
# ---------------------------------------------------------------------------


class TestGetStagedFiles:
    def setup_method(self):
        reset_git_cache()

    def teardown_method(self):
        reset_git_cache()

    @patch("mrsf.git.subprocess.run")
    def test_returns_staged_file_list(self, mock_run):
        mock_run.side_effect = [
            MagicMock(returncode=0),  # git --version
            MagicMock(returncode=0, stdout="file1.md\nfile2.md\n"),
        ]
        result = get_staged_files("/repo")
        assert result == ["file1.md", "file2.md"]

    @patch("mrsf.git.subprocess.run")
    def test_returns_empty_on_failure(self, mock_run):
        mock_run.side_effect = [
            MagicMock(returncode=0),  # git --version
            MagicMock(returncode=128, stdout=""),
        ]
        result = get_staged_files("/repo")
        assert result == []

    @patch("mrsf.git.subprocess.run")
    def test_passes_pattern_to_git(self, mock_run):
        mock_run.side_effect = [
            MagicMock(returncode=0),  # git --version
            MagicMock(returncode=0, stdout="docs/a.md\n"),
        ]
        result = get_staged_files("/repo", pattern="*.md")
        assert result == ["docs/a.md"]
        # Verify pattern was passed
        call_args = mock_run.call_args_list[1]
        assert "--" in call_args[0][0]
        assert "*.md" in call_args[0][0]

    @patch("mrsf.git.subprocess.run", side_effect=FileNotFoundError)
    def test_returns_empty_when_git_unavailable(self, mock_run):
        result = get_staged_files("/repo")
        assert result == []


# ---------------------------------------------------------------------------
# detect_renames
# ---------------------------------------------------------------------------


class TestDetectRenames:
    def setup_method(self):
        reset_git_cache()

    def teardown_method(self):
        reset_git_cache()

    @patch("mrsf.git.subprocess.run")
    def test_detects_renames(self, mock_run):
        mock_run.side_effect = [
            MagicMock(returncode=0),  # git --version
            MagicMock(returncode=0, stdout="R100\told-name.md\tnew-name.md\n"),
        ]
        renames = detect_renames("abc", "def", "/repo")
        assert renames == {"old-name.md": "new-name.md"}

    @patch("mrsf.git.subprocess.run")
    def test_returns_empty_when_no_renames(self, mock_run):
        mock_run.side_effect = [
            MagicMock(returncode=0),  # git --version
            MagicMock(returncode=0, stdout="M\tmodified.md\n"),
        ]
        renames = detect_renames("abc", "def", "/repo")
        assert renames == {}

    @patch("mrsf.git.subprocess.run", side_effect=FileNotFoundError)
    def test_returns_empty_when_git_unavailable(self, mock_run):
        renames = detect_renames("abc", "def", "/repo")
        assert renames == {}


# ---------------------------------------------------------------------------
# Exception branch coverage — subprocess raises for actual commands
# ---------------------------------------------------------------------------


class TestFindRepoRootException:
    """Cover the except branch in find_repo_root (lines 67-68)."""

    def setup_method(self):
        reset_git_cache()

    def teardown_method(self):
        reset_git_cache()

    @patch("mrsf.git.subprocess.run")
    def test_returns_none_when_subprocess_raises(self, mock_run):
        mock_run.side_effect = [
            MagicMock(returncode=0),  # git --version
            subprocess.SubprocessError("timeout"),
        ]
        assert find_repo_root("/some/path") is None


class TestGetCurrentCommitException:
    """Cover the except branch in get_current_commit (lines 86-87)."""

    def setup_method(self):
        reset_git_cache()

    def teardown_method(self):
        reset_git_cache()

    @patch("mrsf.git.subprocess.run")
    def test_returns_none_when_subprocess_raises(self, mock_run):
        mock_run.side_effect = [
            MagicMock(returncode=0),  # git --version
            subprocess.SubprocessError("timeout"),
        ]
        assert get_current_commit("/repo") is None


class TestGetDiffException:
    """Cover the except branch in get_diff (lines 158-159)."""

    def setup_method(self):
        reset_git_cache()

    def teardown_method(self):
        reset_git_cache()

    @patch("mrsf.git.subprocess.run")
    def test_returns_empty_when_subprocess_raises(self, mock_run):
        mock_run.side_effect = [
            MagicMock(returncode=0),  # git --version
            subprocess.SubprocessError("timeout"),
        ]
        assert get_diff("abc", "def", "file.md", "/repo") == []


class TestGetFileAtCommitException:
    """Cover the except branch in get_file_at_commit (lines 207-208)."""

    def setup_method(self):
        reset_git_cache()

    def teardown_method(self):
        reset_git_cache()

    @patch("mrsf.git.subprocess.run")
    def test_returns_none_when_subprocess_raises(self, mock_run):
        mock_run.side_effect = [
            MagicMock(returncode=0),  # git --version
            subprocess.SubprocessError("timeout"),
        ]
        assert get_file_at_commit("abc", "file.md", "/repo") is None


class TestGetStagedFilesException:
    """Cover the except branch in get_staged_files (lines 234-235)."""

    def setup_method(self):
        reset_git_cache()

    def teardown_method(self):
        reset_git_cache()

    @patch("mrsf.git.subprocess.run")
    def test_returns_empty_when_subprocess_raises(self, mock_run):
        mock_run.side_effect = [
            MagicMock(returncode=0),  # git --version
            subprocess.SubprocessError("timeout"),
        ]
        assert get_staged_files("/repo") == []


class TestDetectRenamesException:
    """Cover the except branch in detect_renames (lines 267-268)."""

    def setup_method(self):
        reset_git_cache()

    def teardown_method(self):
        reset_git_cache()

    @patch("mrsf.git.subprocess.run")
    def test_returns_empty_when_subprocess_raises(self, mock_run):
        mock_run.side_effect = [
            MagicMock(returncode=0),  # git --version
            subprocess.SubprocessError("timeout"),
        ]
        assert detect_renames("abc", "def", "/repo") == {}
