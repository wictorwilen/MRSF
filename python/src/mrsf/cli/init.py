"""mrsf init <document> — create an empty sidecar file."""

from __future__ import annotations

import os
import sys

import click

from ..discovery import discover_sidecar
from ..types import MrsfDocument
from ..writer import write_sidecar
from .main import MrsfContext, pass_ctx


@click.command("init")
@click.argument("document", type=click.Path())
@click.option("-f", "--force", is_flag=True, help="Overwrite existing sidecar.")
@pass_ctx
def init_cmd(ctx: MrsfContext, document: str, force: bool) -> None:
    """Create an empty sidecar file for a document."""
    doc_path = os.path.join(ctx.cwd, document) if not os.path.isabs(document) else document
    if not os.path.isfile(doc_path):
        click.echo(click.style(f"Document not found: {doc_path}", fg="red"), err=True)
        sys.exit(1)

    try:
        sidecar_path = discover_sidecar(doc_path, cwd=ctx.cwd, config_path=ctx.config)
    except Exception:
        sidecar_path = doc_path + ".review.yaml"

    if os.path.exists(sidecar_path) and not force:
        click.echo(click.style(f"Sidecar already exists: {sidecar_path}", fg="red"), err=True)
        click.echo("Use --force to overwrite.", err=True)
        sys.exit(1)

    doc = MrsfDocument(
        mrsf_version="1.0",
        document=os.path.basename(doc_path),
        comments=[],
    )
    write_sidecar(sidecar_path, doc)
    if not ctx.quiet:
        click.echo(click.style(f"Created {sidecar_path}", fg="green"))
