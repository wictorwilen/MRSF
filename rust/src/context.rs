//! Markdown block structure and bidirectional context evidence. This is a
//! deliberately small block classifier, not a Markdown renderer: its purpose is
//! matching stable review context (including headings, lists, and fenced code).
use crate::{
    extract_text,
    fuzzy::{combined_score, normalize, tokens},
    text::at_comment,
    utf16_length, Comment, ReanchorStatus,
};
use std::{
    collections::{BTreeMap, BTreeSet, HashMap},
    sync::LazyLock,
};

const MATCH_THRESHOLD: f64 = 0.35;
const AMBIGUITY_MARGIN: f64 = 0.03;
const MAX_BLOCKS: usize = 64;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum BlockType {
    Heading,
    Code,
    List,
    Table,
    Blockquote,
    Paragraph,
}

#[derive(Clone, Debug)]
pub struct MarkdownBlock {
    pub start_line: usize,
    pub end_line: usize,
    pub kind: BlockType,
    pub text: String,
    pub heading_path: Vec<String>,
}

#[derive(Clone, Debug)]
pub struct DocumentBlockIndex {
    pub lines: Vec<String>,
    pub blocks: Vec<MarkdownBlock>,
    pub line_to_block: BTreeMap<usize, usize>,
    token_postings: HashMap<String, Vec<usize>>,
}

#[derive(Clone, Debug)]
pub struct AnchorContextIndex {
    pub source: DocumentBlockIndex,
    pub target: DocumentBlockIndex,
}

#[derive(Clone, Debug)]
pub struct ContextAnchorCandidate {
    pub score: f64,
    pub line: usize,
    pub end_line: usize,
    pub start_column: Option<usize>,
    pub end_column: Option<usize>,
    pub text: String,
    pub exact: bool,
}

#[derive(Clone, Debug)]
pub struct ContextAnchorResolution {
    pub status: ReanchorStatus,
    pub score: f64,
    pub candidate_margin: f64,
    pub reason: String,
    pub line: Option<usize>,
    pub end_line: Option<usize>,
    pub start_column: Option<usize>,
    pub end_column: Option<usize>,
    pub text: Option<String>,
}

#[derive(Clone, Debug)]
struct Window {
    start_block: usize,
    end_block: usize,
    block: MarkdownBlock,
    score: f64,
}

static HEADING: LazyLock<regex::Regex> =
    LazyLock::new(|| regex::Regex::new(r"^(#{1,6})\s+(.+)$").expect("constant regex"));
static LIST: LazyLock<regex::Regex> =
    LazyLock::new(|| regex::Regex::new(r"^\s*(?:[-*+]|\d+\.)\s+").expect("constant regex"));

fn classify(line: &str) -> (BlockType, usize, String) {
    if let Some(c) = HEADING.captures(line) {
        return (BlockType::Heading, c[1].len(), c[2].trim().into());
    }
    let trimmed = line.trim_start();
    if trimmed.starts_with("```") {
        (BlockType::Code, 0, String::new())
    } else if LIST.is_match(line) {
        (BlockType::List, 0, String::new())
    } else if trimmed.starts_with('|') {
        (BlockType::Table, 0, String::new())
    } else if trimmed.starts_with('>') {
        (BlockType::Blockquote, 0, String::new())
    } else {
        (BlockType::Paragraph, 0, String::new())
    }
}

pub fn create_document_block_index(lines: &[String]) -> DocumentBlockIndex {
    let mut blocks = Vec::new();
    let mut headings: Vec<(usize, String)> = Vec::new();
    let mut line = 1;
    while line < lines.len() {
        if lines[line].trim().is_empty() {
            line += 1;
            continue;
        }
        let start = line;
        let (kind, level, title) = classify(&lines[line]);
        if kind == BlockType::Heading {
            while headings.last().is_some_and(|(n, _)| *n >= level) {
                headings.pop();
            }
            blocks.push(MarkdownBlock {
                start_line: start,
                end_line: start,
                kind,
                text: lines[line].clone(),
                heading_path: headings.iter().map(|(_, t)| t.clone()).collect(),
            });
            headings.push((level, title));
            line += 1;
            continue;
        }
        line += 1;
        if kind == BlockType::Code {
            while line < lines.len() && !lines[line].trim_start().starts_with("```") {
                line += 1;
            }
            if line < lines.len() {
                line += 1;
            }
        } else {
            while line < lines.len()
                && !lines[line].trim().is_empty()
                && classify(&lines[line]).0 == kind
            {
                line += 1;
            }
        }
        blocks.push(MarkdownBlock {
            start_line: start,
            end_line: line - 1,
            kind,
            text: lines[start..line].join("\n"),
            heading_path: headings.iter().map(|(_, t)| t.clone()).collect(),
        });
    }
    let mut line_to_block = BTreeMap::new();
    let mut token_postings: HashMap<String, Vec<usize>> = HashMap::new();
    for (i, block) in blocks.iter().enumerate() {
        for line in block.start_line..=block.end_line {
            line_to_block.insert(line, i);
        }
        for token in tokens(&block.text).into_iter().collect::<BTreeSet<_>>() {
            token_postings.entry(token).or_default().push(i);
        }
    }
    DocumentBlockIndex {
        lines: lines.into(),
        blocks,
        line_to_block,
        token_postings,
    }
}

