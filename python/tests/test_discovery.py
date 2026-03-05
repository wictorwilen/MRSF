"""Tests for the discovery module — 1:1 match with discovery.test.ts."""

import os
import re
from pathlib import Path

from mrsf.discovery import (
    discover_all_sidecars,
    discover_sidecar,
    find_workspace_root,
    load_config,
    sidecar_to_document,
)


# ---------------------------------------------------------------------------
# sidecarToDocument
# ---------------------------------------------------------------------------


class TestSidecarToDocument:
    def test_strips_review_yaml_suffix(self):
        result = sidecar_to_document("doc.md.review.yaml")
        assert result.endswith("doc.md")

    def test_strips_review_json_suffix(self):
        result = sidecar_to_document("doc.md.review.json")
        assert result.endswith("doc.md")

    def test_handles_nested_paths(self):
        result = sidecar_to_document("docs/guide/setup.md.review.yaml")
        assert re.search(r"docs[/\\]guide[/\\]setup\.md$", result)

    def test_returns_path_unchanged_if_no_review_suffix(self):
        result = sidecar_to_document("plain-file.md")
        assert result.endswith("plain-file.md")


# ---------------------------------------------------------------------------
# findWorkspaceRoot
# ---------------------------------------------------------------------------


class TestFindWorkspaceRoot:
    def test_finds_git_root(self, tmp_path):
        (tmp_path / ".git").mkdir()
        sub = tmp_path / "sub" / "dir"
        sub.mkdir(parents=True)
        result = find_workspace_root(str(sub))
        assert result == str(tmp_path)

    def test_finds_mrsf_yaml_root(self, tmp_path):
        (tmp_path / ".mrsf.yaml").write_text("sidecar_root: reviews\n")
        sub = tmp_path / "deep" / "sub"
        sub.mkdir(parents=True)
        result = find_workspace_root(str(sub))
        assert result == str(tmp_path)

    def test_returns_start_dir_when_no_root_found(self, tmp_path):
        # tmp_path likely has no .git or .mrsf.yaml above it
        isolated = tmp_path / "isolated"
        isolated.mkdir()
        result = find_workspace_root(str(isolated))
        assert result == str(isolated)

    def test_prefers_closest_marker(self, tmp_path):
        (tmp_path / ".git").mkdir()
        sub = tmp_path / "child"
        sub.mkdir()
        (sub / ".mrsf.yaml").write_text("")
        result = find_workspace_root(str(sub))
        assert result == str(sub)


# ---------------------------------------------------------------------------
# loadConfig
# ---------------------------------------------------------------------------


class TestLoadConfig:
    def test_returns_none_when_no_config(self, tmp_path):
        result = load_config(str(tmp_path))
        assert result is None

    def test_loads_sidecar_root(self, tmp_path):
        (tmp_path / ".mrsf.yaml").write_text("sidecar_root: reviews\n")
        config = load_config(str(tmp_path))
        assert config is not None
        assert config.sidecar_root == "reviews"

    def test_raises_on_absolute_sidecar_root(self, tmp_path):
        (tmp_path / ".mrsf.yaml").write_text("sidecar_root: /abs/path\n")
        import pytest
        with pytest.raises(ValueError, match="relative path"):
            load_config(str(tmp_path))

    def test_raises_on_traversal_in_sidecar_root(self, tmp_path):
        (tmp_path / ".mrsf.yaml").write_text("sidecar_root: ../outside\n")
        import pytest
        with pytest.raises(ValueError, match='\\.\\.'):
            load_config(str(tmp_path))

    def test_returns_none_for_non_dict_yaml(self, tmp_path):
        (tmp_path / ".mrsf.yaml").write_text("- item1\n- item2\n")
        result = load_config(str(tmp_path))
        assert result is None

    def test_uses_custom_config_path(self, tmp_path):
        custom = tmp_path / "custom-config.yaml"
        custom.write_text("sidecar_root: custom-reviews\n")
        config = load_config(str(tmp_path), config_path=str(custom))
        assert config is not None
        assert config.sidecar_root == "custom-reviews"

    def test_returns_config_without_sidecar_root(self, tmp_path):
        (tmp_path / ".mrsf.yaml").write_text("some_other_field: value\n")
        config = load_config(str(tmp_path))
        assert config is not None
        assert config.sidecar_root is None


