"""Tests for the watch command — 1:1 match with watch.test.ts.

Tests use unittest.mock to simulate file system events and validate
that the watch handler calls the correct functions.
"""

from __future__ import annotations

import os
import signal
import tempfile
import time
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest

from mrsf.cli.watch_signals import register_signal_handlers
from mrsf.types import ReanchorOptions, ReanchorResult, ValidationResult


# ---------------------------------------------------------------------------
# The watch handler logic extracted for testability
# ---------------------------------------------------------------------------


class WatchHandler:
    """Minimal reproduction of the watch command's event handler logic."""

    def __init__(
        self,
        cwd: str,
        do_reanchor: bool = False,
        dry_run: bool = False,
        threshold: float = 0.6,
        strict: bool = False,
        debounce_ms: int = 300,
    ):
        self.cwd = cwd
        self.do_reanchor = do_reanchor
        self.dry_run = dry_run
        self.threshold = threshold
        self.strict = strict
        self.debounce_ms = debounce_ms
        self.self_writes: dict[str, float] = {}
        self._debounce_timers: dict[str, float] = {}
        # Pluggable functions (to be mocked)
        self.validate_file = MagicMock(return_value=ValidationResult(valid=True))
        self.reanchor_file = MagicMock(return_value=([], 0, False))
        self.discover_sidecar = MagicMock(side_effect=lambda p, **kw: p + ".review.yaml")

    def handle_file(self, file_path: str) -> None:
        abs_path = os.path.abspath(file_path)

        # Skip self-writes (within a 2-second window)
        sw_time = self.self_writes.get(abs_path)
        if sw_time is not None and (time.time() - sw_time) < 2.0:
            return

        # Debounce
        now = time.time()
        last = self._debounce_timers.get(abs_path, 0)
        if now - last < self.debounce_ms / 1000.0:
            return
        self._debounce_timers[abs_path] = now

        is_sidecar = abs_path.endswith(".review.yaml") or abs_path.endswith(".review.json")
        is_markdown = abs_path.endswith(".md") or abs_path.endswith(".markdown")

        if is_sidecar:
            self.validate_file(abs_path)
        elif is_markdown:
            try:
                sidecar = self.discover_sidecar(abs_path, cwd=self.cwd)
            except Exception:
                return

            if self.do_reanchor:
                opts = ReanchorOptions(
                    cwd=self.cwd,
                    dry_run=self.dry_run,
                    threshold=self.threshold,
                )
                result = self.reanchor_file(sidecar, opts)
                if isinstance(result, tuple) and len(result) == 3 and result[2]:
                    self.self_writes[os.path.abspath(sidecar)] = time.time()

            self.validate_file(sidecar)


@pytest.fixture()
def tmp_dir():
    with tempfile.TemporaryDirectory() as d:
        yield d


# =========================================================================
# Tests
# =========================================================================


class TestWatchSidecarChangeTriggersValidate:
    def test_calls_validate_file_when_a_sidecar_file_changes(self, tmp_dir):
        handler = WatchHandler(cwd=tmp_dir, debounce_ms=50)
        sidecar_path = os.path.join(tmp_dir, "doc.md.review.yaml")

        handler.handle_file(sidecar_path)

        handler.validate_file.assert_called_once_with(os.path.abspath(sidecar_path))
        handler.reanchor_file.assert_not_called()


class TestWatchMarkdownChangeWithoutReanchor:
    def test_validates_sidecar_but_does_not_reanchor(self, tmp_dir):
        handler = WatchHandler(cwd=tmp_dir, debounce_ms=50)
        md_path = os.path.join(tmp_dir, "doc.md")

        handler.handle_file(md_path)

        handler.reanchor_file.assert_not_called()
        handler.validate_file.assert_called_once_with(md_path + ".review.yaml")