pub fn create_anchor_context_index(source: &[String], target: &[String]) -> AnchorContextIndex {
    AnchorContextIndex {
        source: create_document_block_index(source),
        target: create_document_block_index(target),
    }
}

pub fn get_anchor_context_scope(comment: &Comment, index: &AnchorContextIndex) -> Option<String> {
    Some(
        index.source.blocks[*index.source.line_to_block.get(&comment.line?)?]
            .heading_path
            .join("\u{1f}"),
    )
}

fn token_dice(left: &str, right: &str) -> f64 {
    let a = tokens(left);
    let b = tokens(right);
    if a.is_empty() || b.is_empty() {
        return 0.0;
    }
    let mut remaining: HashMap<&str, usize> = HashMap::new();
    for token in &b {
        *remaining.entry(token).or_default() += 1;
    }
    let mut overlap = 0;
    for token in &a {
        if let Some(count) = remaining.get_mut(token.as_str()) {
            if *count > 0 {
                overlap += 1;
                *count -= 1;
            }
        }
    }
    2.0 * overlap as f64 / (a.len() + b.len()) as f64
}

fn similarity(left: &str, right: &str) -> f64 {
    token_dice(left, right).max(combined_score(&normalize(left), &normalize(right)))
}

fn neighbor(left: Option<&MarkdownBlock>, right: Option<&MarkdownBlock>) -> f64 {
    match (left, right) {
        (Some(a), Some(b)) => similarity(&a.text, &b.text),
        _ => 0.0,
    }
}

fn retrieve(
    source: &MarkdownBlock,
    source_index: usize,
    original: usize,
    index: &AnchorContextIndex,
) -> Vec<usize> {
    let count = index.target.blocks.len();
    let mut votes: BTreeMap<usize, f64> = BTreeMap::new();
    let mut add = |text: Option<&str>, offset: isize, weight: f64| {
        let Some(text) = text else {
            return;
        };
        let mut postings: Vec<_> = tokens(text)
            .into_iter()
            .collect::<BTreeSet<_>>()
            .into_iter()
            .filter_map(|t| index.target.token_postings.get(&t))
            .collect();
        postings.sort_by_key(|p| p.len());
        for positions in postings.into_iter().take(12) {
            let rarity = (count as f64 / positions.len() as f64).ln_1p();
            for position in positions {
                if let Some(candidate) = position.checked_add_signed(offset).filter(|n| *n < count)
                {
                    *votes.entry(candidate).or_default() += weight * rarity;
                }
            }
        }
    };
    add(Some(&source.text), 0, 1.0);
    add(
        source_index
            .checked_sub(1)
            .map(|i| index.source.blocks[i].text.as_str()),
        1,
        0.7,
    );
    add(
        index
            .source
            .blocks
            .get(source_index + 1)
            .map(|b| b.text.as_str()),
        -1,
        0.7,
    );
    // On a gap, choose the block with the nearest boundary, matching the
    // source implementation's preference for the preceding block on a tie.
    let nearby = index
        .target
        .blocks
        .iter()
        .enumerate()
        .min_by_key(|(_, b)| {
            if original < b.start_line {
                b.start_line - original
            } else {
                original.saturating_sub(b.end_line)
            }
        })
        .map(|(i, _)| i);
    if let Some(nearby) = nearby {
        for i in nearby.saturating_sub(2)..count.min(nearby + 3) {
            *votes.entry(i).or_default() += 0.25;
        }
    }
    let mut ranked: Vec<_> = votes.into_iter().collect();
    ranked.sort_by(|a, b| {
        b.1.total_cmp(&a.1)
            .then_with(|| {
                index.target.blocks[a.0]
                    .start_line
                    .abs_diff(original)
                    .cmp(&index.target.blocks[b.0].start_line.abs_diff(original))
            })
            .then(a.0.cmp(&b.0))
    });
    ranked
        .into_iter()
        .take(MAX_BLOCKS)
        .map(|(i, _)| i)
        .collect()
}

