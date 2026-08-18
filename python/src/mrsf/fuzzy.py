"""MRSF Fuzzy Matching Engine.

Provides exact, normalized, token-level LCS, and character-level
Levenshtein matching for re-anchoring selected_text.
"""

from __future__ import annotations

import math
import re
from dataclasses import dataclass

from rapidfuzz.distance import Levenshtein

from .types import FuzzyCandidate

MAX_FUZZY_CANDIDATE_LINES = 64


@dataclass
class FuzzySearchIndex:
    lines: list[str]
    token_postings: dict[str, list[int]]
    trigram_postings: dict[str, list[int]]


def create_fuzzy_search_index(lines: list[str]) -> FuzzySearchIndex:
    tokens: dict[str, list[int]] = {}
    trigrams: dict[str, list[int]] = {}
    for line in range(1, len(lines)):
        _add_postings(tokens, _lexical_tokens(lines[line]), line)
        _add_postings(trigrams, _character_trigrams(lines[line]), line)
    return FuzzySearchIndex(lines, tokens, trigrams)

# ---------------------------------------------------------------------------
# Exact matching
# ---------------------------------------------------------------------------


def exact_match(lines: list[str], needle: str) -> list[FuzzyCandidate]:
    """Find all exact occurrences of `needle` in lines (1-based array)."""
    if not needle:
        return []

    results: list[FuzzyCandidate] = []
    needle_lines = needle.split("\n")
    needle_line_count = len(needle_lines)

    for start_line in range(1, len(lines) - needle_line_count + 1):
        window_lines = lines[start_line : start_line + needle_line_count]
        window_text = "\n".join(window_lines)

        if needle_line_count == 1:
            line = window_lines[0]
            col = 0
            while col < len(line):
                idx = line.find(needle, col)
                if idx == -1:
                    break
                results.append(
                    FuzzyCandidate(
                        text=needle,
                        line=start_line,
                        end_line=start_line,
                        start_column=idx,
                        end_column=idx + len(needle),
                        score=1.0,
                    )
                )
                col = idx + 1
        else:
            idx = window_text.find(needle)
            if idx != -1:
                before_match = window_text[:idx]
                lines_before_end = before_match.split("\n")
                start_col = len(lines_before_end[-1])

                after_match = needle.split("\n")
                end_col = len(after_match[-1])
                if start_col == 0 or len(lines_before_end) == 1:
                    results.append(
                        FuzzyCandidate(
                            text=needle,
                            line=start_line + len(lines_before_end) - 1,
                            end_line=start_line + len(lines_before_end) - 1 + len(after_match) - 1,
                            start_column=start_col,
                            end_column=end_col,
                            score=1.0,
                        )
                    )

    return results


# ---------------------------------------------------------------------------
# Normalized matching
# ---------------------------------------------------------------------------


def _normalize(text: str) -> str:
    return re.sub(r"\s+", " ", text).strip()


def normalized_match(lines: list[str], needle: str) -> list[FuzzyCandidate]:
    """Find matches after normalizing whitespace."""
    norm_needle = _normalize(needle)
    if not norm_needle:
        return []

    results: list[FuzzyCandidate] = []
    needle_line_estimate = len(needle.split("\n"))
    min_window = max(1, needle_line_estimate - 1)
    max_window = min(len(lines) - 1, needle_line_estimate + 2)

    for win_size in range(min_window, max_window + 1):
        for start_line in range(1, len(lines) - win_size + 1):
            window_lines = lines[start_line : start_line + win_size]
            window_text = "\n".join(window_lines)
            norm_window = _normalize(window_text)

            if norm_needle in norm_window:
                results.append(
                    FuzzyCandidate(
                        text=window_text,
                        line=start_line,
                        end_line=start_line + win_size - 1,
                        start_column=0,
                        end_column=len(window_lines[-1]),
                        score=0.95,
                    )
                )

    return _deduplicate_candidates(results)


# ---------------------------------------------------------------------------
# Token-level LCS
# ---------------------------------------------------------------------------


def _tokenize(text: str) -> list[str]:
    return text.split()


