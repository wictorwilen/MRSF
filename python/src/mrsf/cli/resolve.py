"""mrsf resolve <sidecar> <id> — resolve or unresolve a comment."""

from __future__ import annotations

import sys

import click

from ..comments import resolve_comment, unresolve_comment
from ..parser import parse_sidecar
from ..writer import write_sidecar
from .main import MrsfContext, pass_ctx


@click.command("resolve")
@click.argument("sidecar", type=click.Path(exists=True))
@click.argument("comment_id")
@click.option("--cascade", is_flag=True, help="Also resolve direct replies.")
@click.option("-u", "--undo", is_flag=True, help="Unresolve the comment.")
@pass_ctx
def resolve_cmd(ctx: MrsfContext, sidecar: str, comment_id: str, cascade: bool, undo: bool) -> None:
    """Resolve or unresolve a comment by ID."""
    doc = parse_sidecar(sidecar)

    if undo:
        found = unresolve_comment(doc, comment_id)
        action = "Unresolved"
    else:
        found = resolve_comment(doc, comment_id, cascade=cascade)
        action = "Resolved"

    if not found:
        click.echo(click.style(f"Comment {comment_id} not found in {sidecar}", fg="red"), err=True)
        sys.exit(1)

    write_sidecar(sidecar, doc)
    if not ctx.quiet:
        click.echo(f"{action} {comment_id} in {sidecar}")
