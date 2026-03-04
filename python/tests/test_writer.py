"""Tests for the MRSF Writer — 1:1 match with writer.test.ts.

Round-trip, serialisation, hash logic, YAML-special quoting, concurrent writes.
"""

import json
import os
import tempfile
import threading
from pathlib import Path

import pytest
from ruamel.yaml import YAML

from mrsf.types import Comment, MrsfDocument
from mrsf.writer import compute_hash, sync_hash, to_json, to_yaml, write_sidecar

_yaml = YAML()


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def make_doc(comments: list[Comment] | None = None) -> MrsfDocument:
    return MrsfDocument(mrsf_version="1.0", document="test.md", comments=comments or [])


def make_comment(**overrides) -> Comment:
    defaults = dict(
        id="c-001",
        author="Alice",
        timestamp="2026-01-01T00:00:00Z",
        text="Fix this",
        resolved=False,
    )
    defaults.update(overrides)
    return Comment(**defaults)


@pytest.fixture()
def tmp_dir(tmp_path):
    return tmp_path


# =========================================================================
# computeHash
# =========================================================================


class TestComputeHash:
    def test_returns_a_64_char_hex_sha256(self):
        h = compute_hash("hello")
        assert len(h) == 64
        assert all(c in "0123456789abcdef" for c in h)

    def test_is_deterministic(self):
        assert compute_hash("test") == compute_hash("test")

    def test_differs_for_different_inputs(self):
        assert compute_hash("a") != compute_hash("b")


# =========================================================================
# syncHash
# =========================================================================


class TestSyncHash:
    def test_sets_hash_when_selected_text_is_present(self):
        c = make_comment(selected_text="hello")
        sync_hash(c)
        assert c.selected_text_hash == compute_hash("hello")

    def test_removes_hash_when_selected_text_is_absent(self):
        c = make_comment(selected_text_hash="stale")
        sync_hash(c)
        assert c.selected_text_hash is None

    def test_removes_hash_when_selected_text_is_empty_string(self):
        c = make_comment(selected_text="", selected_text_hash="stale")
        sync_hash(c)
        assert c.selected_text_hash is None

    def test_returns_the_same_comment_object(self):
        c = make_comment(selected_text="x")
        ret = sync_hash(c)
        assert ret is c


# =========================================================================
# toYaml
# =========================================================================


class TestToYaml:
    def test_produces_parseable_yaml_with_correct_fields(self):
        doc = make_doc([make_comment()])
        yaml_str = to_yaml(doc)
        assert "mrsf_version:" in yaml_str
        assert "document: test.md" in yaml_str
        assert "comments:" in yaml_str
        assert "id: c-001" in yaml_str
        assert "author: Alice" in yaml_str

    def test_serialises_an_empty_comments_array(self):
        doc = make_doc()
        yaml_str = to_yaml(doc)
        assert "comments: []" in yaml_str


# =========================================================================
# toJson
# =========================================================================


class TestToJson:
    def test_produces_valid_json(self):
        doc = make_doc([make_comment()])
        json_str = to_json(doc)
        parsed = json.loads(json_str)
        assert parsed["mrsf_version"] == "1.0"
        assert len(parsed["comments"]) == 1
        assert parsed["comments"][0]["id"] == "c-001"

    def test_ends_with_a_trailing_newline(self):
        json_str = to_json(make_doc())
        assert json_str.endswith("\n")


# =========================================================================
# writeSidecar — new file
# =========================================================================


class TestWriteSidecarNewFile:
    def test_creates_a_yaml_file_with_all_fields(self, tmp_dir):
        fp = str(tmp_dir / "new.review.yaml")
        doc = make_doc([make_comment(line=5, selected_text="hi")])
        write_sidecar(fp, doc)
        content = Path(fp).read_text(encoding="utf-8")
        assert "mrsf_version:" in content
        assert "id: c-001" in content
        assert "selected_text_hash:" in content

    def test_creates_a_json_file_when_path_ends_in_review_json(self, tmp_dir):
        fp = str(tmp_dir / "new.review.json")
        doc = make_doc([make_comment()])
        write_sidecar(fp, doc)
        content = Path(fp).read_text(encoding="utf-8")
        parsed = json.loads(content)
        assert parsed["mrsf_version"] == "1.0"


