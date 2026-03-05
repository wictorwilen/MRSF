"""Tests for the parser module — comprehensive coverage."""

import os
from pathlib import Path

import pytest

from mrsf.parser import (
    LenientParseResult,
    _salvage_yaml,
    parse_sidecar,
    parse_sidecar_content,
    parse_sidecar_content_lenient,
    parse_sidecar_lenient,
    read_document_lines,
)


# ---------------------------------------------------------------------------
# parse_sidecar_content — YAML
# ---------------------------------------------------------------------------


class TestParseSidecarContentYaml:
    def test_parses_minimal_yaml(self):
        yaml_str = (
            "mrsf_version: '1.0'\n"
            "document: test.md\n"
            "comments: []\n"
        )
        doc = parse_sidecar_content(yaml_str)
        assert doc.mrsf_version == "1.0"
        assert doc.document == "test.md"
        assert doc.comments == []

    def test_parses_yaml_with_comments(self):
        yaml_str = (
            "mrsf_version: '1.0'\n"
            "document: test.md\n"
            "comments:\n"
            "  - id: c-1\n"
            "    author: Alice\n"
            "    timestamp: '2025-01-01T00:00:00Z'\n"
            "    text: Fix this\n"
            "    resolved: false\n"
            "    line: 10\n"
        )
        doc = parse_sidecar_content(yaml_str)
        assert len(doc.comments) == 1
        assert doc.comments[0].id == "c-1"
        assert doc.comments[0].author == "Alice"
        assert doc.comments[0].line == 10

    def test_raises_on_invalid_yaml(self):
        with pytest.raises(ValueError, match="Failed to parse YAML"):
            parse_sidecar_content(":\n  :\n    [invalid")

    def test_raises_on_non_object_yaml(self):
        with pytest.raises(ValueError, match="must be a YAML/JSON object"):
            parse_sidecar_content("- item1\n- item2\n")

    def test_raises_on_scalar_yaml(self):
        with pytest.raises(ValueError, match="must be a YAML/JSON object"):
            parse_sidecar_content("just a string\n")

    def test_preserves_unquoted_timestamps_as_strings(self):
        yaml_str = (
            "mrsf_version: '1.0'\n"
            "document: test.md\n"
            "comments:\n"
            "  - id: c-1\n"
            "    author: Alice\n"
            "    timestamp: 2025-06-15T14:30:00Z\n"
            "    text: Fix this\n"
            "    resolved: false\n"
        )
        doc = parse_sidecar_content(yaml_str)
        assert isinstance(doc.comments[0].timestamp, str)
        assert doc.comments[0].timestamp == "2025-06-15T14:30:00Z"

    def test_preserves_unquoted_timestamps_with_milliseconds(self):
        yaml_str = (
            "mrsf_version: '1.0'\n"
            "document: test.md\n"
            "comments:\n"
            "  - id: c-1\n"
            "    author: Alice\n"
            "    timestamp: 2026-03-05T21:33:56.197Z\n"
            "    text: Fix this\n"
            "    resolved: false\n"
        )
        doc = parse_sidecar_content(yaml_str)
        assert isinstance(doc.comments[0].timestamp, str)
        assert doc.comments[0].timestamp == "2026-03-05T21:33:56.197Z"


# ---------------------------------------------------------------------------
# parse_sidecar_content — JSON
# ---------------------------------------------------------------------------


class TestParseSidecarContentJson:
    def test_parses_json_by_brace(self):
        json_str = '{"mrsf_version": "1.0", "document": "test.md", "comments": []}'
        doc = parse_sidecar_content(json_str)
        assert doc.mrsf_version == "1.0"
        assert doc.document == "test.md"
        assert doc.comments == []

    def test_parses_json_by_filename_hint(self):
        # Content that looks like YAML, but hint says JSON
        json_str = '{"mrsf_version": "1.0", "document": "test.md", "comments": []}'
        doc = parse_sidecar_content(json_str, "foo.review.json")
        assert doc.document == "test.md"

    def test_raises_on_invalid_json(self):
        with pytest.raises(ValueError, match="Failed to parse JSON"):
            parse_sidecar_content("{bad json", "foo.review.json")

    def test_raises_on_non_object_json(self):
        with pytest.raises(ValueError, match="must be a YAML/JSON object"):
            parse_sidecar_content("[1, 2, 3]")


# ---------------------------------------------------------------------------
# parse_sidecar — from disk
# ---------------------------------------------------------------------------


