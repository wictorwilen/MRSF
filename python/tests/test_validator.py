"""Tests for the validator module — 1:1 match with validator.test.ts."""

from mrsf.types import Comment, MrsfDocument, ValidateOptions
from mrsf.validator import validate, validate_file
from mrsf.writer import compute_hash


def make_doc(**overrides) -> MrsfDocument:
    defaults = dict(mrsf_version="1.0", document="test.md", comments=[])
    defaults.update(overrides)
    return MrsfDocument(**defaults)


class TestValidate:
    def test_passes_valid_empty_document(self):
        result = validate(make_doc())
        assert result.valid is True
        assert len(result.errors) == 0

    def test_passes_valid_document_with_comments(self):
        result = validate(make_doc(comments=[
            Comment(
                id="c-001", author="Alice",
                timestamp="2025-01-01T00:00:00Z",
                text="Looks good.", resolved=False,
            ),
        ]))
        assert result.valid is True

    def test_detects_duplicate_ids(self):
        result = validate(make_doc(comments=[
            Comment(id="dup", author="A", timestamp="2025-01-01T00:00:00Z", text="a", resolved=False),
            Comment(id="dup", author="B", timestamp="2025-01-01T00:00:00Z", text="b", resolved=False),
        ]))
        assert result.valid is False
        assert any("Duplicate" in e.message for e in result.errors)

    def test_detects_end_line_less_than_line(self):
        result = validate(make_doc(comments=[
            Comment(
                id="c-1", author="A", timestamp="2025-01-01T00:00:00Z",
                text="a", resolved=False, line=10, end_line=5,
            ),
        ]))
        assert result.valid is False
        assert any("end_line" in e.message for e in result.errors)

    def test_warns_on_missing_selected_text(self):
        result = validate(make_doc(comments=[
            Comment(
                id="c-1", author="A", timestamp="2025-01-01T00:00:00Z",
                text="a", resolved=False, line=5,
            ),
        ]))
        assert any("selected_text" in w.message for w in result.warnings)

    def test_detects_unresolved_reply_to(self):
        result = validate(make_doc(comments=[
            Comment(
                id="c-1", author="A", timestamp="2025-01-01T00:00:00Z",
                text="reply", resolved=False, reply_to="nonexistent",
            ),
        ]))
        assert any("reply_to" in w.message for w in result.warnings)

    def test_detects_selected_text_exceeding_4096_characters(self):
        result = validate(make_doc(comments=[
            Comment(
                id="c-1", author="A", timestamp="2025-01-01T00:00:00Z",
                text="a", resolved=False, selected_text="x" * 4097,
            ),
        ]))
        assert any("4096" in e.message for e in result.errors)

    def test_detects_end_column_less_than_start_column_on_same_line(self):
        result = validate(make_doc(comments=[
            Comment(
                id="c-1", author="A", timestamp="2025-01-01T00:00:00Z",
                text="a", resolved=False,
                line=5, end_line=5, start_column=10, end_column=5,
            ),
        ]))
        assert result.valid is False
        assert any("end_column" in e.message for e in result.errors)

    def test_warns_on_text_exceeding_16384_characters(self):
        result = validate(make_doc(comments=[
            Comment(
                id="c-1", author="A", timestamp="2025-01-01T00:00:00Z",
                text="x" * 16385, resolved=False,
            ),
        ]))
        assert any("16384" in w.message for w in result.warnings)

    def test_warns_on_selected_text_hash_mismatch(self):
        result = validate(make_doc(comments=[
            Comment(
                id="c-1", author="A", timestamp="2025-01-01T00:00:00Z",
                text="a", resolved=False,
                selected_text="hello world",
                selected_text_hash="0000000000000000000000000000000000000000000000000000000000000000",
            ),
        ]))
        assert any("hash" in w.message.lower() for w in result.warnings)

    def test_no_warning_on_correct_hash(self):
        text = "hello world"
        correct_hash = compute_hash(text)
        result = validate(make_doc(comments=[
            Comment(
                id="c-1", author="A", timestamp="2025-01-01T00:00:00Z",
                text="a", resolved=False,
                selected_text=text,
                selected_text_hash=correct_hash,
            ),
        ]))
        assert not any("hash" in w.message.lower() for w in result.warnings)

    def test_strict_mode_fails_on_warnings(self):
        result = validate(
            make_doc(comments=[
                Comment(
                    id="c-1", author="A", timestamp="2025-01-01T00:00:00Z",
                    text="a", resolved=False, line=5,
                ),  # will produce missing selected_text warning
            ]),
            options=ValidateOptions(strict=True),
        )
        assert result.valid is False


# ---------------------------------------------------------------------------
# validate_file
# ---------------------------------------------------------------------------


class TestValidateFile:
    def test_validates_valid_file(self, tmp_path):
        f = tmp_path / "test.md.review.yaml"
        f.write_text(
            "mrsf_version: '1.0'\n"
            "document: test.md\n"
            "comments:\n"
            "  - id: c-1\n"
            "    author: Alice\n"
            "    timestamp: '2025-01-01T00:00:00Z'\n"
            "    text: Good\n"
            "    resolved: false\n",
            encoding="utf-8",
        )
        result = validate_file(str(f))
        assert result.valid is True

    def test_returns_error_for_nonexistent_file(self, tmp_path):
        result = validate_file(str(tmp_path / "missing.review.yaml"))
        assert result.valid is False
        assert any("parse" in e.message.lower() or "Failed" in e.message for e in result.errors)

    def test_returns_error_for_invalid_yaml(self, tmp_path):
        f = tmp_path / "bad.review.yaml"
        f.write_text(":\n  :\n    [invalid", encoding="utf-8")
        result = validate_file(str(f))
        assert result.valid is False
