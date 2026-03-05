"""Tests for the resolve_files module — comprehensive coverage."""

import os
from pathlib import Path

from mrsf.resolve_files import _is_sidecar_path, resolve_sidecar_paths


# ---------------------------------------------------------------------------
# _is_sidecar_path
# ---------------------------------------------------------------------------


class TestIsSidecarPath:
    def test_detects_review_yaml(self):
        assert _is_sidecar_path("doc.md.review.yaml") is True

    def test_detects_review_json(self):
        assert _is_sidecar_path("doc.md.review.json") is True

    def test_rejects_plain_markdown(self):
        assert _is_sidecar_path("doc.md") is False

    def test_rejects_plain_yaml(self):
        assert _is_sidecar_path("config.yaml") is False


# ---------------------------------------------------------------------------
# resolve_sidecar_paths
# ---------------------------------------------------------------------------


class TestResolveSidecarPaths:
    def test_returns_sidecar_paths_as_is(self, tmp_path):
        sidecar = tmp_path / "doc.md.review.yaml"
        sidecar.write_text("", encoding="utf-8")
        result = resolve_sidecar_paths(
            [str(sidecar)],
            str(tmp_path),
        )
        assert len(result) == 1
        assert result[0].endswith("doc.md.review.yaml")

    def test_discovers_sidecar_for_markdown_file(self, tmp_path):
        # Create a workspace root marker
        (tmp_path / ".git").mkdir()
        doc = tmp_path / "doc.md"
        doc.write_text("# Hello", encoding="utf-8")
        result = resolve_sidecar_paths(
            ["doc.md"],
            str(tmp_path),
        )
        assert len(result) == 1
        assert result[0].endswith("doc.md.review.yaml")

    def test_discovers_json_sidecar_passthrough(self, tmp_path):
        sidecar = tmp_path / "doc.md.review.json"
        sidecar.write_text("{}", encoding="utf-8")
        result = resolve_sidecar_paths(
            [str(sidecar)],
            str(tmp_path),
        )
        assert len(result) == 1
        assert result[0].endswith("doc.md.review.json")

    def test_discovers_all_sidecars_when_files_empty(self, tmp_path):
        (tmp_path / ".git").mkdir()
        (tmp_path / "a.md.review.yaml").write_text("", encoding="utf-8")
        (tmp_path / "b.md.review.yaml").write_text("", encoding="utf-8")
        result = resolve_sidecar_paths([], str(tmp_path))
        assert len(result) == 2

    def test_returns_empty_when_no_sidecars_in_workspace(self, tmp_path):
        (tmp_path / ".git").mkdir()
        result = resolve_sidecar_paths([], str(tmp_path))
        assert len(result) == 0

    def test_handles_mixed_inputs(self, tmp_path):
        (tmp_path / ".git").mkdir()
        sidecar = tmp_path / "existing.md.review.yaml"
        sidecar.write_text("", encoding="utf-8")
        doc = tmp_path / "other.md"
        doc.write_text("# Hello", encoding="utf-8")
        result = resolve_sidecar_paths(
            [str(sidecar), "other.md"],
            str(tmp_path),
        )
        assert len(result) == 2
        assert any(r.endswith("existing.md.review.yaml") for r in result)
        assert any(r.endswith("other.md.review.yaml") for r in result)