def _lcs_length(a: list[str], b: list[str]) -> int:
    m, n = len(a), len(b)
    prev = [0] * (n + 1)
    curr = [0] * (n + 1)

    for i in range(1, m + 1):
        for j in range(1, n + 1):
            if a[i - 1] == b[j - 1]:
                curr[j] = prev[j - 1] + 1
            else:
                curr[j] = max(prev[j], curr[j - 1])
        prev, curr = curr, [0] * (n + 1)

    return prev[n]


def token_lcs_score(a: str, b: str) -> float:
    """Score two texts using token-level LCS. Returns 0.0–1.0."""
    tok_a = _tokenize(a)
    tok_b = _tokenize(b)
    if not tok_a and not tok_b:
        return 1.0
    if not tok_a or not tok_b:
        return 0.0
    lcs = _lcs_length(tok_a, tok_b)
    return lcs / max(len(tok_a), len(tok_b))


# ---------------------------------------------------------------------------
# Character-level Levenshtein score
# ---------------------------------------------------------------------------


def levenshtein_score(a: str, b: str) -> float:
    """Normalized Levenshtein similarity 0.0–1.0."""
    if not a and not b:
        return 1.0
    max_len = max(len(a), len(b))
    if max_len == 0:
        return 1.0
    dist = Levenshtein.distance(a, b)
    return 1.0 - dist / max_len


# ---------------------------------------------------------------------------
# Combined fuzzy scoring
# ---------------------------------------------------------------------------


def combined_score(needle: str, candidate: str) -> float:
    """Compute a combined similarity score (60% token LCS, 40% Levenshtein)."""
    t_score = token_lcs_score(needle, candidate)

    if len(needle) < 500 and len(candidate) < 500:
        l_score = levenshtein_score(needle, candidate)
    else:
        l_score = t_score

    return t_score * 0.6 + l_score * 0.4


# ---------------------------------------------------------------------------
# Fuzzy search across document
# ---------------------------------------------------------------------------


def fuzzy_search(
    lines: list[str],
    needle: str,
    threshold: float = 0.6,
    hint_line: int | None = None,
    index: FuzzySearchIndex | None = None,
) -> list[FuzzyCandidate]:
    """Search the document for fuzzy matches of needle."""
    return fuzzy_search_thresholds(
        lines, needle, [threshold], hint_line, index
    ).get(threshold, [])


def fuzzy_search_thresholds(
    lines: list[str],
    needle: str,
    thresholds: list[float],
    hint_line: int | None = None,
    index: FuzzySearchIndex | None = None,
) -> dict[float, list[FuzzyCandidate]]:
    """Compute bounded fuzzy candidates once and partition by base threshold."""
    unique_thresholds = list(dict.fromkeys(thresholds))
    results: dict[float, list[FuzzyCandidate]] = {}
    if not unique_thresholds:
        return results
    if not needle:
        return {threshold: [] for threshold in unique_thresholds}
    if index is None:
        index = create_fuzzy_search_index(lines)

    needle_lines = needle.split("\n")
    needle_line_count = len(needle_lines)
    candidates: list[FuzzyCandidate] = []
    minimum_threshold = min(unique_thresholds)
    candidate_lines = _retrieve_candidate_lines(index, needle, hint_line)

    min_window = max(1, int(needle_line_count * 0.7))
    max_window = min(len(lines) - 1, int(needle_line_count * 1.3) + 1)

    for win_size in range(min_window, max_window + 1):
        start_lines = {
            candidate_line - offset
            for candidate_line in candidate_lines
            for offset in range(win_size)
            if candidate_line - offset >= 1
            and candidate_line - offset + win_size - 1 < len(lines)
        }
        for start_line in start_lines:
            window_lines = lines[start_line : start_line + win_size]
            window_text = "\n".join(window_lines)

            score = combined_score(needle, window_text)

            if score >= minimum_threshold:
                candidates.append(
                    FuzzyCandidate(
                        text=window_text,
                        line=start_line,
                        end_line=start_line + win_size - 1,
                        start_column=0,
                        end_column=len(window_lines[-1]),
                        score=score,
                    )
                )

    # Single-line substring matching
    if needle_line_count == 1 and len(needle) < 200:
        for line_num in candidate_lines:
            line = lines[line_num]
            if not line:
                continue

            win_len = len(needle)
            min_win_len = max(3, int(win_len * 0.7))
            max_win_len = min(len(line), int(win_len * 1.3))

            for length in _evenly_spaced(min_win_len, max_win_len, 7):
                for col in range(0, len(line) - length + 1):
                    sub = line[col : col + length]
                    score = combined_score(needle, sub)
                    if score >= minimum_threshold:
                        candidates.append(
                            FuzzyCandidate(
                                text=sub,
                                line=line_num,
                                end_line=line_num,
                                start_column=col,
                                end_column=col + length,
                                score=score,
                            )
                        )

    scored: list[tuple[float, FuzzyCandidate]] = []
    for candidate in _deduplicate_candidates(candidates):
        base_score = candidate.score
        if hint_line is not None:
            candidate = FuzzyCandidate(
                text=candidate.text,
                line=candidate.line,
                end_line=candidate.end_line,
                start_column=candidate.start_column,
                end_column=candidate.end_column,
                score=min(
                    1.0,
                    candidate.score
                    + 0.1 * max(0, 1 - abs(candidate.line - hint_line) / 50),
                ),
            )
        scored.append((base_score, candidate))
    for threshold in unique_thresholds:
        results[threshold] = sorted(
            (candidate for base, candidate in scored if base >= threshold),
            key=lambda candidate: candidate.score,
            reverse=True,
        )
    return results


