"""mrsf status [files...] — check anchor health of comments."""

from __future__ import annotations

import json
import sys

import click

from ..git import find_repo_root, get_current_commit, is_git_available
from ..parser import parse_sidecar, read_document_lines
from ..resolve_files import resolve_sidecar_paths
from ..types import Comment
from .main import MrsfContext, pass_ctx


def _assess_health(
    comment: Comment,
    doc_lines: list[str] | None,
    head_commit: str | None,
) -> tuple[str, str]:
    """Return (status, reason) for a comment's anchor health."""
    has_text = comment.selected_text is not None and len(comment.selected_text) > 0
    has_commit = comment.commit is not None and len(comment.commit) > 0
    is_orphaned = comment.extra.get("x_reanchor_status") == "orphaned"

    if is_orphaned:
        return "orphaned", "marked orphaned by reanchor"

    if not has_text and not has_commit:
        return "unknown", "no anchor data"

    if has_text and doc_lines is not None and comment.selected_text is not None:
        text_found = comment.selected_text in "\n".join(doc_lines)
        if text_found:
            if has_commit and head_commit and comment.commit == head_commit:
                return "fresh", "text matches, commit is HEAD"
            elif has_commit:
                return "stale", "text matches, commit is not HEAD"
            else:
                return "fresh", "text matches"
        else:
            if has_commit and head_commit and comment.commit == head_commit:
                return "stale", "text not found, commit is HEAD"
            else:
                return "stale", "text not found in document"

    if has_commit and head_commit:
        if comment.commit == head_commit:
            return "fresh", "commit is HEAD"
        else:
            return "stale", "commit is not HEAD"

    return "unknown", "insufficient anchor data"


@click.command("status")
@click.argument("files", nargs=-1, type=click.Path())
@click.option("--json", "as_json", is_flag=True, help="Output as JSON.")
@pass_ctx
def status_cmd(ctx: MrsfContext, files: tuple[str, ...], as_json: bool) -> None:
    """Check anchor health of sidecar comments."""
    sidecars = resolve_sidecar_paths(list(files), cwd=ctx.cwd)
    if not sidecars:
        click.echo("No sidecar files found.", err=True)
        sys.exit(1)

    head_commit = None
    if is_git_available():
        try:
            repo_root = find_repo_root(ctx.cwd)
            if repo_root:
                head_commit = get_current_commit(repo_root)
        except Exception:
            pass

    all_results: list[dict[str, str]] = []
    for sc in sidecars:
        try:
            doc = parse_sidecar(sc)
        except Exception as e:
            if not ctx.quiet:
                click.echo(click.style(f"Error parsing {sc}: {e}", fg="red"), err=True)
            continue

        # Read document lines for text matching
        doc_lines = None
        import os

        doc_dir = os.path.dirname(sc)
        doc_path = os.path.join(doc_dir, doc.document)
        if os.path.isfile(doc_path):
            try:
                doc_lines = read_document_lines(doc_path)
            except Exception:
                pass

        counts = {"fresh": 0, "stale": 0, "orphaned": 0, "unknown": 0}
        for c in doc.comments:
            status, reason = _assess_health(c, doc_lines, head_commit)
            counts[status] = counts.get(status, 0) + 1

            if as_json:
                all_results.append(
                    {
                        "sidecar": sc,
                        "comment_id": c.id,
                        "status": status,
                        "reason": reason,
                    }
                )
            elif not ctx.quiet:
                icons = {"fresh": "●", "stale": "◐", "orphaned": "✗", "unknown": "?"}
                colors = {
                    "fresh": "green",
                    "stale": "yellow",
                    "orphaned": "red",
                    "unknown": "white",
                }
                icon = icons.get(status, "?")
                color = colors.get(status, "white")
                click.echo(click.style(f"  {icon} {c.id}: {reason}", fg=color))

        if not as_json and not ctx.quiet:
            total = len(doc.comments)
            click.echo(
                f"  {sc}: {total} comment(s): "
                f"{counts['fresh']} fresh, {counts['stale']} stale, "
                f"{counts['orphaned']} orphaned, {counts['unknown']} unknown"
            )

    if as_json:
        click.echo(json.dumps(all_results, indent=2))
