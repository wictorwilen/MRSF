"""mrsf rename <old-document> <new-document> — rename a document and its sidecar."""

from __future__ import annotations

import os
import sys

import click

from ..discovery import discover_sidecar
from ..parser import parse_sidecar
from ..writer import write_sidecar
from .main import MrsfContext, pass_ctx


@click.command("rename")
@click.argument("old_document", type=click.Path())
@click.argument("new_document", type=click.Path())
@pass_ctx
def rename_cmd(ctx: MrsfContext, old_document: str, new_document: str) -> None:
    """Rename a document and update its sidecar."""
    old_path = (
        os.path.join(ctx.cwd, old_document) if not os.path.isabs(old_document) else old_document
    )
    new_path = (
        os.path.join(ctx.cwd, new_document) if not os.path.isabs(new_document) else new_document
    )

    # Find old sidecar
    try:
        old_sidecar = discover_sidecar(old_path, cwd=ctx.cwd, config_path=ctx.config)
    except Exception:
        click.echo(click.style(f"No sidecar found for {old_path}", fg="red"), err=True)
        sys.exit(1)

    if not os.path.exists(old_sidecar):
        click.echo(click.style(f"Sidecar not found: {old_sidecar}", fg="red"), err=True)
        sys.exit(1)

    doc = parse_sidecar(old_sidecar)
    doc.document = os.path.basename(new_path)

    # Compute new sidecar path
    new_sidecar = new_path + ".review.yaml"
    if old_sidecar.endswith(".review.json"):
        new_sidecar = new_path + ".review.json"

    # Create target directory if needed
    os.makedirs(os.path.dirname(new_sidecar), exist_ok=True)

    write_sidecar(new_sidecar, doc)

    # Remove old sidecar if path changed
    if os.path.abspath(old_sidecar) != os.path.abspath(new_sidecar):
        try:
            os.unlink(old_sidecar)
        except OSError:
            pass

    if not ctx.quiet:
        click.echo(f"Renamed: {old_sidecar} → {new_sidecar}")
