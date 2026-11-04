//! Bounded lexical/character retrieval followed by deterministic verification.
//! Columns are converted from Rust's UTF-8 byte boundaries to UTF-16 only at the
//! API boundary. Candidate verification never slices a string inside a scalar.
use crate::{utf16_length, FuzzyCandidate};
use std::{
    collections::{BTreeMap, BTreeSet, HashMap, HashSet},
    sync::LazyLock,
};

const MAX_CANDIDATES: usize = 64;
static TOKENS: LazyLock<regex::Regex> =
    LazyLock::new(|| regex::Regex::new(r"[\w-]+").expect("constant regex"));

pub(crate) fn normalize(text: &str) -> String {
    text.split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .to_lowercase()
}
pub(crate) fn tokens(text: &str) -> Vec<String> {
    TOKENS
        .find_iter(&normalize(text))
        .map(|m| m.as_str().into())
        .collect()
}
fn trigrams(text: &str) -> Vec<String> {
    let text: Vec<char> = normalize(text).chars().collect();
    if text.len() < 3 {
        if text.is_empty() {
            Vec::new()
        } else {
            vec![text.iter().collect()]
        }
    } else {
        text.windows(3).map(|w| w.iter().collect()).collect()
    }
}

/// Shared retrieval index. Rare lexical terms and Unicode character trigrams
/// complement one another: trigrams still retrieve CJK text and edited words.
#[derive(Clone, Debug)]
pub struct FuzzySearchIndex {
    pub lines: Vec<String>,
    token_postings: HashMap<String, Vec<usize>>,
    trigram_postings: HashMap<String, Vec<usize>>,
}

/// Build postings once per current document, rather than once per comment.
pub fn create_fuzzy_search_index(lines: &[String]) -> FuzzySearchIndex {
    fn add(map: &mut HashMap<String, Vec<usize>>, values: Vec<String>, line: usize) {
        for value in values.into_iter().collect::<HashSet<_>>() {
            map.entry(value).or_default().push(line);
        }
    }
    let mut index = FuzzySearchIndex {
        lines: lines.into(),
        token_postings: HashMap::new(),
        trigram_postings: HashMap::new(),
    };
    for (line, text) in lines.iter().enumerate().skip(1) {
        add(&mut index.token_postings, tokens(text), line);
        add(&mut index.trigram_postings, trigrams(text), line);
    }
    index
}

/// All occurrences, including overlapping ones. The internal line array is
/// 1-based; an empty selection has no occurrences.
pub fn exact_match(lines: &[String], needle: &str) -> Vec<FuzzyCandidate> {
    if needle.is_empty() {
        return Vec::new();
    }
    let count = needle.split('\n').count();
    let mut result = Vec::new();
    if lines.len() <= count {
        return result;
    }
    for start in 1..=lines.len() - count {
        let window = lines[start..start + count].join("\n");
        for (byte, _) in window.char_indices() {
            if !window[byte..].starts_with(needle) {
                continue;
            }
            let before = &window[..byte];
            // A multiline window must begin its match on its first line.
            if before.contains('\n') {
                continue;
            }
            let column = utf16_length(before);
            let final_text = needle.rsplit('\n').next().unwrap_or("");
            result.push(FuzzyCandidate {
                text: needle.into(),
                line: start,
                end_line: start + count - 1,
                start_column: column,
                end_column: if count == 1 {
                    column + utf16_length(needle)
                } else {
                    utf16_length(final_text)
                },
                score: 1.0,
            });
            if count > 1 {
                break;
            }
        }
    }
    result
}

/// Case-sensitive whitespace-normalized matching over nearby multiline windows.
/// Returned ranges cover the actual window, not offsets in normalized text.
pub fn normalized_match(lines: &[String], needle: &str) -> Vec<FuzzyCandidate> {
    // Whitespace matching is intentionally case-sensitive, unlike lexical
    // retrieval. Changing case is an edit, not normalization.
    let normalized = |s: &str| s.split_whitespace().collect::<Vec<_>>().join(" ");
    let needle_norm = normalized(needle);
    if needle_norm.is_empty() {
        return Vec::new();
    }
    let estimate = needle.split('\n').count();
    let mut result = Vec::new();
    for size in
        estimate.saturating_sub(1).max(1)..=(lines.len().saturating_sub(1)).min(estimate + 2)
    {
        for start in 1..=lines.len() - size {
            let text = lines[start..start + size].join("\n");
            if normalized(&text).contains(&needle_norm) {
                result.push(FuzzyCandidate {
                    text,
                    line: start,
                    end_line: start + size - 1,
                    start_column: 0,
                    end_column: utf16_length(&lines[start + size - 1]),
                    score: 0.95,
                });
            }
        }
    }
    deduplicate(result)
}

