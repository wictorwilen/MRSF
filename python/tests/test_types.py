"""Tests for the types module — to_dict/from_dict coverage."""

from mrsf.types import Comment, MrsfDocument


# ---------------------------------------------------------------------------
# Comment.to_dict / from_dict
# ---------------------------------------------------------------------------


class TestCommentSerialization:
    def test_round_trips_minimal_comment(self):
        c = Comment(id="c-1", author="A", timestamp="2025-01-01T00:00:00Z", text="hello", resolved=False)
        d = c.to_dict()
        c2 = Comment.from_dict(d)
        assert c2.id == "c-1"
        assert c2.author == "A"
        assert c2.text == "hello"
        assert c2.resolved is False

    def test_includes_optional_fields_in_dict(self):
        c = Comment(
            id="c-1", author="A", timestamp="t", text="x", resolved=True,
            line=5, end_line=10, start_column=2, end_column=8,
            selected_text="sel", selected_text_hash="hash",
            anchored_text="anch", commit="abc", type="issue",
            severity="high", reply_to="c-0",
        )
        d = c.to_dict()
        assert d["line"] == 5
        assert d["end_line"] == 10
        assert d["start_column"] == 2
        assert d["end_column"] == 8
        assert d["selected_text"] == "sel"
        assert d["selected_text_hash"] == "hash"
        assert d["anchored_text"] == "anch"
        assert d["commit"] == "abc"
        assert d["type"] == "issue"
        assert d["severity"] == "high"
        assert d["reply_to"] == "c-0"

    def test_omits_none_optional_fields(self):
        c = Comment(id="c-1", author="A", timestamp="t", text="x", resolved=False)
        d = c.to_dict()
        assert "line" not in d
        assert "end_line" not in d
        assert "selected_text" not in d
        assert "commit" not in d
        assert "type" not in d
        assert "severity" not in d

    def test_preserves_extension_fields(self):
        c = Comment(
            id="c-1", author="A", timestamp="t", text="x", resolved=False,
            extra={"x_custom": "value", "x_score": 0.5},
        )
        d = c.to_dict()
        assert d["x_custom"] == "value"
        assert d["x_score"] == 0.5

    def test_from_dict_captures_unknown_keys_as_extra(self):
        d = {
            "id": "c-1", "author": "A", "timestamp": "t", "text": "x", "resolved": False,
            "x_custom": "value", "x_other": 42,
        }
        c = Comment.from_dict(d)
        assert c.extra["x_custom"] == "value"
        assert c.extra["x_other"] == 42

    def test_from_dict_defaults(self):
        d = {"id": "c-1"}
        c = Comment.from_dict(d)
        assert c.author == ""
        assert c.timestamp == ""
        assert c.text == ""
        assert c.resolved is None


# ---------------------------------------------------------------------------
# MrsfDocument.to_dict / from_dict
# ---------------------------------------------------------------------------


class TestMrsfDocumentSerialization:
    def test_round_trips_empty_doc(self):
        doc = MrsfDocument(mrsf_version="1.0", document="test.md", comments=[])
        d = doc.to_dict()
        doc2 = MrsfDocument.from_dict(d)
        assert doc2.mrsf_version == "1.0"
        assert doc2.document == "test.md"
        assert doc2.comments == []

    def test_round_trips_with_comments(self):
        doc = MrsfDocument(
            mrsf_version="1.0",
            document="test.md",
            comments=[
                Comment(id="c-1", author="A", timestamp="t", text="x", resolved=False),
            ],
        )
        d = doc.to_dict()
        doc2 = MrsfDocument.from_dict(d)
        assert len(doc2.comments) == 1
        assert doc2.comments[0].id == "c-1"

    def test_preserves_doc_extension_fields(self):
        doc = MrsfDocument(
            mrsf_version="1.0", document="test.md", comments=[],
            extra={"x_source": "ci"},
        )
        d = doc.to_dict()
        assert d["x_source"] == "ci"
        doc2 = MrsfDocument.from_dict(d)
        assert doc2.extra["x_source"] == "ci"

    def test_from_dict_skips_invalid_comments(self):
        d = {
            "mrsf_version": "1.0",
            "document": "test.md",
            "comments": [
                {"id": "good", "author": "A", "text": "ok"},
                "not a dict",
                {"no_id": True},
            ],
        }
        doc = MrsfDocument.from_dict(d)
        assert len(doc.comments) == 1
        assert doc.comments[0].id == "good"

    def test_from_dict_defaults(self):
        d = {}
        doc = MrsfDocument.from_dict(d)
        assert doc.mrsf_version == "1.0"
        assert doc.document == ""
        assert doc.comments == []