# =========================================================================
# writeSidecar — round-trip preservation
# =========================================================================


class TestWriteSidecarRoundTrip:
    def test_is_byte_identical_when_nothing_changed(self, tmp_dir):
        fp = str(tmp_dir / "rt.review.yaml")
        original = (
            f'mrsf_version: "1.0"\n'
            f"document: test.md\n"
            f"comments:\n"
            f"  - id: c-001\n"
            f"    author: Alice\n"
            f'    timestamp: "2026-01-01T00:00:00Z"\n'
            f"    text: Fix this\n"
            f"    resolved: false\n"
            f"    line: 5\n"
            f"    selected_text: hello world\n"
            f"    selected_text_hash: {compute_hash('hello world')}\n"
            f"    commit: abc123\n"
        )
        Path(fp).write_text(original, encoding="utf-8")

        doc = MrsfDocument(
            mrsf_version="1.0",
            document="test.md",
            comments=[Comment(
                id="c-001", author="Alice", timestamp="2026-01-01T00:00:00Z",
                text="Fix this", resolved=False, line=5,
                selected_text="hello world", selected_text_hash=compute_hash("hello world"),
                commit="abc123",
            )],
        )
        write_sidecar(fp, doc)
        result = Path(fp).read_text(encoding="utf-8")
        assert result == original

    def test_preserves_yaml_comments(self, tmp_dir):
        fp = str(tmp_dir / "comments.review.yaml")
        original = (
            '# Auto-generated sidecar\n'
            'mrsf_version: "1.0"\n'
            'document: test.md\n'
            '# Review comments below\n'
            'comments:\n'
            '  - id: c-001\n'
            '    author: Alice\n'
            '    timestamp: "2026-01-01T00:00:00Z"\n'
            '    text: Fix this\n'
            '    resolved: false\n'
        )
        Path(fp).write_text(original, encoding="utf-8")
        doc = MrsfDocument(
            mrsf_version="1.0", document="test.md",
            comments=[Comment(
                id="c-001", author="Alice", timestamp="2026-01-01T00:00:00Z",
                text="Fix this", resolved=False,
            )],
        )
        write_sidecar(fp, doc)
        result = Path(fp).read_text(encoding="utf-8")
        assert result == original

    def test_preserves_block_scalar_styles(self, tmp_dir):
        fp = str(tmp_dir / "block.review.yaml")
        original = (
            'mrsf_version: "1.0"\n'
            'document: test.md\n'
            'comments:\n'
            '  - id: c-001\n'
            '    author: Alice\n'
            '    timestamp: "2026-01-01T00:00:00Z"\n'
            '    text: |\n'
            '      This is a long comment\n'
            '      that spans multiple lines.\n'
            '    resolved: false\n'
        )
        Path(fp).write_text(original, encoding="utf-8")
        doc = MrsfDocument(
            mrsf_version="1.0", document="test.md",
            comments=[Comment(
                id="c-001", author="Alice", timestamp="2026-01-01T00:00:00Z",
                text="This is a long comment\nthat spans multiple lines.\n",
                resolved=False,
            )],
        )
        write_sidecar(fp, doc)
        result = Path(fp).read_text(encoding="utf-8")
        assert result == original

    def test_preserves_quoted_string_styles(self, tmp_dir):
        fp = str(tmp_dir / "quoted.review.yaml")
        original = (
            'mrsf_version: "1.0"\n'
            'document: test.md\n'
            'comments:\n'
            "  - id: \"c-001\"\n"
            "    author: 'Alice'\n"
            '    timestamp: "2026-01-01T00:00:00Z"\n'
            '    text: Fix this\n'
            '    resolved: false\n'
        )
        Path(fp).write_text(original, encoding="utf-8")
        doc = MrsfDocument(
            mrsf_version="1.0", document="test.md",
            comments=[Comment(
                id="c-001", author="Alice", timestamp="2026-01-01T00:00:00Z",
                text="Fix this", resolved=False,
            )],
        )
        write_sidecar(fp, doc)
        result = Path(fp).read_text(encoding="utf-8")
        assert result == original

    def test_preserves_key_ordering(self, tmp_dir):
        fp = str(tmp_dir / "order.review.yaml")
        # Non-standard key order: resolved before text
        original = (
            'mrsf_version: "1.0"\n'
            'document: test.md\n'
            'comments:\n'
            '  - id: c-001\n'
            '    resolved: false\n'
            '    author: Alice\n'
            '    timestamp: "2026-01-01T00:00:00Z"\n'
            '    text: Fix this\n'
        )
        Path(fp).write_text(original, encoding="utf-8")
        doc = MrsfDocument(
            mrsf_version="1.0", document="test.md",
            comments=[Comment(
                id="c-001", resolved=False, author="Alice",
                timestamp="2026-01-01T00:00:00Z", text="Fix this",
            )],
        )
        write_sidecar(fp, doc)
        result = Path(fp).read_text(encoding="utf-8")
        assert result == original


