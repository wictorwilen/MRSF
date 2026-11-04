//! Strict parsing validates the raw object before deserialization. Rust's typed
//! models alone cannot describe malformed fields (for example resolved="yes"),
//! so validating first provides useful diagnostics instead of losing evidence.
//! Lenient recovery is separate and always returns its original diagnostics.
use crate::{validate_value, Error, MrsfDocument, Result, ValidationResult};
use serde_json::{json, Value};
use std::path::Path;

/// Explicit serialization format. YAML is YAML 1.2, not YAML 1.1.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Format {
    Yaml,
    Json,
}

impl Format {
    /// `.json` (case-insensitive) selects JSON; all other extensions select YAML.
    pub fn from_path(path: impl AsRef<Path>) -> Self {
        if path
            .as_ref()
            .extension()
            .is_some_and(|e| e.eq_ignore_ascii_case("json"))
        {
            Self::Json
        } else {
            Self::Yaml
        }
    }
}

/// Parse YAML 1.2 or JSON without recovering malformed data.
pub fn parse_value(content: &str, format: Format) -> Result<Value> {
    match format {
        Format::Json => Ok(serde_json::from_str(content)?),
        Format::Yaml => oneyaml::from_str(content).map_err(|e| Error::Yaml(e.to_string())),
    }
}

fn check_major(value: &Value) -> Result<()> {
    if let Some(version) = value.get("mrsf_version").and_then(Value::as_str) {
        if version.split('.').next() != Some("1") {
            return Err(Error::UnsupportedVersion(version.into()));
        }
    }
    Ok(())
}

/// Read a UTF-8 sidecar and strictly parse according to its extension.
///
/// `impl AsRef<Path>` accepts `&str`, `Path`, and `PathBuf` without forcing
/// callers to allocate a new owned path. I/O and validation errors propagate.
pub fn parse_sidecar(path: impl AsRef<Path>) -> Result<MrsfDocument> {
    let path = path.as_ref();
    parse_sidecar_content(&std::fs::read_to_string(path)?, Format::from_path(path))
}

/// Strictly parse sidecar content with an explicit format (no format guessing).
/// Newer v1 minors are accepted with validation warnings; other majors fail.
pub fn parse_sidecar_content(content: &str, format: Format) -> Result<MrsfDocument> {
    let value = parse_value(content, format)?;
    check_major(&value)?;
    let report = validate_value(&value);
    if !report.valid {
        return Err(Error::Validation(report));
    }
    Ok(serde_json::from_value(value)?)
}

/// Recovered data together with unmodified-input diagnostics. Receiving a
/// document here is not a claim that the input was valid.
#[derive(Clone, Debug)]
pub struct ParsedDocument {
    pub document: MrsfDocument,
    /// Diagnostics refer to the unmodified input, including recovered errors.
    pub diagnostics: ValidationResult,
}

/// Explicit opt-in recovery. Required missing scalars receive defaults, invalid
/// optional fields are removed, and non-object comments are skipped. Every
/// malformed input field is reported. Unknown format majors are never recovered.
pub fn parse_sidecar_content_lenient(content: &str, format: Format) -> Result<ParsedDocument> {
    let mut value = parse_value(content, format)?;
    check_major(&value)?;
    let diagnostics = validate_value(&value);
    if !value.is_object() {
        return Err(Error::Validation(diagnostics));
    }
    let root = value.as_object_mut().expect("checked object");
    for (key, default) in [("mrsf_version", "1.0"), ("document", "")] {
        if !root.get(key).is_some_and(Value::is_string) {
            root.insert(key.into(), json!(default));
        }
    }
    if !root.get("comments").is_some_and(Value::is_array) {
        root.insert("comments".into(), json!([]));
    }
    let comments = root
        .get_mut("comments")
        .expect("comments")
        .as_array_mut()
        .expect("array");
    comments.retain(Value::is_object);
    for comment in comments {
        let c = comment.as_object_mut().expect("object");
        for key in ["id", "author", "timestamp", "text"] {
            if !c.get(key).is_some_and(Value::is_string) {
                c.insert(key.into(), json!(""));
            }
        }
        if !c.get("resolved").is_some_and(Value::is_boolean) {
            c.insert("resolved".into(), json!(false));
        }
        for key in ["line", "end_line", "start_column", "end_column"] {
            if c.get(key)
                .is_some_and(|v| v.as_u64().and_then(|n| usize::try_from(n).ok()).is_none())
            {
                c.remove(key);
            }
        }
        for key in [
            "selected_text",
            "selected_text_hash",
            "anchored_text",
            "commit",
            "type",
            "severity",
            "reply_to",
        ] {
            if c.get(key).is_some_and(|v| !v.is_string()) {
                c.remove(key);
            }
        }
    }
    Ok(ParsedDocument {
        document: serde_json::from_value(value)?,
        diagnostics,
    })
}

/// Read a sidecar with the same explicit semantic recovery as the content API.
/// File and syntax errors remain errors; this function never regex-salvages text.
pub fn parse_sidecar_lenient(path: impl AsRef<Path>) -> Result<ParsedDocument> {
    let path = path.as_ref();
    parse_sidecar_content_lenient(&std::fs::read_to_string(path)?, Format::from_path(path))
}

/// Read Markdown into the shared 1-based line layout, normalizing CRLF.
pub fn read_document_lines(path: impl AsRef<Path>) -> Result<Vec<String>> {
    Ok(crate::to_reanchor_lines(&std::fs::read_to_string(path)?))
}
