//! UTF-16 wire coordinates over UTF-8 Rust strings. Rust string indexes are byte
//! positions and may only fall at Unicode scalar boundaries; MRSF columns are
//! UTF-16 code units. A non-BMP character therefore advances a column by two,
//! even though its UTF-8 encoding occupies four bytes.
use crate::{Comment, Error, Result};

/// Number of UTF-16 code units, not bytes, scalars, or rendered glyphs.
pub fn utf16_length(text: &str) -> usize {
    text.encode_utf16().count()
}

/// Convert an offset without splitting a surrogate pair. Out-of-range offsets
/// are clamped to end-of-line; an interior surrogate boundary is rejected.
pub fn utf16_to_byte(text: &str, offset: usize) -> Result<usize> {
    let mut units = 0;
    for (byte, ch) in text.char_indices() {
        if units == offset {
            return Ok(byte);
        }
        units += ch.len_utf16();
        if units > offset {
            return Err(Error::Invalid(
                "column splits a UTF-16 surrogate pair".into(),
            ));
        }
    }
    Ok(text.len())
}

/// Borrow a half-open substring using UTF-16 columns. No string is copied.
/// `None` means through end-of-line. A split surrogate pair is an explicit
/// error, since Rust cannot represent an isolated surrogate as valid UTF-8.
pub fn utf16_slice(text: &str, start: usize, end: Option<usize>) -> Result<&str> {
    let a = utf16_to_byte(text, start)?;
    let b = utf16_to_byte(text, end.unwrap_or(usize::MAX))?;
    text.get(a..b)
        .ok_or_else(|| Error::Invalid("end_column precedes start_column".into()))
}

/// The matching APIs use a 1-based line array (element zero is empty).
pub fn to_reanchor_lines(text: &str) -> Vec<String> {
    std::iter::once(String::new())
        .chain(text.replace("\r\n", "\n").split('\n').map(str::to_owned))
        .collect()
}

/// Extract a possibly multiline range, returning `None` if the lines or scalar
/// boundaries are invalid. Only first/last lines are trimmed for multiline spans.
pub fn extract_text(
    lines: &[String],
    line: usize,
    end_line: Option<usize>,
    start: Option<usize>,
    end: Option<usize>,
) -> Option<String> {
    let last = end_line.unwrap_or(line);
    if line == 0 || last < line || last >= lines.len() {
        return None;
    }
    if line == last {
        return if let (Some(a), Some(b)) = (start, end) {
            utf16_slice(&lines[line], a, Some(b))
                .ok()
                .map(str::to_owned)
        } else {
            Some(lines[line].clone())
        };
    }
    let mut result = lines[line..=last].to_vec();
    if let Some(a) = start {
        result[0] = utf16_slice(&result[0], a, None).ok()?.into();
    }
    if let Some(b) = end {
        let i = result.len() - 1;
        result[i] = utf16_slice(&result[i], 0, Some(b)).ok()?.into();
    }
    Some(result.join("\n"))
}

pub(crate) fn at_comment(lines: &[String], c: &Comment) -> Option<String> {
    extract_text(lines, c.line?, c.end_line, c.start_column, c.end_column)
}