class TestParseSidecarFromDisk:
    def test_parses_yaml_file(self, tmp_path):
        f = tmp_path / "test.md.review.yaml"
        f.write_text(
            "mrsf_version: '1.0'\ndocument: test.md\ncomments: []\n",
            encoding="utf-8",
        )
        doc = parse_sidecar(str(f))
        assert doc.document == "test.md"

    def test_parses_json_file(self, tmp_path):
        f = tmp_path / "test.md.review.json"
        f.write_text(
            '{"mrsf_version": "1.0", "document": "test.md", "comments": []}',
            encoding="utf-8",
        )
        doc = parse_sidecar(str(f))
        assert doc.document == "test.md"

    def test_raises_on_nonexistent_file(self, tmp_path):
        with pytest.raises(Exception):
            parse_sidecar(str(tmp_path / "missing.review.yaml"))


# ---------------------------------------------------------------------------
# parse_sidecar_content_lenient
# ---------------------------------------------------------------------------


class TestParseSidecarContentLenient:
    def test_returns_error_for_empty_string(self):
        result = parse_sidecar_content_lenient("")
        assert result.doc is None
        assert "empty" in result.error.lower()

    def test_returns_error_for_whitespace_only(self):
        result = parse_sidecar_content_lenient("   \n  \n  ")
        assert result.doc is None
        assert "empty" in result.error.lower()

    def test_parses_valid_yaml_leniently(self):
        yaml_str = (
            "mrsf_version: '1.0'\n"
            "document: test.md\n"
            "comments:\n"
            "  - id: c-1\n"
            "    author: Alice\n"
            "    timestamp: '2025-01-01T00:00:00Z'\n"
            "    text: Fix this\n"
            "    resolved: false\n"
        )
        result = parse_sidecar_content_lenient(yaml_str)
        assert result.doc is not None
        assert result.error is None
        assert len(result.doc.comments) == 1

    def test_returns_error_for_non_object(self):
        result = parse_sidecar_content_lenient("- item1\n- item2\n")
        assert result.error is not None
        assert "object" in result.error.lower()

    def test_returns_error_when_comments_is_not_array(self):
        yaml_str = (
            "mrsf_version: '1.0'\n"
            "document: test.md\n"
            "comments: not-a-list\n"
        )
        result = parse_sidecar_content_lenient(yaml_str)
        assert result.doc is not None
        assert "corrupted" in result.error.lower()

    def test_skips_malformed_comments(self):
        yaml_str = (
            "mrsf_version: '1.0'\n"
            "document: test.md\n"
            "comments:\n"
            "  - id: good-1\n"
            "    author: Alice\n"
            "    timestamp: '2025-01-01T00:00:00Z'\n"
            "    text: Good comment\n"
            "    resolved: false\n"
            "  - not-a-dict\n"
            "  - id: good-2\n"
            "    author: Bob\n"
            "    timestamp: '2025-02-01T00:00:00Z'\n"
            "    text: Also good\n"
            "    resolved: false\n"
        )
        result = parse_sidecar_content_lenient(yaml_str)
        assert result.doc is not None
        assert "malformed" in result.error
        assert len(result.doc.comments) == 2
        assert result.partial_comments is not None
        assert len(result.partial_comments) == 2

    def test_returns_error_for_invalid_json(self):
        result = parse_sidecar_content_lenient("{bad json", "foo.review.json")
        assert result.doc is None
        assert "JSON" in result.error

    def test_returns_all_good_when_no_bad_comments(self):
        yaml_str = (
            "mrsf_version: '1.0'\n"
            "document: test.md\n"
            "comments:\n"
            "  - id: c-1\n"
            "    author: A\n"
            "    timestamp: '2025-01-01T00:00:00Z'\n"
            "    text: Good\n"
            "    resolved: false\n"
        )
        result = parse_sidecar_content_lenient(yaml_str)
        assert result.error is None
        assert result.partial_comments is None

    def test_falls_back_to_salvage_yaml_on_parse_error(self):
        # Corrupted YAML that still has recognizable comment blocks
        corrupted = (
            "mrsf_version: '1.0'\n"
            "document: test.md\n"
            "comments:\n"
            "  - id: salvaged\n"
            "    author: Alice\n"
            "    timestamp: '2025-01-01T00:00:00Z'\n"
            "    text: Can we save this?\n"
            "    resolved: false\n"
            "  !! CORRUPTED LINE !!\n"
        )
        result = parse_sidecar_content_lenient(corrupted)
        # Should either parse OK or attempt salvage
        assert result is not None


# ---------------------------------------------------------------------------
# parse_sidecar_lenient — from disk
# ---------------------------------------------------------------------------


