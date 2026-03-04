"""MRSF Git Integration — Git-aware operations for re-anchoring and discovery.

Uses subprocess for safety. All functions degrade gracefully when Git is unavailable.
"""

from __future__ import annotations

import os
import re
import subprocess

from .types import DiffHunk

GIT_TIMEOUT = 10  # seconds

_git_available: bool | None = None


# ---------------------------------------------------------------------------
# Availability
# ---------------------------------------------------------------------------


def is_git_available() -> bool:
    """Check whether `git` is available on PATH."""
    global _git_available
    if _git_available is not None:
        return _git_available
    try:
        subprocess.run(
            ["git", "--version"],
            capture_output=True,
            timeout=GIT_TIMEOUT,
            check=True,
        )
        _git_available = True
    except (subprocess.SubprocessError, FileNotFoundError):
        _git_available = False
    return _git_available


def reset_git_cache() -> None:
    """Reset cached availability (for testing)."""
    global _git_available
    _git_available = None


# ---------------------------------------------------------------------------
# Repository info
# ---------------------------------------------------------------------------


def find_repo_root(cwd: str | None = None) -> str | None:
    """Find the Git repository root. Returns None if not in a Git repo."""
    if not is_git_available():
        return None
    try:
        result = subprocess.run(
            ["git", "rev-parse", "--show-toplevel"],
            capture_output=True,
            text=True,
            cwd=cwd or os.getcwd(),
            timeout=GIT_TIMEOUT,
        )
        if result.returncode == 0:
            return result.stdout.strip()
    except (subprocess.SubprocessError, FileNotFoundError):
        pass
    return None


def get_current_commit(repo_root: str) -> str | None:
    """Get the full HEAD commit SHA."""
    if not is_git_available():
        return None
    try:
        result = subprocess.run(
            ["git", "rev-parse", "HEAD"],
            capture_output=True,
            text=True,
            cwd=repo_root,
            timeout=GIT_TIMEOUT,
        )
        if result.returncode == 0:
            return result.stdout.strip()
    except (subprocess.SubprocessError, FileNotFoundError):
        pass
    return None


def is_stale(comment_commit: str, repo_root: str) -> bool:
    """Check if a commit hash differs from HEAD."""
    head = get_current_commit(repo_root)
    if not head:
        return False
    min_len = min(len(comment_commit), len(head))
    return comment_commit[:min_len] != head[:min_len]


# ---------------------------------------------------------------------------
# Diff operations
# ---------------------------------------------------------------------------


def parse_diff_hunks(diff_output: str) -> list[DiffHunk]:
    """Parse unified diff output into structured hunks."""
    hunks: list[DiffHunk] = []
    lines = diff_output.split("\n")
    current: DiffHunk | None = None

    hunk_re = re.compile(r"^@@\s+-(\d+)(?:,(\d+))?\s+\+(\d+)(?:,(\d+))?\s+@@")

    for line in lines:
        m = hunk_re.match(line)
        if m:
            current = DiffHunk(
                old_start=int(m.group(1)),
                old_count=int(m.group(2)) if m.group(2) is not None else 1,
                new_start=int(m.group(3)),
                new_count=int(m.group(4)) if m.group(4) is not None else 1,
                lines=[],
            )
            hunks.append(current)
            continue
        if current is not None and line and line[0] in ("+", "-", " "):
            current.lines.append(line)

    return hunks


def get_diff(
    from_commit: str,
    to_commit: str,
    file_path: str,
    repo_root: str,
) -> list[DiffHunk]:
    """Get diff hunks between two commits for a specific file."""
    if not is_git_available():
        return []
    try:
        result = subprocess.run(
            [
                "git",
                "diff",
                f"{from_commit}..{to_commit}",
                "--unified=0",
                "--no-color",
                "--",
                file_path,
            ],
            capture_output=True,
            text=True,
            cwd=repo_root,
            timeout=GIT_TIMEOUT,
        )
        if result.returncode == 0:
            return parse_diff_hunks(result.stdout)
    except (subprocess.SubprocessError, FileNotFoundError):
        pass
    return []


def get_line_shift(
    hunks: list[DiffHunk],
    original_line: int,
) -> tuple[int, bool]:
    """Calculate net line shift for an original line number.

    Returns (shift, modified). `modified` is True if the line was changed/deleted.
    """
    cumulative_shift = 0

    for hunk in hunks:
        old_end = hunk.old_start + hunk.old_count - 1

        if hunk.old_start > original_line:
            break

        if original_line >= hunk.old_start and original_line <= old_end:
            return (cumulative_shift, True)

        if old_end < original_line:
            cumulative_shift += hunk.new_count - hunk.old_count

    return (cumulative_shift, False)


# ---------------------------------------------------------------------------
# File at commit
# ---------------------------------------------------------------------------


def get_file_at_commit(commit: str, file_path: str, repo_root: str) -> str | None:
    """Get the contents of a file at a specific commit."""
    if not is_git_available():
        return None
    try:
        result = subprocess.run(
            ["git", "show", f"{commit}:{file_path}"],
            capture_output=True,
            text=True,
            cwd=repo_root,
            timeout=GIT_TIMEOUT,
        )
        if result.returncode == 0:
            return result.stdout
    except (subprocess.SubprocessError, FileNotFoundError):
        pass
    return None


# ---------------------------------------------------------------------------
# Staged files
# ---------------------------------------------------------------------------


def get_staged_files(repo_root: str, pattern: str | None = None) -> list[str]:
    """Get list of staged files matching a pattern."""
    if not is_git_available():
        return []
    try:
        args = ["git", "diff", "--cached", "--name-only", "--diff-filter=d"]
        if pattern:
            args.extend(["--", pattern])
        result = subprocess.run(
            args,
            capture_output=True,
            text=True,
            cwd=repo_root,
            timeout=GIT_TIMEOUT,
        )
        if result.returncode == 0:
            return [f for f in result.stdout.strip().split("\n") if f]
    except (subprocess.SubprocessError, FileNotFoundError):
        pass
    return []


# ---------------------------------------------------------------------------
# Rename detection
# ---------------------------------------------------------------------------


def detect_renames(
    from_commit: str,
    to_commit: str,
    repo_root: str,
) -> dict[str, str]:
    """Detect file renames between two commits. Returns old_path → new_path."""
    if not is_git_available():
        return {}
    try:
        result = subprocess.run(
            ["git", "diff", "--name-status", "-M", f"{from_commit}..{to_commit}"],
            capture_output=True,
            text=True,
            cwd=repo_root,
            timeout=GIT_TIMEOUT,
        )
        renames: dict[str, str] = {}
        if result.returncode == 0:
            for line in result.stdout.strip().split("\n"):
                m = re.match(r"^R\d*\t(.+)\t(.+)$", line)
                if m:
                    renames[m.group(1)] = m.group(2)
        return renames
    except (subprocess.SubprocessError, FileNotFoundError):
        return {}