fn window(target: &DocumentBlockIndex, start: usize, end: usize) -> Window {
    let mut block = target.blocks[start].clone();
    block.end_line = target.blocks[end].end_line;
    block.text = target.lines[block.start_line..=block.end_line].join("\n");
    Window {
        start_block: start,
        end_block: end,
        block,
        score: 0.0,
    }
}

fn score(
    source: &MarkdownBlock,
    source_index: usize,
    candidate: &Window,
    index: &AnchorContextIndex,
    original: usize,
) -> f64 {
    let content = similarity(&source.text, &candidate.block.text);
    let kind = if source.kind == candidate.block.kind {
        1.0
    } else {
        0.0
    };
    let heading = token_dice(
        &source.heading_path.join(" "),
        &candidate.block.heading_path.join(" "),
    );
    let previous = neighbor(
        source_index.checked_sub(1).map(|i| &index.source.blocks[i]),
        candidate
            .start_block
            .checked_sub(1)
            .map(|i| &index.target.blocks[i]),
    );
    let next = neighbor(
        index.source.blocks.get(source_index + 1),
        index.target.blocks.get(candidate.end_block + 1),
    );
    let proximity = (1.0 - candidate.block.start_line.abs_diff(original) as f64 / 100.0).max(0.0);
    (content * 0.45 + kind * 0.1 + heading * 0.1 + previous * 0.15 + next * 0.15 + proximity * 0.05)
        .min(1.0)
}

pub(crate) fn count_occurrences(text: &str, needle: &str) -> usize {
    if needle.is_empty() {
        return 0;
    }
    text.char_indices()
        .filter(|(i, _)| text[*i..].starts_with(needle))
        .count()
}

fn resolve_range(
    c: &Comment,
    source: &MarkdownBlock,
    candidate: &Window,
    target: &DocumentBlockIndex,
) -> ContextAnchorCandidate {
    let original = c.line.unwrap_or(0);
    let selected = c.selected_text.as_deref().unwrap_or("");
    let whole = original == source.start_line
        && c.end_line.unwrap_or(original) == source.end_line
        && c.start_column.is_none()
        && c.end_column.is_none()
        && selected == source.text;
    let unique = count_occurrences(&source.text, selected) == 1;
    if let Some(byte) = candidate
        .block
        .text
        .find(selected)
        .filter(|_| whole || unique)
    {
        let before = &candidate.block.text[..byte];
        let line = candidate.block.start_line + before.matches('\n').count();
        let start = utf16_length(before.rsplit('\n').next().unwrap_or(""));
        let span = selected.matches('\n').count();
        let end = utf16_length(selected.rsplit('\n').next().unwrap_or(""))
            + if span == 0 { start } else { 0 };
        return ContextAnchorCandidate {
            score: candidate.score,
            line,
            end_line: line + span,
            start_column: Some(start),
            end_column: Some(end),
            text: selected.into(),
            exact: true,
        };
    }
    if whole {
        return ContextAnchorCandidate {
            score: candidate.score,
            line: candidate.block.start_line,
            end_line: candidate.block.end_line,
            start_column: None,
            end_column: None,
            text: candidate.block.text.clone(),
            exact: candidate.block.text == selected,
        };
    }
    let relative = original.saturating_sub(source.start_line);
    let line = candidate
        .block
        .end_line
        .min(candidate.block.start_line + relative);
    let end_line = candidate
        .block
        .end_line
        .min(line + c.end_line.unwrap_or(original).saturating_sub(original));
    let text = extract_text(
        &target.lines,
        line,
        Some(end_line),
        c.start_column,
        c.end_column,
    )
    .unwrap_or_default();
    ContextAnchorCandidate {
        score: candidate.score,
        line,
        end_line,
        start_column: c.start_column,
        end_column: c.end_column,
        exact: text == selected,
        text,
    }
}