# =========================================================================
# writeSidecar — surgical edits
# =========================================================================


class TestWriteSidecarSurgicalEdits:
    def test_only_changes_the_modified_value(self, tmp_dir):
        fp = str(tmp_dir / "edit.review.yaml")
        original = (
            'mrsf_version: "1.0"\n'
            'document: test.md\n'
            'comments:\n'
            '  - id: c-001\n'
            '    author: Alice\n'
            '    timestamp: "2026-01-01T00:00:00Z"\n'
            '    text: Fix this\n'
            '    resolved: false\n'
        )
        Path(fp).write_text(original, encoding="utf-8")
        doc = MrsfDocument(
            mrsf_version="1.0", document="test.md",
            comments=[Comment(
                id="c-001", author="Alice", timestamp="2026-01-01T00:00:00Z",
                text="Fix this", resolved=True,  # changed
            )],
        )
        write_sidecar(fp, doc)
        result = Path(fp).read_text(encoding="utf-8")
        assert "resolved: true" in result
        assert "author: Alice" in result
        assert "text: Fix this" in result
        expected = original.replace("resolved: false", "resolved: true")
        assert result == expected

    def test_updates_line_number_without_touching_other_fields(self, tmp_dir):
        fp = str(tmp_dir / "line.review.yaml")
        original = (
            'mrsf_version: "1.0"\n'
            'document: test.md\n'
            'comments:\n'
            '  - id: c-001\n'
            '    author: Alice\n'
            '    timestamp: "2026-01-01T00:00:00Z"\n'
            '    text: Fix this\n'
            '    resolved: false\n'
            '    line: 10\n'
            '    commit: abc123\n'
        )
        Path(fp).write_text(original, encoding="utf-8")
        doc = MrsfDocument(
            mrsf_version="1.0", document="test.md",
            comments=[Comment(
                id="c-001", author="Alice", timestamp="2026-01-01T00:00:00Z",
                text="Fix this", resolved=False, line=15, commit="abc123",
            )],
        )
        write_sidecar(fp, doc)
        result = Path(fp).read_text(encoding="utf-8")
        expected = original.replace("line: 10", "line: 15")
        assert result == expected


# =========================================================================
# writeSidecar — comment mutations
# =========================================================================


