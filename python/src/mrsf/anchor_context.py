"""Markdown structural and bidirectional context indexing."""

from __future__ import annotations

import math
import re
from dataclasses import dataclass
from typing import Literal

from .fuzzy import combined_score
from .types import Comment, ReanchorStatus

MATCH_THRESHOLD = 0.35
AMBIGUITY_MARGIN = 0.03
MAX_CONTEXT_CANDIDATE_BLOCKS = 64
BlockType = Literal["heading", "code", "list", "table", "blockquote", "paragraph"]


@dataclass
class MarkdownBlock:
    start_line: int
    end_line: int
    type: BlockType
    text: str
    heading_path: list[str]


@dataclass
class DocumentBlockIndex:
    lines: list[str]
    blocks: list[MarkdownBlock]
    line_to_block: dict[int, int]
    token_postings: dict[str, list[int]]


@dataclass
class AnchorContextIndex:
    source: DocumentBlockIndex
    target: DocumentBlockIndex


@dataclass
class ContextAnchorCandidate:
    score: float
    line: int
    end_line: int
    text: str
    exact: bool
    start_column: int | None = None
    end_column: int | None = None


@dataclass
class ContextAnchorResolution:
    status: ReanchorStatus
    score: float
    candidate_margin: float
    reason: str
    line: int | None = None
    end_line: int | None = None
    start_column: int | None = None
    end_column: int | None = None
    text: str | None = None


@dataclass
class _CandidateWindow:
    start_block: int
    end_block: int
    start_line: int
    end_line: int
    type: BlockType
    text: str
    heading_path: list[str]
    score: float = 0.0


def create_anchor_context_index(
    source_lines: list[str],
    target_lines: list[str],
) -> AnchorContextIndex:
    return AnchorContextIndex(
        source=_create_document_block_index(source_lines),
        target=_create_document_block_index(target_lines),
    )


def resolve_context_anchor(
    comment: Comment,
    index: AnchorContextIndex,
) -> ContextAnchorResolution | None:
    if comment.line is None or not comment.selected_text:
        return None
    source_block_index = index.source.line_to_block.get(comment.line)
    if source_block_index is None:
        return None
    source_text = _extract_text(
        index.source.lines,
        comment.line,
        comment.end_line,
        comment.start_column,
        comment.end_column,
    )
    if source_text != comment.selected_text:
        return None
    current_text = _extract_text(
        index.target.lines,
        comment.line,
        comment.end_line,
        comment.start_column,
        comment.end_column,
    )
    if current_text == comment.selected_text:
        return ContextAnchorResolution(
            status="anchored",
            score=1.0,
            line=comment.line,
            end_line=comment.end_line or comment.line,
            start_column=comment.start_column,
            end_column=comment.end_column,
            text=comment.selected_text,
            candidate_margin=1.0,
            reason="Source-verified anchor remains exact at its stored position.",
        )

    candidates = find_context_anchor_candidates(comment, index)
    if not candidates:
        if comment.selected_text in "\n".join(index.target.lines[1:]):
            return None
        return ContextAnchorResolution(
            status="orphaned",
            score=0.0,
            candidate_margin=1.0,
            reason="Source block has no plausible structural or contextual match.",
        )
    best = candidates[0]
    if len(candidates) > 1 and best.score - candidates[1].score < AMBIGUITY_MARGIN:
        return ContextAnchorResolution(
            status="ambiguous",
            score=best.score,
            line=best.line,
            end_line=best.end_line,
            candidate_margin=best.score - candidates[1].score,
            reason=(
                f"Structural candidates are too close "
                f"({best.score:.3f} vs {candidates[1].score:.3f})."
            ),
        )
    repeated_exact = (
        best.exact
        and _count_occurrences("\n".join(index.target.lines[1:]), comment.selected_text) > 1
    )
    status: ReanchorStatus = "anchored" if best.exact and not repeated_exact else "fuzzy"
    return ContextAnchorResolution(
        status=status,
        score=1.0 if status == "anchored" else best.score,
        line=best.line,
        end_line=best.end_line,
        start_column=best.start_column,
        end_column=best.end_column,
        text=best.text,
        candidate_margin=best.score - candidates[1].score if len(candidates) > 1 else 1.0,
        reason=(
            "Markdown structure and bidirectional context disambiguate the exact anchor."
            if status == "anchored"
            else (
                "Markdown context selects one repeated exact anchor tentatively."
                if repeated_exact
                else "Markdown structure and bidirectional context locate the edited anchor."
            )
        ),
    )


