//! Canonical JSON Schema plus cross-field semantics. The bundled schema is
//! compiled once with `LazyLock`; no schema is downloaded at runtime. Validation
//! borrows its input and does not normalize or mutate extension data.
use crate::{compute_hash, Error, MrsfDocument, Result, ValidateOptions};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{collections::HashSet, fmt, sync::LazyLock};

pub const SIDECAR_SCHEMA: &str = include_str!("../schemas/mrsf.schema.json");
pub const CONFIG_SCHEMA: &str = include_str!("../schemas/mrsf-config.schema.json");

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum DiagnosticSeverity {
    Error,
    Warning,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct ValidationDiagnostic {
    pub severity: DiagnosticSeverity,
    pub path: String,
    pub message: String,
    pub comment_id: Option<String>,
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct ValidationResult {
    pub valid: bool,
    pub errors: Vec<ValidationDiagnostic>,
    pub warnings: Vec<ValidationDiagnostic>,
}

impl fmt::Display for ValidationResult {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        for (i, d) in self.errors.iter().chain(&self.warnings).enumerate() {
            if i > 0 {
                write!(f, "; ")?;
            }
            write!(f, "{}: {}", d.path, d.message)?;
        }
        Ok(())
    }
}

impl ValidationResult {
    pub(crate) fn diagnostic(
        &mut self,
        warning: bool,
        path: impl Into<String>,
        message: impl Into<String>,
        id: Option<&str>,
    ) {
        let d = ValidationDiagnostic {
            severity: if warning {
                DiagnosticSeverity::Warning
            } else {
                DiagnosticSeverity::Error
            },
            path: path.into(),
            message: message.into(),
            comment_id: id.map(str::to_owned),
        };
        if warning {
            self.warnings.push(d);
        } else {
            self.errors.push(d);
        }
        self.valid = self.errors.is_empty();
    }
}

static SCHEMA: LazyLock<jsonschema::Validator> = LazyLock::new(|| {
    jsonschema::options()
        .should_validate_formats(true)
        .build(&serde_json::from_str::<Value>(SIDECAR_SCHEMA).expect("bundled schema JSON"))
        .expect("bundled schema is valid")
});

/// Validate a typed document, returning all errors and advisory warnings.
pub fn validate(doc: &MrsfDocument) -> ValidationResult {
    let mut report = match serde_json::to_value(doc) {
        Ok(value) => validate_value(&value),
        Err(error) => {
            let mut r = ValidationResult::default();
            r.diagnostic(false, "", error.to_string(), None);
            r
        }
    };
    // `flatten` permits ergonomic access to unknown fields, but a manually
    // constructed extension map must not shadow a modeled field. Without this
    // check serde's map emission could hide the typed value during validation.
    for key in ["mrsf_version", "document", "comments"] {
        if doc.extra.contains_key(key) {
            report.diagnostic(
                false,
                format!("/{key}"),
                "extension shadows a modeled top-level field",
                None,
            );
        }
    }
    for (i, c) in doc.comments.iter().enumerate() {
        for key in [
            "id",
            "author",
            "timestamp",
            "text",
            "resolved",
            "line",
            "end_line",
            "start_column",
            "end_column",
            "selected_text",
            "selected_text_hash",
            "anchored_text",
            "commit",
            "type",
            "severity",
            "reply_to",
        ] {
            if c.extra.contains_key(key) {
                report.diagnostic(
                    false,
                    format!("/comments/{i}/{key}"),
                    "extension shadows a modeled comment field",
                    Some(&c.id),
                );
            }
        }
    }
    report
}

/// Optionally treat advisory warnings as a failing validation result.
pub fn validate_with_options(doc: &MrsfDocument, options: ValidateOptions) -> ValidationResult {
    let mut report = validate(doc);
    if options.strict && !report.warnings.is_empty() {
        report.valid = false;
    }
    report
}

/// Validate raw input before typed deserialization, retaining every field diagnostic.
pub fn validate_value(value: &Value) -> ValidationResult {
    let mut r = ValidationResult {
        valid: true,
        ..Default::default()
    };
    for e in SCHEMA.iter_errors(value) {
        r.diagnostic(false, e.instance_path.to_string(), e.to_string(), None);
    }
    if let Some(version) = value.get("mrsf_version").and_then(Value::as_str) {
        if version.starts_with("1.") && version != "1.0" {
            r.diagnostic(
                true,
                "/mrsf_version",
                "newer minor version accepted; unknown fields retained",
                None,
            );
        }
    }
    if value
        .get("document")
        .and_then(Value::as_str)
        .is_some_and(str::is_empty)
    {
        r.diagnostic(false, "/document", "document must not be empty", None);
    }
    if let Some(document) = value
        .get("document")
        .and_then(Value::as_str)
        .filter(|s| !s.is_empty())
    {
        if crate::safe_relative_path(document).is_err() {
            r.diagnostic(
                false,
                "/document",
                "document must be a safe workspace-relative path",
                None,
            );
        }
    }
    let mut ids = HashSet::new();
    if let Some(comments) = value.get("comments").and_then(Value::as_array) {
        for (i, c) in comments.iter().enumerate() {
            let id = c.get("id").and_then(Value::as_str);
            let p = format!("/comments/{i}");
            if let Some(id) = id {
                if !ids.insert(id) {
                    r.diagnostic(false, format!("{p}/id"), "Duplicate comment id", Some(id));
                }
            }
            let line = c.get("line").and_then(Value::as_u64);
            let end = c.get("end_line").and_then(Value::as_u64);
            if line.is_some()
                && c.get("selected_text")
                    .and_then(Value::as_str)
                    .is_none_or(str::is_empty)
            {
                r.diagnostic(
                    true,
                    format!("{p}/selected_text"),
                    "line anchor has no selected_text; anchoring across edits will be fragile",
                    id,
                );
            }
            if let (Some(a), Some(b)) = (line, end) {
                if b < a {
                    r.diagnostic(
                        false,
                        format!("{p}/end_line"),
                        "end_line must be >= line",
                        id,
                    );
                }
            }
            if line.is_none() || end.is_none() || end == line {
                if let (Some(a), Some(b)) = (
                    c.get("start_column").and_then(Value::as_u64),
                    c.get("end_column").and_then(Value::as_u64),
                ) {
                    if b < a {
                        r.diagnostic(
                            false,
                            format!("{p}/end_column"),
                            "end_column must be >= start_column on the same line",
                            id,
                        );
                    }
                }
            }
            if let (Some(text), Some(hash)) = (
                c.get("selected_text").and_then(Value::as_str),
                c.get("selected_text_hash").and_then(Value::as_str),
            ) {
                if compute_hash(text) != hash {
                    r.diagnostic(
                        true,
                        format!("{p}/selected_text_hash"),
                        "selected_text_hash mismatch",
                        id,
                    );
                }
            }
            if c.get("text")
                .and_then(Value::as_str)
                .is_some_and(|s| s.chars().count() > 16384)
            {
                r.diagnostic(
                    true,
                    format!("{p}/text"),
                    "text exceeds 16384 characters",
                    id,
                );
            }
        }
        for (i, c) in comments.iter().enumerate() {
            if let Some(parent) = c.get("reply_to").and_then(Value::as_str) {
                let id = c.get("id").and_then(Value::as_str);
                if !ids.contains(parent) {
                    r.diagnostic(
                        true,
                        format!("/comments/{i}/reply_to"),
                        "reply_to does not resolve to an existing comment",
                        id,
                    );
                }
                let mut seen = HashSet::new();
                let mut current = id;
                while let Some(node) = current {
                    if !seen.insert(node) {
                        r.diagnostic(
                            true,
                            format!("/comments/{i}/reply_to"),
                            "reply_to cycle",
                            id,
                        );
                        break;
                    }
                    current = comments
                        .iter()
                        .find(|c| c.get("id").and_then(Value::as_str) == Some(node))
                        .and_then(|c| c.get("reply_to"))
                        .and_then(Value::as_str);
                }
            }
        }
    }
    r
}

pub(crate) fn ensure_valid(doc: &MrsfDocument) -> Result<()> {
    let r = validate(doc);
    if r.valid {
        Ok(())
    } else {
        Err(Error::Validation(r))
    }
}

/// Validate raw file contents without discarding malformed fields. I/O/syntax
/// errors use `Result::Err`; schema/semantic failures are diagnostics in `Ok`.
pub fn validate_file(path: impl AsRef<std::path::Path>) -> Result<ValidationResult> {
    let path = path.as_ref();
    let value = crate::parse_value(
        &std::fs::read_to_string(path)?,
        crate::Format::from_path(path),
    )?;
    Ok(validate_value(&value))
}
