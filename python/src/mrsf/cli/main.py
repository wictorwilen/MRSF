"""MRSF CLI — main entry point.

Mirrors the Node.js @mrsf/cli command structure using Click.
"""

from __future__ import annotations

import os
import sys
from importlib.metadata import version as pkg_version

import click
from rich.console import Console

console = Console()
err_console = Console(stderr=True)

BANNER = r"""
  __  __ ____  ____  _____
 |  \/  |  _ \/ ___||  ___|
 | |\/| | |_) \___ \| |_
 | |  | |  _ < ___) |  _|
 |_|  |_|_| \_\____/|_|
"""


class MrsfContext:
    """Shared context for all commands."""

    def __init__(
        self,
        cwd: str,
        config: str | None,
        quiet: bool,
        verbose: bool,
        no_color: bool,
    ):
        self.cwd = cwd
        self.config = config
        self.quiet = quiet
        self.verbose = verbose
        self.no_color = no_color


pass_ctx = click.make_pass_decorator(MrsfContext, ensure=True)


@click.group()
@click.option("--cwd", default=".", help="Working directory.", type=click.Path(exists=True))
@click.option("--config", default=None, help="Path to .mrsf.yaml config file.", type=click.Path())
@click.option("-q", "--quiet", is_flag=True, help="Suppress non-essential output.")
@click.option("-v", "--verbose", is_flag=True, help="Show detailed diagnostic output.")
@click.option("--no-color", is_flag=True, help="Disable color output.")
@click.version_option(package_name="mrsf", prog_name="mrsf (Python)")
@click.pass_context
def cli(
    ctx: click.Context, cwd: str, config: str | None, quiet: bool, verbose: bool, no_color: bool
) -> None:
    """MRSF — Markdown Review Sidecar Format CLI (Python)."""
    resolved_cwd = os.path.abspath(cwd)
    ctx.ensure_object(dict)
    ctx.obj = MrsfContext(
        cwd=resolved_cwd,
        config=config,
        quiet=quiet,
        verbose=verbose,
        no_color=no_color,
    )

    if no_color:
        os.environ["NO_COLOR"] = "1"

    # Print banner (unless quiet, CI, or non-TTY)
    if not quiet and sys.stdout.isatty() and not os.environ.get("CI"):
        try:
            ver = pkg_version("mrsf")
        except Exception:
            ver = "dev"
        if not no_color:
            click.echo(click.style(BANNER, fg="cyan"), err=True)
            click.echo(
                click.style(f"  Sidemark CLI v{ver} (Python)\n", fg="cyan", bold=True), err=True
            )
        else:
            click.echo(BANNER, err=True)
            click.echo(f"  Sidemark CLI v{ver} (Python)\n", err=True)


# ── Import and register sub-commands ──────────────────────────────────

from .add import add_cmd  # noqa: E402
from .init import init_cmd  # noqa: E402
from .list import list_cmd  # noqa: E402
from .reanchor import reanchor_cmd  # noqa: E402
from .rename import rename_cmd  # noqa: E402
from .resolve import resolve_cmd  # noqa: E402
from .status import status_cmd  # noqa: E402
from .validate import validate_cmd  # noqa: E402
from .watch import watch_cmd  # noqa: E402

cli.add_command(add_cmd)
cli.add_command(init_cmd)
cli.add_command(list_cmd)
cli.add_command(reanchor_cmd)
cli.add_command(rename_cmd)
cli.add_command(resolve_cmd)
cli.add_command(status_cmd)
cli.add_command(validate_cmd)
cli.add_command(watch_cmd)