def find_context_anchor_candidates(
    comment: Comment,
    index: AnchorContextIndex,
) -> list[ContextAnchorCandidate]:
    if comment.line is None or not comment.selected_text:
        return []
    original_line = comment.line
    source_index = index.source.line_to_block.get(original_line)
    if source_index is None:
        return []
    source_block = index.source.blocks[source_index]
    source_text = _extract_text(
        index.source.lines,
        original_line,
        comment.end_line,
        comment.start_column,
        comment.end_column,
    )
    if source_text != comment.selected_text:
        return []
    windows = _create_candidate_windows(source_block, source_index, original_line, index)
    for candidate in windows:
        candidate.score = _score_candidate(
            source_block, source_index, candidate, index, original_line
        )
    windows = sorted(
        (candidate for candidate in windows if candidate.score >= MATCH_THRESHOLD),
        key=lambda candidate: (-candidate.score, abs(candidate.start_line - original_line)),
    )
    resolved: list[ContextAnchorCandidate] = []
    for candidate in windows:
        line, end_line, start_column, end_column, text = _resolve_candidate_range(
            comment, source_block, candidate, index.target
        )
        resolved.append(
            ContextAnchorCandidate(
                score=candidate.score,
                line=line,
                end_line=end_line,
                start_column=start_column,
                end_column=end_column,
                text=text,
                exact=text == comment.selected_text,
            )
        )
    return resolved


def get_anchor_context_scope(comment: Comment, index: AnchorContextIndex) -> str | None:
    if comment.line is None:
        return None
    block_index = index.source.line_to_block.get(comment.line)
    if block_index is None:
        return None
    return "\x1f".join(index.source.blocks[block_index].heading_path)


def _create_document_block_index(lines: list[str]) -> DocumentBlockIndex:
    blocks: list[MarkdownBlock] = []
    headings: list[tuple[int, str]] = []
    line = 1
    while line < len(lines):
        if not lines[line].strip():
            line += 1
            continue
        start = line
        block_type, level, title = _classify_line(lines[line])
        if block_type == "heading":
            while headings and headings[-1][0] >= level:
                headings.pop()
            blocks.append(_make_block(lines, start, start, block_type, headings))
            headings.append((level, title))
            line += 1
            continue
        if block_type == "code":
            line += 1
            while line < len(lines) and not lines[line].lstrip().startswith("```"):
                line += 1
            if line < len(lines):
                line += 1
        else:
            line += 1
            while line < len(lines) and lines[line].strip() and _continues(block_type, lines[line]):
                line += 1
        blocks.append(_make_block(lines, start, line - 1, block_type, headings))
    line_to_block: dict[int, int] = {}
    postings: dict[str, list[int]] = {}
    for block_index, block in enumerate(blocks):
        for block_line in range(block.start_line, block.end_line + 1):
            line_to_block[block_line] = block_index
        for token in set(_tokenize(block.text)):
            postings.setdefault(token, []).append(block_index)
    return DocumentBlockIndex(lines, blocks, line_to_block, postings)


def _make_block(
    lines: list[str],
    start: int,
    end: int,
    block_type: BlockType,
    headings: list[tuple[int, str]],
) -> MarkdownBlock:
    return MarkdownBlock(
        start, end, block_type, "\n".join(lines[start : end + 1]), [title for _, title in headings]
    )


def _classify_line(line: str) -> tuple[BlockType, int, str]:
    heading = re.match(r"^(#{1,6})\s+(.+)$", line)
    if heading:
        return "heading", len(heading.group(1)), heading.group(2).strip()
    if line.lstrip().startswith("```"):
        return "code", 0, ""
    if re.match(r"^\s*(?:[-*+]|\d+\.)\s+", line):
        return "list", 0, ""
    if re.match(r"^\s*\|", line):
        return "table", 0, ""
    if re.match(r"^\s*>", line):
        return "blockquote", 0, ""
    return "paragraph", 0, ""


