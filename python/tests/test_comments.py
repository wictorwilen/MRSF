"""Tests for comments CRUD module — 1:1 match with comments.test.ts."""

from mrsf.comments import (
    add_comment,
    filter_comments,
    get_threads,
    populate_selected_text,
    remove_comment,
    resolve_comment,
    summarize,
    unresolve_comment,
)
from mrsf.types import (
    AddCommentOptions,
    Comment,
    CommentFilter,
    MrsfDocument,
    RemoveCommentOptions,
)


def make_doc() -> MrsfDocument:
    return MrsfDocument(mrsf_version="1.0", document="test.md", comments=[])


# ---------------------------------------------------------------------------
# addComment
# ---------------------------------------------------------------------------


class TestAddComment:
    def test_adds_a_comment_with_auto_generated_id_and_timestamp(self):
        doc = make_doc()
        c = add_comment(doc, AddCommentOptions(author="Alice", text="Fix this"))
        assert len(doc.comments) == 1
        assert c.id
        assert c.author == "Alice"
        assert c.text == "Fix this"
        assert c.resolved is False
        assert c.timestamp

    def test_respects_explicit_id_and_timestamp(self):
        doc = make_doc()
        c = add_comment(
            doc,
            AddCommentOptions(
                author="Bob",
                text="Note",
                id="my-id",
                timestamp="2025-01-01T00:00:00Z",
            ),
        )
        assert c.id == "my-id"
        assert c.timestamp == "2025-01-01T00:00:00Z"

    def test_includes_optional_fields_when_provided(self):
        doc = make_doc()
        c = add_comment(
            doc,
            AddCommentOptions(
                author="Carol",
                text="Suggestion",
                line=10,
                end_line=12,
                type="suggestion",
                severity="medium",
            ),
        )
        assert c.line == 10
        assert c.end_line == 12
        assert c.type == "suggestion"
        assert c.severity == "medium"


# ---------------------------------------------------------------------------
# resolveComment
# ---------------------------------------------------------------------------


class TestResolveComment:
    def test_resolves_a_comment_by_id(self):
        doc = make_doc()
        doc.comments.append(Comment(id="c-1", author="A", timestamp="", text="x", resolved=False))
        assert resolve_comment(doc, "c-1") is True
        assert doc.comments[0].resolved is True

    def test_returns_false_for_unknown_id(self):
        doc = make_doc()
        assert resolve_comment(doc, "missing") is False

    def test_does_not_cascade_by_default(self):
        doc = make_doc()
        doc.comments.append(Comment(id="c-1", author="A", timestamp="", text="x", resolved=False))
        doc.comments.append(
            Comment(id="c-2", author="B", timestamp="", text="reply", resolved=False, reply_to="c-1")
        )
        resolve_comment(doc, "c-1", cascade=False)
        assert doc.comments[0].resolved is True
        assert doc.comments[1].resolved is False

    def test_cascades_when_requested(self):
        doc = make_doc()
        doc.comments.append(Comment(id="c-1", author="A", timestamp="", text="x", resolved=False))
        doc.comments.append(
            Comment(id="c-2", author="B", timestamp="", text="reply", resolved=False, reply_to="c-1")
        )
        resolve_comment(doc, "c-1", cascade=True)
        assert doc.comments[0].resolved is True
        assert doc.comments[1].resolved is True


# ---------------------------------------------------------------------------
# unresolveComment
# ---------------------------------------------------------------------------


class TestUnresolveComment:
    def test_unresolves_a_comment(self):
        doc = make_doc()
        doc.comments.append(Comment(id="c-1", author="A", timestamp="", text="x", resolved=True))
        assert unresolve_comment(doc, "c-1") is True
        assert doc.comments[0].resolved is False


# ---------------------------------------------------------------------------
# removeComment
# ---------------------------------------------------------------------------


