//! Source-verified revision projection. Only unique unchanged lines vote for a
//! displacement. A copied selection plus one neighbor is insufficient evidence
//! for a confident relocation: two independent context signals are required.
use crate::{
    extract_text,
    fuzzy::{combined_score, exact_match},
    text::at_comment,
    utf16_length, utf16_slice, Comment,
};
use std::collections::BTreeMap;

const CONTEXT_RADIUS: usize = 8;

#[derive(Clone, Debug)]
pub struct RevisionProjectionIndex {
    pub source_lines: Vec<String>,
    pub target_lines: Vec<String>,
    pub line_map: BTreeMap<usize, usize>,
}

#[derive(Clone, Debug)]
pub struct ProjectedAnchor {
    pub line: usize,
    pub end_line: usize,
    pub start_column: Option<usize>,
    pub end_column: Option<usize>,
    pub text: String,
    pub score: f64,
    pub exact: bool,
    pub context_support: usize,
    pub context_margin: f64,
    pub reason: String,
}

pub fn create_revision_projection(source: &[String], target: &[String]) -> RevisionProjectionIndex {
    fn occurrences(lines: &[String]) -> BTreeMap<&str, Vec<usize>> {
        let mut map: BTreeMap<&str, Vec<usize>> = BTreeMap::new();
        for (i, text) in lines.iter().enumerate().skip(1) {
            if !text.trim().is_empty() {
                map.entry(text).or_default().push(i);
            }
        }
        map
    }
    let a = occurrences(source);
    let b = occurrences(target);
    let mut line_map = BTreeMap::new();
    for (text, numbers) in a {
        if numbers.len() == 1 {
            if let Some(other) = b.get(text).filter(|n| n.len() == 1) {
                line_map.insert(numbers[0], other[0]);
            }
        }
    }
    RevisionProjectionIndex {
        source_lines: source.into(),
        target_lines: target.into(),
        line_map,
    }
}

fn neighbors(c: &Comment, p: &RevisionProjectionIndex) -> Vec<(usize, usize, usize)> {
    let line = c.line.unwrap_or(0);
    let last = c.end_line.unwrap_or(line);
    let mut out = Vec::new();
    for distance in 1..=CONTEXT_RADIUS {
        for source in [line.checked_sub(distance), last.checked_add(distance)]
            .into_iter()
            .flatten()
        {
            if source == 0 || source >= p.source_lines.len() {
                continue;
            }
            if let Some(target) = p.line_map.get(&source) {
                out.push((source, *target, distance));
            }
        }
    }
    out
}

pub fn project_comment_anchor(
    c: &Comment,
    p: &RevisionProjectionIndex,
    threshold: f64,
) -> Option<ProjectedAnchor> {
    let line = c.line?;
    let selected = c.selected_text.as_deref().filter(|s| !s.is_empty())?;
    // Never trust a revision supplied by a caller unless its text verifies the
    // original range. This prevents stale positions becoming trusted evidence.
    if at_comment(&p.source_lines, c).as_deref() != Some(selected) {
        return None;
    }
    let exact = exact_match(&p.target_lines, selected);
    if exact.len() == 1 {
        let candidate = &exact[0];
        let expected = candidate.line as isize - line as isize;
        let support = if (c.start_column.is_some() || c.end_column.is_some())
            && p.line_map.get(&line) == Some(&candidate.line)
        {
            2
        } else {
            neighbors(c, p)
                .iter()
                .filter(|(s, t, _)| *t as isize - *s as isize == expected)
                .count()
        };
        if support >= 2 {
            return Some(ProjectedAnchor {
                line: candidate.line,
                end_line: candidate.end_line,
                start_column: Some(candidate.start_column),
                end_column: Some(candidate.end_column),
                text: candidate.text.clone(),
                score: 1.0,
                exact: true,
                context_support: support,
                context_margin: 1.0,
                reason: "Source revision and neighboring line evidence confirm exact relocation."
                    .into(),
            });
        }
    }
    if !exact.is_empty() {
        return None;
    }
    let mut votes: BTreeMap<isize, (usize, usize)> = BTreeMap::new();
    for (source, target, distance) in neighbors(c, p) {
        let vote = votes
            .entry(target as isize - source as isize)
            .or_insert((0, distance));
        vote.0 += 1;
        vote.1 = vote.1.min(distance);
    }
    let mut ranked: Vec<_> = votes.into_iter().collect();
    ranked.sort_by_key(|(shift, (count, nearest))| {
        (std::cmp::Reverse(*count), *nearest, shift.unsigned_abs())
    });
    let &(shift, (support, nearest)) = ranked.first()?;
    if support < 2 && nearest > 3 {
        return None;
    }
    if ranked
        .get(1)
        .is_some_and(|(_, vote)| *vote == (support, nearest))
    {
        return None;
    }
    let runner = ranked.get(1).map_or(0, |(_, (count, _))| *count);
    let projected = line.checked_add_signed(shift)?;
    let end = projected.checked_add(c.end_line.unwrap_or(line).checked_sub(line)?)?;
    if projected == 0 || end >= p.target_lines.len() {
        return None;
    }
    let mut start_column = c.start_column;
    let mut end_column = c.end_column;
    if c.end_line.is_none_or(|e| e == line) {
        if let (Some(a), Some(b)) = (start_column, end_column) {
            let source = &p.source_lines[line];
            let target = &p.target_lines[projected];
            let prefix = utf16_slice(source, 0, Some(a)).ok()?;
            let suffix = utf16_slice(source, b, None).ok()?;
            let length = utf16_length(target);
            let start = if target.starts_with(prefix) {
                utf16_length(prefix)
            } else {
                a.min(length)
            };
            let end = if target.ends_with(suffix) {
                length - utf16_length(suffix)
            } else {
                length.min(start + b.checked_sub(a)?)
            };
            start_column = Some(start);
            end_column = Some(end);
        }
    }
    let text = extract_text(
        &p.target_lines,
        projected,
        Some(end),
        start_column,
        end_column,
    )?;
    let score = (combined_score(selected, &text) + 0.1).min(1.0);
    if score < threshold {
        return None;
    }
    Some(ProjectedAnchor {
        line: projected,
        end_line: end,
        start_column,
        end_column,
        exact: text == selected,
        text,
        score,
        context_support: support,
        context_margin: (support - runner) as f64 / support as f64,
        reason: "Source revision context projects the edited anchor range.".into(),
    })
}