def _continues(block_type: BlockType, line: str) -> bool:
    if block_type == "list":
        return re.match(r"^\s*(?:[-*+]|\d+\.)\s+", line) is not None
    if block_type == "table":
        return re.match(r"^\s*\|", line) is not None
    if block_type == "blockquote":
        return re.match(r"^\s*>", line) is not None
    return block_type == "paragraph" and _classify_line(line)[0] == "paragraph"


def _create_candidate_windows(
    source: MarkdownBlock,
    source_index: int,
    original_line: int,
    index: AnchorContextIndex,
) -> list[_CandidateWindow]:
    windows: list[_CandidateWindow] = []
    for start in _retrieve_candidate_blocks(source, source_index, original_line, index):
        windows.append(_to_window(index.target, start, start))
        block = index.target.blocks[start]
        if (
            source.type == "paragraph"
            and block.type == "paragraph"
            and start + 1 < len(index.target.blocks)
            and index.target.blocks[start + 1].type == "paragraph"
            and block.heading_path == index.target.blocks[start + 1].heading_path
        ):
            windows.append(_to_window(index.target, start, start + 1))
    return windows


def _retrieve_candidate_blocks(
    source: MarkdownBlock,
    source_index: int,
    original_line: int,
    index: AnchorContextIndex,
) -> list[int]:
    votes: dict[int, float] = {}
    count = len(index.target.blocks)

    def add(text: str | None, offset: int, weight: float) -> None:
        if not text:
            return
        ranked = sorted(
            (
                (token, index.target.token_postings.get(token, []))
                for token in set(_tokenize(text))
                if index.target.token_postings.get(token)
            ),
            key=lambda item: len(item[1]),
        )[:12]
        for _, postings in ranked:
            rarity = math.log1p(count / len(postings))
            for posting in postings:
                candidate = posting + offset
                if 0 <= candidate < count:
                    votes[candidate] = votes.get(candidate, 0.0) + weight * rarity

    add(source.text, 0, 1.0)
    add(index.source.blocks[source_index - 1].text if source_index > 0 else None, 1, 0.7)
    add(
        index.source.blocks[source_index + 1].text
        if source_index + 1 < len(index.source.blocks)
        else None,
        -1,
        0.7,
    )
    nearby = _closest_block(index.target.blocks, original_line)
    if nearby is not None:
        for offset in range(-2, 3):
            candidate = nearby + offset
            if 0 <= candidate < count:
                votes[candidate] = votes.get(candidate, 0.0) + 0.25
    return [
        block
        for block, _ in sorted(
            votes.items(),
            key=lambda item: (
                -item[1],
                abs(index.target.blocks[item[0]].start_line - original_line),
                item[0],
            ),
        )[:MAX_CONTEXT_CANDIDATE_BLOCKS]
    ]


def _closest_block(blocks: list[MarkdownBlock], line: int) -> int | None:
    if not blocks:
        return None
    low, high = 0, len(blocks) - 1
    while low <= high:
        middle = (low + high) // 2
        block = blocks[middle]
        if line < block.start_line:
            high = middle - 1
        elif line > block.end_line:
            low = middle + 1
        else:
            return middle
    if low >= len(blocks):
        return len(blocks) - 1
    if high < 0:
        return 0
    return (
        low
        if abs(blocks[low].start_line - line) < abs(blocks[high].end_line - line)
        else high
    )


def _to_window(target: DocumentBlockIndex, start: int, end: int) -> _CandidateWindow:
    first, last = target.blocks[start], target.blocks[end]
    return _CandidateWindow(
        start,
        end,
        first.start_line,
        last.end_line,
        first.type,
        "\n".join(target.lines[first.start_line : last.end_line + 1]),
        first.heading_path,
    )