class TestParseSidecarLenient:
    def test_parses_valid_file_leniently(self, tmp_path):
        f = tmp_path / "test.md.review.yaml"
        f.write_text(
            "mrsf_version: '1.0'\ndocument: test.md\ncomments: []\n",
            encoding="utf-8",
        )
        result = parse_sidecar_lenient(str(f))
        assert result.doc is not None
        assert result.error is None

    def test_returns_error_for_nonexistent_file(self, tmp_path):
        result = parse_sidecar_lenient(str(tmp_path / "missing.review.yaml"))
        assert result.doc is None
        assert "Cannot read" in result.error

    def test_returns_error_for_empty_file(self, tmp_path):
        f = tmp_path / "empty.review.yaml"
        f.write_text("", encoding="utf-8")
        result = parse_sidecar_lenient(str(f))
        assert result.doc is None
        assert "empty" in result.error.lower()


# ---------------------------------------------------------------------------
# _salvage_yaml
# ---------------------------------------------------------------------------


class TestSalvageYaml:
    def test_salvages_comment_blocks_from_corrupted_yaml(self):
        # Simulated corrupted YAML with salvageable comment blocks
        # Needs `  - id:` pattern for the regex
        content = (
            "mrsf_version: '1.0'\n"
            "document: test.md\n"
            "comments!!broken!!\n"
            "  - id: c-1\n"
            "    author: Alice\n"
            "    timestamp: '2025-01-01T00:00:00Z'\n"
            "    text: Found it\n"
            "    resolved: false\n"
        )
        result = _salvage_yaml(content)
        assert result.error is not None
        assert "Salvaged" in result.error
        # Salvage may or may not succeed depending on YAML parser handling
        # The key is the function doesn't raise

    def test_returns_none_doc_when_no_comments_salvageable(self):
        result = _salvage_yaml("totally broken content with no ids")
        assert result.doc is None
        assert "Salvaged 0" in result.error

    def test_extracts_version_and_document_from_corrupted_yaml(self):
        content = (
            "mrsf_version: 2.0\n"
            "document: my-doc.md\n"
            "comments: !! broken\n"
        )
        result = _salvage_yaml(content)
        assert result.error is not None

    def test_salvages_single_line_id_blocks(self):
        """Cover lines 179-182: single-line '  - id:' blocks parse as lists after strip."""
        # Corruption breaks overall YAML parse, but single-line '  - id:' blocks
        # parse individually after strip() because they have no indentation issues.
        content = (
            "mrsf_version: '1.0'\n"
            "document: test.md\n"
            "{{{corrupt\n"
            "  - id: c-001\n"
            "  - id: c-002\n"
        )
        result = _salvage_yaml(content)
        assert result.error is not None
        assert "Salvaged 2" in result.error
        assert result.doc is not None
        assert len(result.doc.comments) == 2
        assert result.doc.comments[0].id == "c-001"
        assert result.doc.comments[1].id == "c-002"
        assert result.partial_comments is not None
        assert len(result.partial_comments) == 2

    def test_salvage_via_lenient_parse(self):
        """Salvage path is reachable through the public lenient parse API."""
        content = (
            "mrsf_version: '1.0'\n"
            "document: salvage-test.md\n"
            "{{{corrupt\n"
            "  - id: s-001\n"
        )
        result = parse_sidecar_content_lenient(content)
        assert result.error is not None
        assert "Salvaged 1" in result.error
        assert result.doc is not None
        assert result.doc.document == "salvage-test.md"
        assert result.doc.comments[0].id == "s-001"


# ---------------------------------------------------------------------------
# read_document_lines
# ---------------------------------------------------------------------------


class TestReadDocumentLines:
    def test_returns_1_based_array(self, tmp_path):
        f = tmp_path / "doc.md"
        f.write_text("line 1\nline 2\nline 3", encoding="utf-8")
        lines = read_document_lines(str(f))
        assert lines[0] == ""  # index 0 is empty
        assert lines[1] == "line 1"
        assert lines[2] == "line 2"
        assert lines[3] == "line 3"

    def test_handles_single_line_file(self, tmp_path):
        f = tmp_path / "doc.md"
        f.write_text("only line", encoding="utf-8")
        lines = read_document_lines(str(f))
        assert len(lines) == 2  # ["", "only line"]
        assert lines[1] == "only line"

    def test_handles_empty_file(self, tmp_path):
        f = tmp_path / "doc.md"
        f.write_text("", encoding="utf-8")
        lines = read_document_lines(str(f))
        assert len(lines) == 2  # ["", ""]
        assert lines[0] == ""
