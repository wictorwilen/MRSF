"""MRSF Comment Operations — CRUD for sidecar comments."""

from __future__ import annotations

import uuid
from datetime import datetime, timezone

from .git import get_current_commit, is_git_available
from .types import (
    AddCommentOptions,
    Comment,
    CommentFilter,
    CommentSummary,
    MrsfDocument,
    RemoveCommentOptions,
)
from .writer import compute_hash

# ---------------------------------------------------------------------------
# Add
# ---------------------------------------------------------------------------

ANCHOR_FIELDS = [
    "line",
    "end_line",
    "start_column",
    "end_column",
    "selected_text",
    "selected_text_hash",
    "anchored_text",
    "commit",
]


def add_comment(
    doc: MrsfDocument,
    opts: AddCommentOptions,
    repo_root: str | None = None,
) -> Comment:
    """Add a new comment to a document. Mutates doc.comments in place."""
    comment_id = opts.id or str(uuid.uuid4())
    timestamp = opts.timestamp or datetime.now(timezone.utc).isoformat()

    commit = opts.commit
    if not commit and repo_root and is_git_available():
        commit = get_current_commit(repo_root)

    comment = Comment(
        id=comment_id,
        author=opts.author,
        timestamp=timestamp,
        text=opts.text,
        resolved=False,
    )

    if opts.line is not None:
        comment.line = opts.line
    if opts.end_line is not None:
        comment.end_line = opts.end_line
    if opts.start_column is not None:
        comment.start_column = opts.start_column
    if opts.end_column is not None:
        comment.end_column = opts.end_column
    if opts.type:
        comment.type = opts.type
    if opts.severity:
        comment.severity = opts.severity
    if opts.reply_to:
        comment.reply_to = opts.reply_to
    if opts.selected_text:
        comment.selected_text = opts.selected_text
        comment.selected_text_hash = compute_hash(opts.selected_text)
    if commit:
        comment.commit = commit

    doc.comments.append(comment)
    return comment


def populate_selected_text(comment: Comment, document_lines: list[str]) -> None:
    """Populate selected_text from document lines."""
    if comment.selected_text:
        return
    if comment.line is None:
        return

    start_idx = comment.line - 1
    end_idx = (comment.end_line or comment.line) - 1

    if start_idx < 0 or end_idx >= len(document_lines):
        return

    if start_idx == end_idx:
        line = document_lines[start_idx]
        if comment.start_column is not None and comment.end_column is not None:
            line = line[comment.start_column : comment.end_column]
        comment.selected_text = line
    else:
        lines: list[str] = []
        for i in range(start_idx, end_idx + 1):
            text = document_lines[i]
            if i == start_idx and comment.start_column is not None:
                text = text[comment.start_column :]
            if i == end_idx and comment.end_column is not None:
                text = text[: comment.end_column]
            lines.append(text)
        comment.selected_text = "\n".join(lines)

    if comment.selected_text:
        comment.selected_text_hash = compute_hash(comment.selected_text)


# ---------------------------------------------------------------------------
# Resolve / Unresolve
# ---------------------------------------------------------------------------


def resolve_comment(doc: MrsfDocument, comment_id: str, cascade: bool = False) -> bool:
    """Resolve a comment by id. Returns True if found and updated."""
    comment = next((c for c in doc.comments if c.id == comment_id), None)
    if not comment:
        return False

    comment.resolved = True

    if cascade:
        for c in doc.comments:
            if c.reply_to == comment_id:
                c.resolved = True

    return True


def unresolve_comment(doc: MrsfDocument, comment_id: str) -> bool:
    """Unresolve a comment by id."""
    comment = next((c for c in doc.comments if c.id == comment_id), None)
    if not comment:
        return False
    comment.resolved = False
    return True


# ---------------------------------------------------------------------------
# Remove
# ---------------------------------------------------------------------------


def remove_comment(
    doc: MrsfDocument,
    comment_id: str,
    opts: RemoveCommentOptions | None = None,
) -> bool:
    """Remove a comment by id. Promotes direct replies per §9.1."""
    if opts is None:
        opts = RemoveCommentOptions()

    comment = next((c for c in doc.comments if c.id == comment_id), None)
    if not comment:
        return False

    if opts.cascade:
        doc.comments = [c for c in doc.comments if c.id == comment_id or c.reply_to != comment_id]
    else:
        # Promote direct replies (§9.1)
        for c in doc.comments:
            if c.reply_to != comment_id:
                continue

            # Copy missing anchor fields from parent
            for field_name in ANCHOR_FIELDS:
                if (
                    getattr(c, field_name, None) is None
                    and getattr(comment, field_name, None) is not None
                ):
                    setattr(c, field_name, getattr(comment, field_name))

            # Re-point reply_to to grandparent
            if comment.reply_to:
                c.reply_to = comment.reply_to
            else:
                c.reply_to = None

    # Remove the comment itself
    doc.comments = [c for c in doc.comments if c.id != comment_id]
    return True


# ---------------------------------------------------------------------------
# List / Filter
# ---------------------------------------------------------------------------


def filter_comments(comments: list[Comment], f: CommentFilter) -> list[Comment]:
    """Filter comments based on criteria."""
    result: list[Comment] = []
    for c in comments:
        if f.open is True and c.resolved:
            continue
        if f.resolved is True and not c.resolved:
            continue
        if f.author and c.author != f.author:
            continue
        if f.type and c.type != f.type:
            continue
        if f.severity and c.severity != f.severity:
            continue
        if f.orphaned is True and c.extra.get("x_reanchor_status") != "orphaned":
            continue
        if f.orphaned is False and c.extra.get("x_reanchor_status") == "orphaned":
            continue
        result.append(c)
    return result


def get_threads(comments: list[Comment]) -> dict[str, list[Comment]]:
    """Get threads — groups of comments by their root ID."""
    threads: dict[str, list[Comment]] = {}
    reply_map: dict[str, str] = {}

    for c in comments:
        if not c.reply_to:
            threads[c.id] = [c]
        else:
            reply_map[c.id] = c.reply_to

    def find_root(cid: str) -> str:
        parent = reply_map.get(cid)
        if not parent:
            return cid
        return find_root(parent)

    for c in comments:
        if c.reply_to:
            root_id = find_root(c.id)
            if root_id not in threads:
                threads[root_id] = []
            threads[root_id].append(c)

    return threads


# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------


def summarize(comments: list[Comment]) -> CommentSummary:
    """Generate summary statistics for a comment list."""
    summary = CommentSummary(total=len(comments))
    roots: set[str] = set()

    for c in comments:
        if c.resolved:
            summary.resolved += 1
        else:
            summary.open += 1

        if c.extra.get("x_reanchor_status") == "orphaned":
            summary.orphaned += 1

        if c.type:
            summary.by_type[c.type] = summary.by_type.get(c.type, 0) + 1
        if c.severity:
            summary.by_severity[c.severity] = summary.by_severity.get(c.severity, 0) + 1

        if not c.reply_to:
            roots.add(c.id)

    summary.threads = len(roots)
    return summary
