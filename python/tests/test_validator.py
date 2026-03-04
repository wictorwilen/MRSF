"""Tests for the validator module — 1:1 match with validator.test.ts."""

from mrsf.types import Comment, MrsfDocument
from mrsf.validator import validate


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