class TestWriteSidecarCommentMutations:
    TWO_COMMENTS = (
        'mrsf_version: "1.0"\n'
        'document: test.md\n'
        'comments:\n'
        '  - id: c-001\n'
        '    author: Alice\n'
        '    timestamp: "2026-01-01T00:00:00Z"\n'
        '    text: First comment\n'
        '    resolved: false\n'
        '  - id: c-002\n'
        '    author: Bob\n'
        '    timestamp: "2026-01-02T00:00:00Z"\n'
        '    text: Second comment\n'
        '    resolved: false\n'
    )

    def test_appends_a_new_comment_while_preserving_existing_ones(self, tmp_dir):
        fp = str(tmp_dir / "append.review.yaml")
        Path(fp).write_text(self.TWO_COMMENTS, encoding="utf-8")
        doc = MrsfDocument(
            mrsf_version="1.0", document="test.md",
            comments=[
                Comment(id="c-001", author="Alice", timestamp="2026-01-01T00:00:00Z", text="First comment", resolved=False),
                Comment(id="c-002", author="Bob", timestamp="2026-01-02T00:00:00Z", text="Second comment", resolved=False),
                Comment(id="c-003", author="Carol", timestamp="2026-01-03T00:00:00Z", text="New comment", resolved=False),
            ],
        )
        write_sidecar(fp, doc)
        result = Path(fp).read_text(encoding="utf-8")
        assert result.startswith(self.TWO_COMMENTS.rstrip())
        assert "id: c-003" in result
        assert "author: Carol" in result
        assert "text: New comment" in result

    def test_removes_a_comment_while_preserving_others(self, tmp_dir):
        fp = str(tmp_dir / "remove.review.yaml")
        Path(fp).write_text(self.TWO_COMMENTS, encoding="utf-8")
        doc = MrsfDocument(
            mrsf_version="1.0", document="test.md",
            comments=[
                Comment(id="c-002", author="Bob", timestamp="2026-01-02T00:00:00Z", text="Second comment", resolved=False),
            ],
        )
        write_sidecar(fp, doc)
        result = Path(fp).read_text(encoding="utf-8")
        assert "c-001" not in result
        assert "Alice" not in result
        assert "id: c-002" in result
        assert "author: Bob" in result


# =========================================================================
# writeSidecar — hash management
# =========================================================================


class TestWriteSidecarHashManagement:
    def test_does_not_inject_selected_text_hash_if_it_was_not_originally_present(self, tmp_dir):
        fp = str(tmp_dir / "nohash.review.yaml")
        original = (
            'mrsf_version: "1.0"\n'
            'document: test.md\n'
            'comments:\n'
            '  - id: c-001\n'
            '    author: Alice\n'
            '    timestamp: "2026-01-01T00:00:00Z"\n'
            '    text: Fix this\n'
            '    resolved: false\n'
            '    line: 5\n'
            '    selected_text: hello world\n'
        )
        Path(fp).write_text(original, encoding="utf-8")
        doc = MrsfDocument(
            mrsf_version="1.0", document="test.md",
            comments=[Comment(
                id="c-001", author="Alice", timestamp="2026-01-01T00:00:00Z",
                text="Fix this", resolved=False, line=5, selected_text="hello world",
            )],
        )
        write_sidecar(fp, doc)
        result = Path(fp).read_text(encoding="utf-8")
        assert "selected_text_hash" not in result
        assert result == original

    def test_updates_hash_when_selected_text_changes_and_hash_was_tracked(self, tmp_dir):
        fp = str(tmp_dir / "hashupdate.review.yaml")
        old_hash = compute_hash("old text")
        original = (
            'mrsf_version: "1.0"\n'
            'document: test.md\n'
            'comments:\n'
            '  - id: c-001\n'
            '    author: Alice\n'
            '    timestamp: "2026-01-01T00:00:00Z"\n'
            '    text: Fix this\n'
            '    resolved: false\n'
            f'    selected_text: old text\n'
            f'    selected_text_hash: {old_hash}\n'
        )
        Path(fp).write_text(original, encoding="utf-8")
        doc = MrsfDocument(
            mrsf_version="1.0", document="test.md",
            comments=[Comment(
                id="c-001", author="Alice", timestamp="2026-01-01T00:00:00Z",
                text="Fix this", resolved=False, selected_text="new text",
                selected_text_hash=compute_hash("new text"),
            )],
        )
        write_sidecar(fp, doc)
        result = Path(fp).read_text(encoding="utf-8")
        assert "selected_text: new text" in result
        assert compute_hash("new text") in result
        assert old_hash not in result

    def test_adds_hash_for_brand_new_comments_with_selected_text(self, tmp_dir):
        fp = str(tmp_dir / "newhash.review.yaml")
        original = (
            'mrsf_version: "1.0"\n'
            'document: test.md\n'
            'comments:\n'
            '  - id: c-001\n'
            '    author: Alice\n'
            '    timestamp: "2026-01-01T00:00:00Z"\n'
            '    text: Existing\n'
            '    resolved: false\n'
        )
        Path(fp).write_text(original, encoding="utf-8")
        doc = MrsfDocument(
            mrsf_version="1.0", document="test.md",
            comments=[
                Comment(id="c-001", author="Alice", timestamp="2026-01-01T00:00:00Z", text="Existing", resolved=False),
                Comment(id="c-002", author="Bob", timestamp="2026-01-02T00:00:00Z", text="New", resolved=False, selected_text="some code"),
            ],
        )
        write_sidecar(fp, doc)
        result = Path(fp).read_text(encoding="utf-8")
        assert "selected_text_hash:" in result
        assert compute_hash("some code") in result