class TestRemoveComment:
    def test_removes_a_comment_by_id(self):
        doc = make_doc()
        doc.comments.append(Comment(id="c-1", author="A", timestamp="", text="a", resolved=False))
        doc.comments.append(Comment(id="c-2", author="B", timestamp="", text="b", resolved=False))
        assert remove_comment(doc, "c-1") is True
        assert len(doc.comments) == 1
        assert doc.comments[0].id == "c-2"

    def test_promotes_direct_replies_by_inheriting_parent_anchor(self):
        doc = make_doc()
        doc.comments.append(
            Comment(
                id="p1", author="A", timestamp="", text="parent", resolved=False,
                line=10, end_line=12, selected_text="hello world",
            )
        )
        doc.comments.append(
            Comment(id="r1", author="B", timestamp="", text="reply", resolved=False, reply_to="p1")
        )
        assert remove_comment(doc, "p1") is True
        assert len(doc.comments) == 1
        reply = doc.comments[0]
        assert reply.id == "r1"
        assert reply.line == 10
        assert reply.end_line == 12
        assert reply.selected_text == "hello world"
        assert reply.reply_to is None

    def test_preserves_replys_own_anchor_fields_when_present(self):
        doc = make_doc()
        doc.comments.append(
            Comment(
                id="p1", author="A", timestamp="", text="parent", resolved=False,
                line=10, selected_text="parent text",
            )
        )
        doc.comments.append(
            Comment(
                id="r1", author="B", timestamp="", text="reply", resolved=False,
                reply_to="p1", line=20, selected_text="reply text",
            )
        )
        remove_comment(doc, "p1")
        reply = doc.comments[0]
        assert reply.line == 20
        assert reply.selected_text == "reply text"

    def test_repoints_reply_to_to_grandparent_when_parent_is_a_reply_itself(self):
        doc = make_doc()
        doc.comments.append(
            Comment(id="root", author="A", timestamp="", text="root", resolved=False, line=1)
        )
        doc.comments.append(
            Comment(id="mid", author="B", timestamp="", text="mid", resolved=False, reply_to="root", line=5)
        )
        doc.comments.append(
            Comment(id="leaf", author="C", timestamp="", text="leaf", resolved=False, reply_to="mid")
        )
        remove_comment(doc, "mid")
        assert len(doc.comments) == 2
        leaf = next(c for c in doc.comments if c.id == "leaf")
        assert leaf.reply_to == "root"
        assert leaf.line == 5  # inherited from mid

    def test_cascade_removes_direct_replies_along_with_parent(self):
        doc = make_doc()
        doc.comments.append(
            Comment(id="p1", author="A", timestamp="", text="parent", resolved=False, line=10)
        )
        doc.comments.append(
            Comment(id="r1", author="B", timestamp="", text="reply1", resolved=False, reply_to="p1")
        )
        doc.comments.append(
            Comment(id="r2", author="C", timestamp="", text="reply2", resolved=False, reply_to="p1")
        )
        doc.comments.append(
            Comment(id="other", author="D", timestamp="", text="other", resolved=False)
        )
        remove_comment(doc, "p1", RemoveCommentOptions(cascade=True))
        assert len(doc.comments) == 1
        assert doc.comments[0].id == "other"

    def test_returns_false_for_non_existent_comment(self):
        doc = make_doc()
        assert remove_comment(doc, "nope") is False


# ---------------------------------------------------------------------------
# filterComments
# ---------------------------------------------------------------------------


class TestFilterComments:
    comments = [
        Comment(id="1", author="Alice", timestamp="", text="a", resolved=False, type="issue", severity="high"),
        Comment(id="2", author="Bob", timestamp="", text="b", resolved=True, type="suggestion"),
        Comment(id="3", author="Alice", timestamp="", text="c", resolved=False),
    ]

    def test_filters_by_open(self):
        result = filter_comments(self.comments, CommentFilter(open=True))
        assert len(result) == 2

    def test_filters_by_resolved(self):
        result = filter_comments(self.comments, CommentFilter(resolved=True))
        assert len(result) == 1
        assert result[0].id == "2"

    def test_filters_by_author(self):
        result = filter_comments(self.comments, CommentFilter(author="Alice"))
        assert len(result) == 2

    def test_combines_filters(self):
        result = filter_comments(self.comments, CommentFilter(open=True, author="Alice"))
        assert len(result) == 2


# ---------------------------------------------------------------------------
# getThreads
# ---------------------------------------------------------------------------


class TestGetThreads:
    def test_groups_replies_under_roots(self):
        comments = [
            Comment(id="root", author="A", timestamp="", text="root", resolved=False),
            Comment(id="r1", author="B", timestamp="", text="reply 1", resolved=False, reply_to="root"),
            Comment(id="r2", author="C", timestamp="", text="reply 2", resolved=False, reply_to="root"),
            Comment(id="standalone", author="D", timestamp="", text="solo", resolved=False),
        ]
        threads = get_threads(comments)
        assert len(threads) == 2
        assert len(threads["root"]) == 3  # root + 2 replies
        assert len(threads["standalone"]) == 1


# ---------------------------------------------------------------------------
# summarize
# ---------------------------------------------------------------------------


class TestSummarize:
    def test_produces_correct_summary(self):
        comments = [
            Comment(id="1", author="A", timestamp="", text="a", resolved=False, type="issue", severity="high"),
            Comment(id="2", author="B", timestamp="", text="b", resolved=True, type="suggestion"),
            Comment(id="3", author="A", timestamp="", text="c", resolved=False, reply_to="1"),
        ]
        s = summarize(comments)
        assert s.total == 3
        assert s.open == 2
        assert s.resolved == 1
        assert s.threads == 2  # "1" and "2" are roots
        assert s.by_type == {"issue": 1, "suggestion": 1}
        assert s.by_severity == {"high": 1}


# ---------------------------------------------------------------------------
# populateSelectedText
# ---------------------------------------------------------------------------


class TestPopulateSelectedText:
    def test_sets_selected_text_from_document_lines(self):
        comment = Comment(id="c-1", author="A", timestamp="", text="x", resolved=False, line=2)
        lines = ["first line", "second line", "third line"]
        populate_selected_text(comment, lines)
        assert comment.selected_text == "second line"
        assert comment.selected_text_hash

    def test_handles_column_ranges(self):
        comment = Comment(
            id="c-1", author="A", timestamp="", text="x", resolved=False,
            line=1, start_column=6, end_column=10,
        )
        lines = ["Hello World"]
        populate_selected_text(comment, lines)
        assert comment.selected_text == "Worl"