def _score_candidate(
    source: MarkdownBlock,
    source_index: int,
    candidate: _CandidateWindow,
    index: AnchorContextIndex,
    original_line: int,
) -> float:
    content = _text_similarity(source.text, candidate.text)
    block_type = 1.0 if source.type == candidate.type else 0.0
    heading = _token_dice(" ".join(source.heading_path), " ".join(candidate.heading_path))
    previous = _neighbor_similarity(
        index.source.blocks[source_index - 1] if source_index > 0 else None,
        index.target.blocks[candidate.start_block - 1] if candidate.start_block > 0 else None,
    )
    next_score = _neighbor_similarity(
        index.source.blocks[source_index + 1]
        if source_index + 1 < len(index.source.blocks)
        else None,
        index.target.blocks[candidate.end_block + 1]
        if candidate.end_block + 1 < len(index.target.blocks)
        else None,
    )
    proximity = max(0.0, 1 - abs(candidate.start_line - original_line) / 100)
    return min(
        1.0,
        content * 0.45
        + block_type * 0.1
        + heading * 0.1
        + previous * 0.15
        + next_score * 0.15
        + proximity * 0.05,
    )


def _neighbor_similarity(left: MarkdownBlock | None, right: MarkdownBlock | None) -> float:
    return 0.0 if left is None or right is None else _text_similarity(left.text, right.text)


def _text_similarity(left: str, right: str) -> float:
    return max(_token_dice(left, right), combined_score(_normalize(left), _normalize(right)))


def _token_dice(left: str, right: str) -> float:
    left_tokens, right_tokens = _tokenize(left), _tokenize(right)
    if not left_tokens or not right_tokens:
        return 0.0
    remaining: dict[str, int] = {}
    for token in right_tokens:
        remaining[token] = remaining.get(token, 0) + 1
    overlap = 0
    for token in left_tokens:
        if remaining.get(token, 0) > 0:
            overlap += 1
            remaining[token] -= 1
    return 2 * overlap / (len(left_tokens) + len(right_tokens))


def _tokenize(text: str) -> list[str]:
    return re.findall(r"[\w-]+", _normalize(text), flags=re.UNICODE)


def _normalize(text: str) -> str:
    return re.sub(r"\s+", " ", text.lower()).strip()


def _resolve_candidate_range(
    comment: Comment,
    source: MarkdownBlock,
    candidate: _CandidateWindow,
    target: DocumentBlockIndex,
) -> tuple[int, int, int | None, int | None, str]:
    assert comment.line is not None and comment.selected_text is not None
    exact_index = candidate.text.find(comment.selected_text)
    whole_block = (
        comment.line == source.start_line
        and (comment.end_line or comment.line) == source.end_line
        and comment.start_column is None
        and comment.end_column is None
        and comment.selected_text == source.text
    )
    unique = _count_occurrences(source.text, comment.selected_text) == 1
    if exact_index >= 0 and (whole_block or unique):
        return _exact_range(
            candidate.start_line,
            candidate.text,
            comment.selected_text,
            exact_index,
        )
    if whole_block:
        return candidate.start_line, candidate.end_line, None, None, candidate.text
    relative = comment.line - source.start_line
    line = min(candidate.end_line, candidate.start_line + relative)
    span = (comment.end_line or comment.line) - comment.line
    end_line = min(candidate.end_line, line + span)
    text = _extract_text(
        target.lines, line, end_line, comment.start_column, comment.end_column
    ) or ""
    return line, end_line, comment.start_column, comment.end_column, text


def _exact_range(
    start_line: int, candidate: str, selected: str, index: int
) -> tuple[int, int, int, int, str]:
    before = candidate[:index].split("\n")
    selected_lines = selected.split("\n")
    line = start_line + len(before) - 1
    start_column = len(before[-1])
    final_length = len(selected_lines[-1])
    end_column = start_column + final_length if len(selected_lines) == 1 else final_length
    return line, line + len(selected_lines) - 1, start_column, end_column, selected


def _count_occurrences(text: str, needle: str) -> int:
    if not needle:
        return 0
    count, offset = 0, 0
    while offset <= len(text) - len(needle):
        index = text.find(needle, offset)
        if index < 0:
            break
        count += 1
        offset = index + 1
    return count


def _extract_text(
    lines: list[str],
    line: int,
    end_line: int | None = None,
    start_column: int | None = None,
    end_column: int | None = None,
) -> str | None:
    final = end_line or line
    if line < 1 or final >= len(lines):
        return None
    if line == final:
        text = lines[line]
        if start_column is not None and end_column is not None:
            return text[start_column:end_column]
        return text
    result = lines[line : final + 1]
    if start_column is not None:
        result[0] = result[0][start_column:]
    if end_column is not None:
        result[-1] = result[-1][:end_column]
    return "\n".join(result)