# =========================================================================
# writeSidecar — idempotency
# =========================================================================


class TestWriteSidecarIdempotency:
    def test_writing_twice_produces_identical_output(self, tmp_dir):
        fp = str(tmp_dir / "idempotent.review.yaml")
        original = (
            'mrsf_version: "1.0"\n'
            'document: test.md\n'
            'comments:\n'
            '  - id: c-001\n'
            '    author: Alice\n'
            '    timestamp: "2026-01-01T00:00:00Z"\n'
            '    text: |\n'
            '      Multi-line\n'
            '      comment text.\n'
            '    type: suggestion\n'
            '    severity: medium\n'
            '    resolved: false\n'
            '    line: 42\n'
            '    selected_text: |-\n'
            '      Some selected\n'
            '      text here.\n'
            f'    selected_text_hash: {compute_hash("Some selected\\ntext here.")}\n'
            '    commit: deadbeef\n'
        )
        Path(fp).write_text(original, encoding="utf-8")
        doc = MrsfDocument(
            mrsf_version="1.0", document="test.md",
            comments=[Comment(
                id="c-001", author="Alice", timestamp="2026-01-01T00:00:00Z",
                text="Multi-line\ncomment text.\n", type="suggestion", severity="medium",
                resolved=False, line=42, selected_text="Some selected\ntext here.",
                selected_text_hash=compute_hash("Some selected\ntext here."),
                commit="deadbeef",
            )],
        )
        write_sidecar(fp, doc)
        first = Path(fp).read_text(encoding="utf-8")
        write_sidecar(fp, doc)
        second = Path(fp).read_text(encoding="utf-8")
        assert first == second


# =========================================================================
# writeSidecar — adding fields
# =========================================================================


class TestWriteSidecarAddingFields:
    def test_adds_a_new_key_to_an_existing_comment(self, tmp_dir):
        fp = str(tmp_dir / "addfield.review.yaml")
        original = (
            'mrsf_version: "1.0"\n'
            'document: test.md\n'
            'comments:\n'
            '  - id: c-001\n'
            '    author: Alice\n'
            '    timestamp: "2026-01-01T00:00:00Z"\n'
            '    text: Fix this\n'
            '    resolved: false\n'
        )
        Path(fp).write_text(original, encoding="utf-8")
        doc = MrsfDocument(
            mrsf_version="1.0", document="test.md",
            comments=[Comment(
                id="c-001", author="Alice", timestamp="2026-01-01T00:00:00Z",
                text="Fix this", resolved=False, line=10,
            )],
        )
        write_sidecar(fp, doc)
        result = Path(fp).read_text(encoding="utf-8")
        assert "line: 10" in result
        assert "author: Alice" in result
        assert "resolved: false" in result

    def test_removes_a_field_when_set_to_none(self, tmp_dir):
        fp = str(tmp_dir / "rmfield.review.yaml")
        original = (
            'mrsf_version: "1.0"\n'
            'document: test.md\n'
            'comments:\n'
            '  - id: c-001\n'
            '    author: Alice\n'
            '    timestamp: "2026-01-01T00:00:00Z"\n'
            '    text: Fix this\n'
            '    resolved: false\n'
            '    line: 10\n'
            '    commit: abc123\n'
        )
        Path(fp).write_text(original, encoding="utf-8")
        doc = MrsfDocument(
            mrsf_version="1.0", document="test.md",
            comments=[Comment(
                id="c-001", author="Alice", timestamp="2026-01-01T00:00:00Z",
                text="Fix this", resolved=False, commit="abc123",
                # line removed (None)
            )],
        )
        write_sidecar(fp, doc)
        result = Path(fp).read_text(encoding="utf-8")
        assert "line:" not in result
        assert "commit: abc123" in result


