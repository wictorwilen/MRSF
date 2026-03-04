"""mrsf reanchor [files...] — re-anchor comments after document edits."""

from __future__ import annotations

import sys

import click

from ..git import find_repo_root, get_staged_files, is_git_available
from ..reanchor import reanchor_file
from ..resolve_files import resolve_sidecar_paths
from ..types import ReanchorOptions
from .main import MrsfContext, pass_ctx


def _status_icon(status: str) -> tuple[str, str]:
    """Return (icon, color) matching the Node.js CLI icons."""
    if status == "anchored":
        return "●", "green"
    if status == "shifted":
        return "↕", "blue"
    if status == "fuzzy":
        return "≈", "yellow"
    if status == "ambiguous":
        return "?", "magenta"
    if status == "orphaned":
        return "✗", "red"
    return "·", "white"


@click.command("reanchor")
@click.argument("files", nargs=-1, type=click.Path())
@click.option("-n", "--dry-run", is_flag=True, help="Report without modifying files.")
@click.option("-t", "--threshold", type=float, default=0.6, help="Fuzzy match threshold (0.0–1.0).")
@click.option("--staged", is_flag=True, help="Reanchor sidecars for staged markdown files.")
@click.option("--no-git", is_flag=True, help="Disable git integration.")
@click.option("--from", "from_commit", default=None, help="Base commit for diff.")
@click.option(
    "--update-text", is_flag=True, help="Update selected_text with current document text."
)
@click.option("-f", "--force", is_flag=True, help="Force-anchor high-confidence results.")
@pass_ctx
def reanchor_cmd(
    ctx: MrsfContext,
    files: tuple[str, ...],
    dry_run: bool,
    threshold: float,
    staged: bool,
    no_git: bool,
    from_commit: str | None,
    update_text: bool,
    force: bool,
) -> None:
    """Re-anchor comments after document edits."""
    if staged:
        if not is_git_available():
            click.echo(click.style("Git is not available.", fg="red"), err=True)
            sys.exit(1)
        repo_root = find_repo_root(ctx.cwd)
        if not repo_root:
            click.echo(click.style("Not in a git repository.", fg="red"), err=True)
            sys.exit(1)
        md_files = [f for f in get_staged_files(repo_root) if f.endswith(".md")]
        if not md_files:
            if not ctx.quiet:
                click.echo("No staged markdown files found.")
            return
        sidecars = resolve_sidecar_paths(md_files, cwd=ctx.cwd)
    else:
        sidecars = resolve_sidecar_paths(list(files), cwd=ctx.cwd)

    if not sidecars:
        click.echo("No sidecar files found.", err=True)
        sys.exit(1)

    opts = ReanchorOptions(
        cwd=ctx.cwd,
        config_path=ctx.config,
        dry_run=dry_run,
        threshold=threshold,
        no_git=no_git,
        from_commit=from_commit,
        update_text=update_text,
        force=force,
    )

    has_orphaned = False
    for sc in sidecars:
        try:
            results, changed, written = reanchor_file(sc, opts)
        except Exception as e:
            click.echo(click.style(f"Error reanchoring {sc}: {e}", fg="red"), err=True)
            continue

        orphaned = sum(1 for r in results if r.status == "orphaned")
        if orphaned:
            has_orphaned = True

        if not ctx.quiet:
            for r in results:
                icon, color = _status_icon(r.status)
                line_info = f" → line {r.new_line}" if r.new_line is not None else ""
                click.echo(
                    click.style(f"  {icon} {r.comment_id}{line_info} ({r.reason})", fg=color)
                )

            action = "would change" if dry_run else "changed"
            click.echo(f"  {sc}: {changed} comment(s) {action}, {orphaned} orphaned")

    if has_orphaned:
        sys.exit(1)
