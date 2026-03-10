"""mrsf watch [files...] — watch for changes and validate/reanchor."""

from __future__ import annotations

import os
import sys
import time
from datetime import datetime
from typing import Any

import click

from ..discovery import discover_sidecar
from ..reanchor import reanchor_file
from ..resolve_files import resolve_sidecar_paths
from ..types import ReanchorOptions
from ..validator import validate_file
from .main import MrsfContext, pass_ctx
from .watch_signals import register_signal_handlers


@click.command("watch")
@click.argument("files", nargs=-1, type=click.Path())
@click.option("--reanchor", "do_reanchor", is_flag=True, help="Reanchor on markdown changes.")
@click.option("-n", "--dry-run", is_flag=True, help="Report without modifying files.")
@click.option("-t", "--threshold", type=float, default=0.6, help="Fuzzy match threshold.")
@click.option("-s", "--strict", is_flag=True, help="Treat warnings as errors.")
@click.option("--no-git", is_flag=True, help="Disable git integration.")
@click.option("--from", "from_commit", default=None, help="Base commit for diff.")
@click.option("--update-text", is_flag=True, help="Update selected_text with current text.")
@click.option("-f", "--force", is_flag=True, help="Force-anchor high-confidence results.")
@click.option("--debounce", type=int, default=300, help="Debounce interval in milliseconds.")
@pass_ctx
def watch_cmd(
    ctx: MrsfContext,
    files: tuple[str, ...],
    do_reanchor: bool,
    dry_run: bool,
    threshold: float,
    strict: bool,
    no_git: bool,
    from_commit: str | None,
    update_text: bool,
    force: bool,
    debounce: int,
) -> None:
    """Watch for changes and validate/reanchor sidecars."""
    try:
        from watchdog.events import FileSystemEventHandler
        from watchdog.observers import Observer
    except ImportError:
        click.echo(
            click.style(
                "watchdog is required for watch command. Install with: pip install watchdog",
                fg="red",
            ),
            err=True,
        )
        sys.exit(1)

    sidecars = resolve_sidecar_paths(list(files), cwd=ctx.cwd)
    # Also watch the markdown files
    watch_paths = set()
    for sc in sidecars:
        watch_paths.add(os.path.dirname(sc) or ".")

    if not watch_paths:
        watch_paths.add(ctx.cwd)

    # Track self-writes to avoid re-triggering
    self_writes: dict[str, float] = {}
    debounce_timers: dict[str, float] = {}
    event_count = 0
    error_count = 0
    reanchor_count = 0

    def handle_file(file_path: str) -> None:
        nonlocal event_count, error_count, reanchor_count

        abs_path = os.path.abspath(file_path)

        # Skip self-writes (within a 2-second window to handle multiple FS events)
        sw_time = self_writes.get(abs_path)
        if sw_time is not None and (time.time() - sw_time) < 2.0:
            return

        # Debounce
        now = time.time()
        last = debounce_timers.get(abs_path, 0)
        if now - last < debounce / 1000.0:
            return
        debounce_timers[abs_path] = now

        event_count += 1
        ts = datetime.now().strftime("%H:%M:%S")

        is_sidecar = abs_path.endswith(".review.yaml") or abs_path.endswith(".review.json")
        is_markdown = abs_path.endswith(".md") or abs_path.endswith(".markdown")

        if is_sidecar:
            if not ctx.quiet:
                click.echo(f"[{ts}] validate {os.path.basename(abs_path)}")
            try:
                result = validate_file(abs_path)
            except Exception as e:
                # File may be mid-write; skip silently
                if ctx.verbose:
                    click.echo(click.style(f"  validate skipped (transient): {e}", dim=True))
                return
            if not result.valid or (strict and result.warnings):
                error_count += 1
                for err in result.errors:
                    path_suffix = f" ({err.path})" if err.path else ""
                    click.echo(click.style(f"  ERROR: {err.message}{path_suffix}", fg="red"))

        elif is_markdown:
            # Find companion sidecar
            try:
                sidecar = discover_sidecar(abs_path, cwd=ctx.cwd, config_path=ctx.config)
            except Exception:
                return

            if not os.path.exists(sidecar):
                return

            if do_reanchor:
                if not ctx.quiet:
                    prefix = "[dry-run] " if dry_run else ""
                    click.echo(f"[{ts}] {prefix}reanchor {os.path.basename(abs_path)}")
                try:
                    opts = ReanchorOptions(
                        cwd=ctx.cwd,
                        dry_run=dry_run,
                        threshold=threshold,
                        no_git=no_git,
                        from_commit=from_commit,
                        update_text=update_text,
                        force=force,
                    )
                    results, changed, written = reanchor_file(sidecar, opts)
                    reanchor_count += 1
                    if written:
                        self_writes[os.path.abspath(sidecar)] = time.time()
                except Exception as e:
                    error_count += 1
                    click.echo(click.style(f"  Error: {e}", fg="red"))

            # Validate sidecar too
            if not ctx.quiet:
                click.echo(f"[{ts}] validate {os.path.basename(sidecar)}")
            try:
                result = validate_file(sidecar)
            except Exception as e:
                if ctx.verbose:
                    click.echo(click.style(f"  validate skipped (transient): {e}", dim=True))
                return
            if not result.valid or (strict and result.warnings):
                error_count += 1

    class Handler(FileSystemEventHandler):
        def on_modified(self, event: Any) -> None:
            if not event.is_directory:
                handle_file(event.src_path)

        def on_created(self, event: Any) -> None:
            if not event.is_directory:
                handle_file(event.src_path)

    observer = Observer()
    handler = Handler()
    for wp in watch_paths:
        observer.schedule(handler, wp, recursive=True)

    observer.start()
    if not ctx.quiet:
        click.echo(f"Watching {len(watch_paths)} path(s)... Press Ctrl+C to stop.")

    def shutdown(*_: Any) -> None:
        cleanup_signal_handlers()
        observer.stop()
        if not ctx.quiet:
            click.echo(
                f"\n{event_count} event(s), {reanchor_count} reanchor(s), {error_count} error(s)"
            )
        sys.exit(1 if error_count > 0 else 0)

    cleanup_signal_handlers = register_signal_handlers(shutdown)

    try:
        observer.join()
    except KeyboardInterrupt:
        shutdown()
    finally:
        cleanup_signal_handlers()