# =========================================================================
# writeSidecar — top-level updates
# =========================================================================


class TestWriteSidecarTopLevelUpdates:
    def test_updates_the_document_path(self, tmp_dir):
        fp = str(tmp_dir / "toplevel.review.yaml")
        original = (
            'mrsf_version: "1.0"\n'
            'document: old-name.md\n'
            'comments:\n'
            '  - id: c-001\n'
            '    author: Alice\n'
            '    timestamp: "2026-01-01T00:00:00Z"\n'
            '    text: Fix this\n'
            '    resolved: false\n'
        )
        Path(fp).write_text(original, encoding="utf-8")
        doc = MrsfDocument(
            mrsf_version="1.0", document="new-name.md",
            comments=[Comment(
                id="c-001", author="Alice", timestamp="2026-01-01T00:00:00Z",
                text="Fix this", resolved=False,
            )],
        )
        write_sidecar(fp, doc)
        result = Path(fp).read_text(encoding="utf-8")
        expected = original.replace("old-name.md", "new-name.md")
        assert result == expected


# =========================================================================
# writeSidecar — extension fields
# =========================================================================


class TestWriteSidecarExtensionFields:
    def test_preserves_x_prefixed_fields_on_round_trip(self, tmp_dir):
        fp = str(tmp_dir / "ext.review.yaml")
        original = (
            'mrsf_version: "1.0"\n'
            'document: test.md\n'
            'comments:\n'
            '  - id: c-001\n'
            '    author: Alice\n'
            '    timestamp: "2026-01-01T00:00:00Z"\n'
            '    text: Fix this\n'
            '    resolved: false\n'
            '    x_reanchor_status: anchored\n'
            '    x_reanchor_score: 1\n'
        )
        Path(fp).write_text(original, encoding="utf-8")
        doc = MrsfDocument(
            mrsf_version="1.0", document="test.md",
            comments=[Comment(
                id="c-001", author="Alice", timestamp="2026-01-01T00:00:00Z",
                text="Fix this", resolved=False,
                extra={"x_reanchor_status": "anchored", "x_reanchor_score": 1},
            )],
        )
        write_sidecar(fp, doc)
        result = Path(fp).read_text(encoding="utf-8")
        assert result == original


# =========================================================================
# YAML-special character quoting
# =========================================================================