# ---------------------------------------------------------------------------
# discoverSidecar
# ---------------------------------------------------------------------------


class TestDiscoverSidecar:
    def test_co_located_sidecar(self, tmp_path):
        (tmp_path / ".git").mkdir()
        result = discover_sidecar("doc.md", cwd=str(tmp_path))
        expected = str(tmp_path / "doc.md.review.yaml")
        assert result == expected

    def test_sidecar_root_from_config(self, tmp_path):
        (tmp_path / ".mrsf.yaml").write_text("sidecar_root: reviews\n")
        result = discover_sidecar("doc.md", cwd=str(tmp_path))
        expected = str(tmp_path / "reviews" / "doc.md.review.yaml")
        assert result == expected

    def test_absolute_document_path(self, tmp_path):
        (tmp_path / ".git").mkdir()
        abs_doc = str(tmp_path / "docs" / "guide.md")
        result = discover_sidecar(abs_doc, cwd=str(tmp_path))
        assert result.endswith("guide.md.review.yaml")

    def test_uses_config_path(self, tmp_path):
        custom = tmp_path / "alt.yaml"
        custom.write_text("sidecar_root: alt-reviews\n")
        (tmp_path / ".git").mkdir()
        result = discover_sidecar("doc.md", cwd=str(tmp_path), config_path=str(custom))
        assert "alt-reviews" in result


# ---------------------------------------------------------------------------
# discoverAllSidecars
# ---------------------------------------------------------------------------


class TestDiscoverAllSidecars:
    def test_finds_yaml_sidecars(self, tmp_path):
        (tmp_path / "a.md.review.yaml").write_text("")
        (tmp_path / "b.md.review.yaml").write_text("")
        result = discover_all_sidecars(str(tmp_path))
        assert len(result) == 2

    def test_finds_json_sidecars(self, tmp_path):
        (tmp_path / "a.md.review.json").write_text("")
        result = discover_all_sidecars(str(tmp_path))
        assert len(result) == 1

    def test_skips_node_modules_and_git(self, tmp_path):
        nm = tmp_path / "node_modules"
        nm.mkdir()
        (nm / "pkg.md.review.yaml").write_text("")
        git = tmp_path / ".git"
        git.mkdir()
        (git / "some.md.review.yaml").write_text("")
        (tmp_path / "real.md.review.yaml").write_text("")
        result = discover_all_sidecars(str(tmp_path))
        assert len(result) == 1

    def test_recurses_into_subdirectories(self, tmp_path):
        sub = tmp_path / "docs" / "guide"
        sub.mkdir(parents=True)
        (sub / "setup.md.review.yaml").write_text("")
        (tmp_path / "root.md.review.yaml").write_text("")
        result = discover_all_sidecars(str(tmp_path))
        assert len(result) == 2

    def test_returns_single_file_when_given_a_file(self, tmp_path):
        f = tmp_path / "single.md.review.yaml"
        f.write_text("")
        result = discover_all_sidecars(str(f))
        assert len(result) == 1
        assert result[0] == str(f)

    def test_returns_empty_for_empty_directory(self, tmp_path):
        result = discover_all_sidecars(str(tmp_path))
        assert len(result) == 0

    def test_handles_permission_error_in_subdirectory(self, tmp_path):
        """Cover lines 113-114: PermissionError during walk."""
        import os
        import stat

        # Create a restricted subdirectory
        restricted = tmp_path / "restricted"
        restricted.mkdir()
        (restricted / "file.md.review.yaml").write_text("")
        # Remove read/execute permissions
        restricted.chmod(0o000)
        try:
            # Also have an accessible file
            (tmp_path / "accessible.md.review.yaml").write_text("")
            result = discover_all_sidecars(str(tmp_path))
            assert len(result) == 1
            assert "accessible" in result[0]
        finally:
            # Restore permissions for cleanup
            restricted.chmod(stat.S_IRWXU)