pub fn find_context_anchor_candidates(
    c: &Comment,
    index: &AnchorContextIndex,
) -> Vec<ContextAnchorCandidate> {
    let Some(line) = c.line else {
        return Vec::new();
    };
    let Some(selected) = c.selected_text.as_deref().filter(|s| !s.is_empty()) else {
        return Vec::new();
    };
    let Some(&source_index) = index.source.line_to_block.get(&line) else {
        return Vec::new();
    };
    if at_comment(&index.source.lines, c).as_deref() != Some(selected) {
        return Vec::new();
    }
    let source = &index.source.blocks[source_index];
    let mut windows = Vec::new();
    for start in retrieve(source, source_index, line, index) {
        windows.push(window(&index.target, start, start));
        let block = &index.target.blocks[start];
        if source.kind == BlockType::Paragraph
            && block.kind == BlockType::Paragraph
            && index.target.blocks.get(start + 1).is_some_and(|b| {
                b.kind == BlockType::Paragraph && b.heading_path == block.heading_path
            })
        {
            windows.push(window(&index.target, start, start + 1));
        }
    }
    for candidate in &mut windows {
        candidate.score = score(source, source_index, candidate, index, line);
    }
    windows.retain(|c| c.score >= MATCH_THRESHOLD);
    windows.sort_by(|a, b| {
        b.score.total_cmp(&a.score).then(
            a.block
                .start_line
                .abs_diff(line)
                .cmp(&b.block.start_line.abs_diff(line)),
        )
    });
    windows
        .iter()
        .map(|candidate| resolve_range(c, source, candidate, &index.target))
        .collect()
}

pub fn resolve_context_anchor(
    c: &Comment,
    index: &AnchorContextIndex,
) -> Option<ContextAnchorResolution> {
    let line = c.line?;
    let selected = c.selected_text.as_deref().filter(|s| !s.is_empty())?;
    index.source.line_to_block.get(&line)?;
    if at_comment(&index.source.lines, c).as_deref() != Some(selected) {
        return None;
    }
    if at_comment(&index.target.lines, c).as_deref() == Some(selected) {
        return Some(ContextAnchorResolution {
            status: ReanchorStatus::Anchored,
            score: 1.0,
            candidate_margin: 1.0,
            line: Some(line),
            end_line: Some(c.end_line.unwrap_or(line)),
            start_column: c.start_column,
            end_column: c.end_column,
            text: Some(selected.into()),
            reason: "Source-verified anchor remains exact at its stored position.".into(),
        });
    }
    let candidates = find_context_anchor_candidates(c, index);
    let Some(best) = candidates.first() else {
        if index
            .target
            .lines
            .get(1..)
            .unwrap_or_default()
            .join("\n")
            .contains(selected)
        {
            return None;
        }
        return Some(ContextAnchorResolution {
            status: ReanchorStatus::Orphaned,
            score: 0.0,
            candidate_margin: 1.0,
            line: None,
            end_line: None,
            start_column: None,
            end_column: None,
            text: None,
            reason: "Source block has no plausible structural or contextual match.".into(),
        });
    };
    let margin = candidates
        .get(1)
        .map_or(1.0, |second| best.score - second.score);
    if candidates.len() > 1 && margin < AMBIGUITY_MARGIN {
        return Some(ContextAnchorResolution {
            status: ReanchorStatus::Ambiguous,
            score: best.score,
            candidate_margin: margin,
            line: Some(best.line),
            end_line: Some(best.end_line),
            start_column: None,
            end_column: None,
            text: None,
            reason: "Structural candidates are too close.".into(),
        });
    }
    let repeated = best.exact
        && count_occurrences(
            &index.target.lines.get(1..).unwrap_or_default().join("\n"),
            selected,
        ) > 1;
    let exact = best.exact && !repeated;
    Some(ContextAnchorResolution {
        status: if exact {
            ReanchorStatus::Anchored
        } else {
            ReanchorStatus::Fuzzy
        },
        score: if exact { 1.0 } else { best.score },
        candidate_margin: margin,
        line: Some(best.line),
        end_line: Some(best.end_line),
        start_column: best.start_column,
        end_column: best.end_column,
        text: Some(best.text.clone()),
        reason: if exact {
            "Markdown structure and bidirectional context disambiguate the exact anchor."
        } else if repeated {
            "Markdown context selects one repeated exact anchor tentatively."
        } else {
            "Markdown structure and bidirectional context locate the edited anchor."
        }
        .into(),
    })
}