/// Token LCS uses two rows rather than a quadratic allocation.
pub fn token_lcs_score(a: &str, b: &str) -> f64 {
    let a: Vec<_> = a.split_whitespace().collect();
    let b: Vec<_> = b.split_whitespace().collect();
    if a.is_empty() && b.is_empty() {
        return 1.0;
    }
    let mut previous = vec![0; b.len() + 1];
    let mut current = previous.clone();
    for token in &a {
        for (j, other) in b.iter().enumerate() {
            current[j + 1] = if token == other {
                previous[j] + 1
            } else {
                previous[j + 1].max(current[j])
            };
        }
        std::mem::swap(&mut previous, &mut current);
        current.fill(0);
    }
    previous[b.len()] as f64 / a.len().max(b.len()).max(1) as f64
}

/// Scalar-based normalized edit similarity. Rust's byte length would unfairly
/// penalize emoji/CJK edits, so both distance and denominator use Unicode scalars.
pub fn levenshtein_score(a: &str, b: &str) -> f64 {
    let length = a.chars().count().max(b.chars().count());
    if length == 0 {
        1.0
    } else {
        1.0 - strsim::levenshtein(a, b) as f64 / length as f64
    }
}

/// 60% token LCS plus 40% character similarity. Character verification is skipped
/// for texts of 500+ scalars to bound expensive edit-distance work.
pub fn combined_score(a: &str, b: &str) -> f64 {
    let token = token_lcs_score(a, b);
    let chars = if a.chars().count() < 500 && b.chars().count() < 500 {
        levenshtein_score(a, b)
    } else {
        token
    };
    token * 0.6 + chars * 0.4
}

fn retrieve(index: &FuzzySearchIndex, needle: &str, hint: Option<usize>) -> Vec<usize> {
    let mut signals = Vec::new();
    for (postings, values, weight) in [
        (&index.token_postings, tokens(needle), 2.0),
        (&index.trigram_postings, trigrams(needle), 1.0),
    ] {
        let mut seen = HashSet::new();
        for value in values {
            if !seen.insert(value.clone()) {
                continue;
            }
            if let Some(lines) = postings.get(&value) {
                signals.push((lines, weight));
            }
        }
    }
    signals.sort_by_key(|s| s.0.len());
    let line_count = index.lines.len().saturating_sub(1);
    let mut votes: BTreeMap<usize, f64> = BTreeMap::new();
    for (lines, weight) in signals.into_iter().take(16) {
        let rarity = (line_count as f64 / lines.len() as f64).ln_1p();
        for line in lines {
            *votes.entry(*line).or_default() += weight * rarity;
        }
    }
    if let Some(hint) = hint {
        for line in hint.saturating_sub(4).max(1)..=line_count.min(hint.saturating_add(4)) {
            *votes.entry(line).or_default() += 0.25;
        }
    }
    if votes.is_empty() {
        return (1..=line_count.min(MAX_CANDIDATES)).collect();
    }
    let mut votes: Vec<_> = votes.into_iter().collect();
    votes.sort_by(|a, b| {
        b.1.total_cmp(&a.1)
            .then_with(|| {
                a.0.abs_diff(hint.unwrap_or(a.0))
                    .cmp(&b.0.abs_diff(hint.unwrap_or(b.0)))
            })
            .then(a.0.cmp(&b.0))
    });
    votes
        .into_iter()
        .take(MAX_CANDIDATES)
        .map(|v| v.0)
        .collect()
}

/// Retrieve at most 64 candidate lines, verify windows/substrings, and rank by
/// similarity with a small positional boost. Thresholds use the unboosted score.
pub fn fuzzy_search(
    lines: &[String],
    needle: &str,
    threshold: f64,
    hint: Option<usize>,
    index: Option<&FuzzySearchIndex>,
) -> Vec<FuzzyCandidate> {
    fuzzy_search_thresholds(lines, needle, &[threshold], hint, index)
        .pop()
        .unwrap_or_default()
}