class TestWatchMarkdownChangeWithReanchor:
    def test_calls_reanchor_file_and_then_validate_file(self, tmp_dir):
        handler = WatchHandler(cwd=tmp_dir, debounce_ms=50, do_reanchor=True)
        md_path = os.path.join(tmp_dir, "doc.md")
        sidecar = md_path + ".review.yaml"

        handler.handle_file(md_path)

        handler.reanchor_file.assert_called_once()
        args = handler.reanchor_file.call_args
        assert args[0][0] == sidecar
        assert isinstance(args[0][1], ReanchorOptions)
        handler.validate_file.assert_called_once_with(sidecar)

    def test_respects_dry_run_flag(self, tmp_dir):
        handler = WatchHandler(cwd=tmp_dir, debounce_ms=50, do_reanchor=True, dry_run=True)
        md_path = os.path.join(tmp_dir, "doc.md")

        handler.handle_file(md_path)

        opts = handler.reanchor_file.call_args[0][1]
        assert isinstance(opts, ReanchorOptions)
        assert opts.dry_run is True

    def test_passes_threshold_to_reanchor_file(self, tmp_dir):
        handler = WatchHandler(cwd=tmp_dir, debounce_ms=50, do_reanchor=True, threshold=0.8)
        md_path = os.path.join(tmp_dir, "doc.md")

        handler.handle_file(md_path)

        opts = handler.reanchor_file.call_args[0][1]
        assert isinstance(opts, ReanchorOptions)
        assert opts.threshold == 0.8

    def test_passes_reanchor_options_not_kwargs(self, tmp_dir):
        """Regression: reanchor_file must receive ReanchorOptions, not kwargs."""
        handler = WatchHandler(cwd=tmp_dir, debounce_ms=50, do_reanchor=True, threshold=0.7)
        handler.dry_run = True
        md_path = os.path.join(tmp_dir, "doc.md")

        handler.handle_file(md_path)

        args, kwargs = handler.reanchor_file.call_args
        # Must be positional args (sidecar, opts), no kwargs
        assert len(args) == 2
        assert len(kwargs) == 0
        assert isinstance(args[1], ReanchorOptions)
        assert args[1].threshold == 0.7
        assert args[1].dry_run is True


class TestWatchDebounce:
    def test_coalesces_rapid_events_into_a_single_handler_call(self, tmp_dir):
        handler = WatchHandler(cwd=tmp_dir, debounce_ms=500)
        sidecar_path = os.path.join(tmp_dir, "doc.md.review.yaml")

        # Fire 5 events in rapid succession
        for _ in range(5):
            handler.handle_file(sidecar_path)

        # Should only be called once due to debounce
        assert handler.validate_file.call_count == 1


class TestWatchAddEvent:
    def test_treats_add_events_the_same_as_change_events(self, tmp_dir):
        handler = WatchHandler(cwd=tmp_dir, debounce_ms=50)
        sidecar_path = os.path.join(tmp_dir, "doc.md.review.yaml")

        handler.handle_file(sidecar_path)

        handler.validate_file.assert_called_once_with(os.path.abspath(sidecar_path))


class TestWatchSelfWriteSuppression:
    def test_does_not_re_validate_when_reanchor_writes_the_sidecar(self, tmp_dir):
        handler = WatchHandler(cwd=tmp_dir, debounce_ms=50, do_reanchor=True)
        handler.reanchor_file.return_value = ([], 1, True)  # written=True

        md_path = os.path.join(tmp_dir, "doc.md")
        sidecar_path = os.path.abspath(md_path + ".review.yaml")

        # Markdown change triggers reanchor → marks sidecar as self-write
        handler.handle_file(md_path)
        handler.reanchor_file.assert_called_once()

        validate_count_before = handler.validate_file.call_count

        # Now handle the sidecar "change" from the self-write — should be suppressed
        # Need to advance time past debounce
        handler._debounce_timers.pop(sidecar_path, None)
        handler.handle_file(sidecar_path)

        assert handler.validate_file.call_count == validate_count_before


class TestWatchNoSidecarFound:
    def test_handles_gracefully_when_markdown_has_no_sidecar(self, tmp_dir):
        handler = WatchHandler(cwd=tmp_dir, debounce_ms=50)
        handler.discover_sidecar.side_effect = Exception("No sidecar")

        md_path = os.path.join(tmp_dir, "other.md")
        handler.handle_file(md_path)

        handler.validate_file.assert_not_called()
        handler.reanchor_file.assert_not_called()


class TestWatchSignalCleanup:
    def test_restores_previous_signal_handlers_on_cleanup(self):
        previous_sigint = signal.getsignal(signal.SIGINT)
        previous_sigterm = signal.getsignal(signal.SIGTERM)

        shutdown = MagicMock()
        cleanup = register_signal_handlers(shutdown)

        try:
            assert signal.getsignal(signal.SIGINT) is not previous_sigint
            assert signal.getsignal(signal.SIGTERM) is not previous_sigterm
        finally:
            cleanup()

        assert signal.getsignal(signal.SIGINT) == previous_sigint
        assert signal.getsignal(signal.SIGTERM) == previous_sigterm

    def test_cleanup_is_idempotent(self):
        shutdown = MagicMock()
        cleanup = register_signal_handlers(shutdown)

        cleanup()
        cleanup()
