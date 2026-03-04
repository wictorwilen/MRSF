"""Tests for the fuzzy matching engine — 1:1 match with fuzzy.test.ts."""

from mrsf.fuzzy import combined_score, exact_match, fuzzy_search, normalized_match


def lines1(*content: str) -> list[str]:
    """Make a 1-based line array (index 0 is unused)."""
    return ["", *content]


# ---------------------------------------------------------------------------
# exactMatch
# ---------------------------------------------------------------------------


class TestExactMatch:
    lines = lines1(
        "# Hello World",
        "",
        "This is a test document.",
        "Another line here.",
        "This is a test document.",  # duplicate
    )

    def test_finds_a_unique_match(self):
        results = exact_match(self.lines, "Another line here.")
        assert len(results) == 1
        assert results[0].line == 4
        assert results[0].score == 1.0

    def test_finds_multiple_matches(self):
        results = exact_match(self.lines, "This is a test document.")
        assert len(results) == 2
        assert results[0].line == 3
        assert results[1].line == 5

    def test_returns_empty_for_no_match(self):
        results = exact_match(self.lines, "nonexistent text")
        assert len(results) == 0

    def test_matches_multi_line_text(self):
        results = exact_match(self.lines, "This is a test document.\nAnother line here.")
        assert len(results) == 1
        assert results[0].line == 3
        assert results[0].end_line == 4

    def test_matches_substring_within_a_line(self):
        results = exact_match(self.lines, "test document")
        assert len(results) >= 1
        assert results[0].start_column > 0


# ---------------------------------------------------------------------------
# normalizedMatch
# ---------------------------------------------------------------------------


class TestNormalizedMatch:
    lines = lines1(
        "  function  foo(  bar  ) {",
        "  return bar;",
        "  }",
    )

    def test_matches_with_normalized_whitespace(self):
        results = normalized_match(self.lines, "function foo( bar ) {")
        assert len(results) >= 1
        best = max(results, key=lambda r: r.score)
        assert best.score == 0.95

    def test_does_not_match_completely_different_text(self):
        results = normalized_match(self.lines, "something else entirely")
        assert len(results) == 0


# ---------------------------------------------------------------------------
# combinedScore
# ---------------------------------------------------------------------------


class TestCombinedScore:
    def test_returns_1_0_for_identical_strings(self):
        assert combined_score("hello world", "hello world") == 1.0

    def test_returns_high_score_for_similar_strings(self):
        score = combined_score("This is a test line", "This is a testing line")
        assert score > 0.7

    def test_returns_low_score_for_very_different_strings(self):
        score = combined_score(
            "completely different content",
            "nothing similar here at all whatsoever",
        )
        assert score < 0.5


# ---------------------------------------------------------------------------
# fuzzySearch
# ---------------------------------------------------------------------------


class TestFuzzySearch:
    lines = lines1(
        "# Introduction",
        "",
        "The quick brown fox jumps over the lazy dog.",
        "Another paragraph here.",
        "The slow brown fox crawls under the sleepy dog.",  # similar to line 3
    )

    def test_finds_a_high_confidence_fuzzy_match(self):
        results = fuzzy_search(
            self.lines,
            "The quick brown fox jumps over the lazy dog",
            0.8,
        )
        assert len(results) >= 1
        assert results[0].line == 3
        assert results[0].score > 0.9

    def test_respects_threshold(self):
        results = fuzzy_search(self.lines, "completely unrelated text", 0.9)
        assert len(results) == 0

    def test_uses_hint_line_for_proximity_bonus(self):
        results = fuzzy_search(self.lines, "brown fox", 0.5, 5)
        assert len(results) > 0
