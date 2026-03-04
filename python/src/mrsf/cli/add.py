"""mrsf add <document> — add a review comment."""

from __future__ import annotations

import os
import sys
from typing import Any, cast

import click

from ..comments import add_comment
from ..discovery import discover_sidecar
from ..parser import parse_sidecar, read_document_lines
from ..types import AddCommentOptions, MrsfDocument
from ..writer import write_sidecar
from .main import MrsfContext, pass_ctx


@click.command("add")
@click.argument("document", type=click.Path())
@click.option("-a", "--author", required=True, help="Comment author.")
@click.option("-t", "--text", required=True, help="Comment text.")
@click.option("-l", "--line", type=int, default=None, help="Starting line number.")
@click.option("--end-line", type=int, default=None, help="Ending line number.")
@click.option("--start-column", type=int, default=None, help="Starting column.")
@click.option("--end-column", type=int, default=None, help="Ending column.")
@click.option(
    "--type", "comment_type", default=None, help="Comment type (suggestion, issue, question, etc.)."
)
@click.option(
    "--severity", type=click.Choice(["low", "medium", "high"]), default=None, help="Severity level."
)
@click.option("--reply-to", default=None, help="Parent comment ID for threading.")
@click.option("--selected-text", default=None, help="Selected text from document.")
@pass_ctx
def add_cmd(
    ctx: MrsfContext,
    document: str,
    author: str,
    text: str,
    line: int | None,
    end_line: int | None,
    start_column: int | None,
    end_column: int | None,
    comment_type: str | None,
    severity: str | None,
    reply_to: str | None,
    selected_text: str | None,
) -> None:
    """Add a review comment to a document's sidecar."""
    doc_path = os.path.join(ctx.cwd, document) if not os.path.isabs(document) else document
    if not os.path.isfile(doc_path):
        click.echo(click.style(f"Document not found: {doc_path}", fg="red"), err=True)
        sys.exit(1)

    # Discover or create sidecar
    try:
        sidecar_path = discover_sidecar(doc_path, cwd=ctx.cwd, config_path=ctx.config)
    except Exception:
        sidecar_path = doc_path + ".review.yaml"

    # Load existing or create new
    if os.path.exists(sidecar_path):
        doc = parse_sidecar(sidecar_path)
    else:
        doc = MrsfDocument(
            mrsf_version="1.0",
            document=os.path.basename(doc_path),
            comments=[],
        )

    # Auto-populate selected_text from document if line given but no selected_text
    if selected_text is None and line is not None:
        try:
            lines = read_document_lines(doc_path)
            end = end_line if end_line is not None else line
            selected_text = "\n".join(lines[line - 1 : end])
        except Exception:
            pass

    opts = AddCommentOptions(
        author=author,
        text=text,
        line=line,
        end_line=end_line,
        start_column=start_column,
        end_column=end_column,
        type=comment_type,
        severity=cast(Any, severity),
        reply_to=reply_to,
        selected_text=selected_text,
    )

    comment = add_comment(doc, opts)
    write_sidecar(sidecar_path, doc)

    if not ctx.quiet:
        loc = f" at line {line}" if line is not None else ""
        click.echo(f"Added comment {comment.id}{loc} → {sidecar_path}")