class TestWriteSidecarYamlSpecialQuoting:
    yaml_special_values = [
        ("leading dash (list indicator)", "- bullet item"),
        ("leading hash (comment)", "# Heading"),
        ("colon-space (mapping)", "key: value"),
        ("opening bracket", "[link](url)"),
        ("opening brace", "{foo: bar}"),
        ("leading whitespace", "  indented text"),
        ("trailing whitespace", "text with trailing "),
        ("tab character", "before\tafter"),
        ("newline", "line1\nline2"),
        ("ampersand (anchor)", "&anchor"),
        ("asterisk (alias)", "*alias"),
        ("exclamation (tag)", "!important"),
        ("percent (directive)", "%TAG"),
        ("pipe (literal block)", "| not a block"),
        ("greater-than (folded block)", "> not a fold"),
        ("at sign", "@mention"),
        ("backtick", "`code`"),
        ("YAML boolean true", "true"),
        ("YAML boolean false", "false"),
        ("YAML null", "null"),
        ("YAML tilde null", "~"),
        ("YAML yes", "yes"),
        ("YAML no", "no"),
        ("digit-leading", "42 is the answer"),
        ("empty string", ""),
        ("bare dash", "-"),
        ("double quote inside", 'say "hello"'),
        ("inline comment marker", "some text # comment"),
    ]

    @pytest.mark.parametrize("label,value", yaml_special_values, ids=[v[0] for v in yaml_special_values])
    def test_round_trips_selected_text(self, label, value, tmp_dir):
        safe_label = label.replace(" ", "-").replace("(", "").replace(")", "")
        fp = str(tmp_dir / f"special-{safe_label}.review.yaml")

        # Write fresh
        doc = make_doc([make_comment(selected_text=value)])
        write_sidecar(fp, doc)

        # Verify parseable
        raw = Path(fp).read_text(encoding="utf-8")
        parsed = _yaml.load(raw)
        assert parsed["comments"][0]["selected_text"] == value

        # Round-trip through existing file path
        doc2 = make_doc([
            make_comment(selected_text=value),
            make_comment(id="c-002", selected_text="new comment"),
        ])
        write_sidecar(fp, doc2)

        raw2 = Path(fp).read_text(encoding="utf-8")
        parsed2 = _yaml.load(raw2)
        assert parsed2["comments"][0]["selected_text"] == value
        assert len(parsed2["comments"]) == 2

    def test_round_trips_brand_new_comment_with_yaml_special_selected_text_via_cst_path(self, tmp_dir):
        fp = str(tmp_dir / "cst-special.review.yaml")

        initial = make_doc([make_comment(id="safe-1", selected_text="normal text")])
        write_sidecar(fp, initial)

        updated = make_doc([
            make_comment(id="safe-1", selected_text="normal text"),
            make_comment(id="danger-1", selected_text="- Why a given bullet point"),
            make_comment(id="danger-2", selected_text="# Top-level heading"),
            make_comment(id="danger-3", selected_text="key: value with colon"),
        ])
        write_sidecar(fp, updated)

        raw = Path(fp).read_text(encoding="utf-8")
        parsed = _yaml.load(raw)
        assert len(parsed["comments"]) == 4
        assert parsed["comments"][0]["selected_text"] == "normal text"
        assert parsed["comments"][1]["selected_text"] == "- Why a given bullet point"
        assert parsed["comments"][2]["selected_text"] == "# Top-level heading"
        assert parsed["comments"][3]["selected_text"] == "key: value with colon"


# =========================================================================
# Concurrent write serialization
# =========================================================================


class TestWriteSidecarConcurrentWrites:
    def test_serializes_10_parallel_writes_without_data_loss(self, tmp_dir):
        fp = str(tmp_dir / "concurrent.review.yaml")
        all_comments = [
            make_comment(
                id=f"c-{str(i).zfill(3)}",
                text=f"Comment number {i}",
                selected_text=f"line {i} content",
            )
            for i in range(1, 11)
        ]

        # Each thread writes progressively more comments (1, 2, ..., 10).
        # The file lock ensures mutual exclusion. The final write should have
        # the most comments, but thread ordering isn't guaranteed. We verify:
        # 1. The file is valid YAML (no corruption)
        # 2. The last writer's data is intact (some subset of comments)
        # 3. All comment IDs are sequential from c-001
        threads = []
        for idx in range(len(all_comments)):
            doc = make_doc(all_comments[: idx + 1])
            t = threading.Thread(target=write_sidecar, args=(fp, doc))
            threads.append(t)

        for t in threads:
            t.start()
        for t in threads:
            t.join()

        raw = Path(fp).read_text(encoding="utf-8")
        parsed = _yaml.load(raw)
        n = len(parsed["comments"])
        assert n >= 1  # at least one write succeeded
        # Verify sequential IDs starting from c-001
        for i in range(n):
            assert parsed["comments"][i]["id"] == f"c-{str(i + 1).zfill(3)}"

    def test_serializes_parallel_writes_that_each_add_a_single_different_comment(self, tmp_dir):
        fp = str(tmp_dir / "concurrent-single.review.yaml")
        initial = make_doc([make_comment(id="base", text="base comment")])
        write_sidecar(fp, initial)

        threads = []
        for i in range(1, 6):
            doc = make_doc([
                make_comment(id="base", text="base comment"),
                make_comment(id=f"new-{i}", text=f"New comment {i}"),
            ])
            t = threading.Thread(target=write_sidecar, args=(fp, doc))
            threads.append(t)

        for t in threads:
            t.start()
        for t in threads:
            t.join()

        raw = Path(fp).read_text(encoding="utf-8")
        parsed = _yaml.load(raw)
        assert len(parsed["comments"]) == 2
        assert parsed["comments"][0]["id"] == "base"
        assert parsed["mrsf_version"] == "1.0"