/// Compute once, then partition by *unboosted* score. Positional boosting must
/// not allow a fundamentally unrelated candidate to cross a threshold.
pub fn fuzzy_search_thresholds(
    lines: &[String],
    needle: &str,
    thresholds: &[f64],
    hint: Option<usize>,
    index: Option<&FuzzySearchIndex>,
) -> Vec<Vec<FuzzyCandidate>> {
    if needle.is_empty() || thresholds.is_empty() {
        return vec![Vec::new(); thresholds.len()];
    }
    let owned;
    let index = if let Some(index) = index {
        index
    } else {
        owned = create_fuzzy_search_index(lines);
        &owned
    };
    let minimum = thresholds.iter().copied().fold(f64::INFINITY, f64::min);
    let candidate_lines = retrieve(index, needle, hint);
    let count = needle.split('\n').count();
    let mut candidates = Vec::new();
    for size in ((count as f64 * 0.7) as usize).max(1)
        ..=lines
            .len()
            .saturating_sub(1)
            .min((count as f64 * 1.3).ceil() as usize + 1)
    {
        let starts: BTreeSet<_> = candidate_lines
            .iter()
            .flat_map(|line| (0..size).filter_map(move |offset| line.checked_sub(offset)))
            .filter(|start| *start > 0 && start + size <= lines.len())
            .collect();
        for start in starts {
            let text = lines[start..start + size].join("\n");
            let score = combined_score(needle, &text);
            if score >= minimum {
                candidates.push(FuzzyCandidate {
                    text,
                    line: start,
                    end_line: start + size - 1,
                    start_column: 0,
                    end_column: utf16_length(&lines[start + size - 1]),
                    score,
                });
            }
        }
    }
    let needle_len = needle.chars().count();
    if count == 1 && needle_len < 200 {
        for number in candidate_lines {
            let line = &lines[number];
            let boundaries: Vec<_> = line
                .char_indices()
                .map(|(i, _)| i)
                .chain(std::iter::once(line.len()))
                .collect();
            let length = boundaries.len() - 1;
            let min = ((needle_len as f64 * 0.7) as usize).max(3);
            let max = length.min((needle_len as f64 * 1.3) as usize);
            let lengths: BTreeSet<_> = (0..7)
                .map(|i| {
                    if max <= min {
                        min
                    } else {
                        // Python uses ties-to-even rounding; explicit here for parity.
                        (min as f64 + (max - min) as f64 * i as f64 / 6.0).round_ties_even()
                            as usize
                    }
                })
                // Always test the original scalar length as well. Seven
                // evenly-spaced probes can skip it, truncating a one-character
                // substitution even when the stored UTF-16 range fits exactly.
                .chain((min..=max).contains(&needle_len).then_some(needle_len))
                .collect();
            for size in lengths {
                if size > length {
                    continue;
                }
                for start in 0..=length - size {
                    let text = &line[boundaries[start]..boundaries[start + size]];
                    let score = combined_score(needle, text);
                    if score >= minimum {
                        candidates.push(FuzzyCandidate {
                            text: text.into(),
                            line: number,
                            end_line: number,
                            start_column: utf16_length(&line[..boundaries[start]]),
                            end_column: utf16_length(&line[..boundaries[start + size]]),
                            score,
                        });
                    }
                }
            }
        }
    }
    let scored: Vec<_> = deduplicate(candidates)
        .into_iter()
        .map(|mut c| {
            let base = c.score;
            if let Some(hint) = hint {
                c.score =
                    (c.score + 0.1 * (1.0 - c.line.abs_diff(hint) as f64 / 50.0).max(0.0)).min(1.0);
            }
            (base, c)
        })
        .collect();
    thresholds
        .iter()
        .map(|t| {
            let mut result: Vec<_> = scored
                .iter()
                .filter(|(base, _)| base >= t)
                .map(|(_, c)| c.clone())
                .collect();
            result.sort_by(|a, b| b.score.total_cmp(&a.score));
            result
        })
        .collect()
}

fn deduplicate(candidates: Vec<FuzzyCandidate>) -> Vec<FuzzyCandidate> {
    let mut indexes = HashMap::new();
    let mut result: Vec<FuzzyCandidate> = Vec::new();
    for c in candidates {
        let key = (c.line, c.start_column, c.end_line, c.end_column);
        if let Some(&i) = indexes.get(&key) {
            let i: usize = i;
            if c.score > result[i].score {
                result[i] = c;
            }
        } else {
            indexes.insert(key, result.len());
            result.push(c);
        }
    }
    result
}
