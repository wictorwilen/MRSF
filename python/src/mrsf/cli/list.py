"""mrsf list [files...] — list and filter review comments."""

from __future__ import annotations

import json
import sys
from typing import Any, cast

import click

from ..comments import filter_comments, summarize
from ..parser import parse_sidecar
from ..resolve_files import resolve_sidecar_paths
from ..types import Comment, CommentFilter
from .main import MrsfContext, pass_ctx


@click.command("list")
@click.argument("files", nargs=-1, type=click.Path())
@click.option("--open", "show_open", is_flag=True, help="Only show unresolved comments.")
@click.option("--resolved", "show_resolved", is_flag=True, help="Only show resolved comments.")
@click.option("--orphaned", is_flag=True, help="Only show orphaned comments.")
@click.option("--author", default=None, help="Filter by author.")
@click.option("--type", "comment_type", default=None, help="Filter by type.")
@click.option("--severity", default=None, help="Filter by severity.")
@click.option("--summary", is_flag=True, help="Show summary statistics.")
@click.option("--json", "as_json", is_flag=True, help="Output as JSON.")
@pass_ctx
def list_cmd(
    ctx: MrsfContext,
    files: tuple[str, ...],
    show_open: bool,
    show_resolved: bool,
    orphaned: bool,
    author: str | None,
    comment_type: str | None,
    severity: str | None,
    summary: bool,
    as_json: bool,
) -> None:
    """List and filter review comments."""
    sidecars = resolve_sidecar_paths(list(files), cwd=ctx.cwd)
    if not sidecars:
        click.echo("No sidecar files found.", err=True)
        sys.exit(1)

    all_comments: list[dict[str, Any]] = []
    for sc in sidecars:
        try:
            doc = parse_sidecar(sc)
        except Exception as e:
            if not ctx.quiet:
                click.echo(click.style(f"Error parsing {sc}: {e}", fg="red"), err=True)
            continue

        f = CommentFilter(
            open=show_open or None,
            resolved=show_resolved or None,
            orphaned=orphaned or None,
            author=author,
            type=comment_type,
            severity=cast(Any, severity),
        )
        comments = filter_comments(doc.comments, f)

        for c in comments:
            all_comments.append({"sidecar": sc, "document": doc.document, "comment": c})

    if as_json:
        data = [
            {
                "sidecar": item["sidecar"],
                "document": item["document"],
                **item["comment"].to_dict(),
            }
            for item in all_comments
        ]
        click.echo(json.dumps(data, indent=2))
        return

    if summary:
        comments_only: list[Comment] = [item["comment"] for item in all_comments]
        stats = summarize(comments_only)
        click.echo(f"Total: {stats.total}  Open: {stats.open}  Resolved: {stats.resolved}")
        if stats.by_type:
            click.echo(f"By type: {stats.by_type}")
        if stats.by_severity:
            click.echo(f"By severity: {stats.by_severity}")
        if stats.threads:
            click.echo(f"Threads: {stats.threads}")
        return

    for item in all_comments:
        comment: Comment = item["comment"]
        status = (
            click.style("✓", fg="green")
            if comment.resolved
            else click.style("○", fg="yellow")
        )
        loc = f":{comment.line}" if comment.line is not None else ""
        sev = f" [{comment.severity}]" if comment.severity else ""
        typ = f" ({comment.type})" if comment.type else ""
        text_preview = comment.text[:60].replace("\n", " ")
        if len(comment.text) > 60:
            text_preview += "..."
        click.echo(
            f"{status} {comment.id} {item['document']}{loc}{sev}{typ}"
            f" / {comment.author}: {text_preview}"
        )