def _retrieve_candidate_lines(
    index: FuzzySearchIndex,
    needle: str,
    hint_line: int | None,
) -> list[int]:
    votes: dict[int, float] = {}
    line_count = max(0, len(index.lines) - 1)
    signals = [
        *(_posting_signals(index.token_postings, _lexical_tokens(needle), 2.0)),
        *(_posting_signals(index.trigram_postings, _character_trigrams(needle), 1.0)),
    ]
    signals.sort(key=lambda signal: len(signal[0]))
    for postings, weight in signals[:16]:
        rarity = math.log1p(line_count / len(postings))
        for line in postings:
            votes[line] = votes.get(line, 0.0) + weight * rarity
    if hint_line is not None:
        for offset in range(-4, 5):
            line = hint_line + offset
            if 1 <= line <= line_count:
                votes[line] = votes.get(line, 0.0) + 0.25
    return [
        line
        for line, _ in sorted(
            votes.items(),
            key=lambda item: (
                -item[1],
                abs(item[0] - hint_line) if hint_line is not None else 0,
                item[0],
            ),
        )[:MAX_FUZZY_CANDIDATE_LINES]
    ]


def _posting_signals(
    postings: dict[str, list[int]],
    values: list[str],
    weight: float,
) -> list[tuple[list[int], float]]:
    return [
        (postings[value], weight)
        for value in dict.fromkeys(values)
        if value in postings
    ]


def _add_postings(postings: dict[str, list[int]], values: list[str], line: int) -> None:
    for value in dict.fromkeys(values):
        postings.setdefault(value, []).append(line)


def _lexical_tokens(text: str) -> list[str]:
    return re.findall(r"[\w-]+", text.lower(), flags=re.UNICODE)


def _character_trigrams(text: str) -> list[str]:
    normalized = re.sub(r"\s+", " ", text.lower()).strip()
    if len(normalized) < 3:
        return [normalized] if normalized else []
    return [normalized[index : index + 3] for index in range(len(normalized) - 2)]


def _evenly_spaced(minimum: int, maximum: int, count: int) -> list[int]:
    if maximum <= minimum:
        return [minimum]
    return list(
        dict.fromkeys(
            round(minimum + (maximum - minimum) * index / (count - 1))
            for index in range(count)
        )
    )


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _deduplicate_candidates(candidates: list[FuzzyCandidate]) -> list[FuzzyCandidate]:
    seen: dict[str, FuzzyCandidate] = {}
    for c in candidates:
        key = f"{c.line}:{c.start_column}:{c.end_line}:{c.end_column}"
        existing = seen.get(key)
        if existing is None or c.score > existing.score:
            seen[key] = c
    return list(seen.values())
