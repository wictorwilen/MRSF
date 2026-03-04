"""mrsf validate [files...] — validate sidecar files."""

from __future__ import annotations

import sys

import click

from ..resolve_files import resolve_sidecar_paths
from ..validator import validate_file
from .main import MrsfContext, pass_ctx


@click.command("validate")
@click.argument("files", nargs=-1, type=click.Path())
@click.option("-s", "--strict", is_flag=True, help="Treat warnings as errors.")
@pass_ctx
def validate_cmd(ctx: MrsfContext, files: tuple[str, ...], strict: bool) -> None:
    """Validate sidecar files against the MRSF schema."""
    sidecars = resolve_sidecar_paths(list(files), cwd=ctx.cwd)
    if not sidecars:
        click.echo("No sidecar files found.", err=True)
        sys.exit(1)

    has_errors = False
    for sc in sidecars:
        result = validate_file(sc)
        ok = result.valid
        errors = result.errors
        warnings = result.warnings

        if strict and warnings:
            ok = False

        if ok:
            if not ctx.quiet:
                click.echo(click.style(f"✓ {sc}", fg="green"))
        else:
            has_errors = True
            click.echo(click.style(f"✗ {sc}", fg="red"))

        for err in errors:
            path_suffix = f" ({err.path})" if err.path else ""
            click.echo(click.style(f"  ERROR: {err.message}{path_suffix}", fg="red"))
        for warn in warnings:
            style = "red" if strict else "yellow"
            path_suffix = f" ({warn.path})" if warn.path else ""
            click.echo(click.style(f"  WARN: {warn.message}{path_suffix}", fg=style))

    if has_errors:
        sys.exit(1)
