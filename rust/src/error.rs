//! A single owned error type lets callers propagate failures with `?` without
//! erasing structured diagnostics. `#[from]` generates lossless conversions from
//! standard I/O/JSON errors; library-specific invariants use explicit variants.
use crate::ValidationResult;

/// Parsing, validation, preservation, filesystem, and Git failures.
#[derive(Debug, thiserror::Error)]
pub enum Error {
    #[error("I/O error: {0}")]
    Io(#[from] std::io::Error),
    #[error("invalid JSON: {0}")]
    Json(#[from] serde_json::Error),
    #[error("invalid YAML: {0}")]
    Yaml(String),
    #[error("validation failed: {0}")]
    Validation(ValidationResult),
    #[error("unsupported MRSF version: {0}")]
    UnsupportedVersion(String),
    #[error("unsafe or unsupported format-preserving edit: {0}")]
    Preservation(String),
    #[error("unsafe path: {0}")]
    Path(String),
    #[error("Git operation failed: {0}")]
    Git(String),
    #[error("Git operation exceeded 10 seconds")]
    GitTimeout,
    #[error("{0}")]
    Invalid(String),
}

/// Library result alias; `Ok(T)` carries success, `Err(Error)` retains the cause.
pub type Result<T> = std::result::Result<T, Error>;
