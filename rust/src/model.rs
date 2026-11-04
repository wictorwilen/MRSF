//! Owned wire models. `String` and `Vec` keep documents independent of parser
//! buffers, which makes edits and long-lived editor state straightforward.
//! `Option<T>` distinguishes an absent optional field from a present zero/empty
//! value. Serde's `flatten` puts unknown keys back at their original object
//! level instead of serializing an artificial `extra` wrapper.
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};

/// Unknown fields are retained at every modeled object boundary.
pub type Extensions = Map<String, Value>;

/// A v1 sidecar. Crate version and format version are independent.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct MrsfDocument {
    /// MRSF format version, currently `"1.0"`, independent of the crate version.
    pub mrsf_version: String,
    /// Repository/workspace-relative Markdown path, even for redirected sidecars.
    pub document: String,
    /// Input order is significant for human review and is retained on writes.
    pub comments: Vec<Comment>,
    /// Unknown standard/future fields and `x_*` extension values.
    #[serde(flatten)]
    pub extra: Extensions,
}

impl Default for MrsfDocument {
    fn default() -> Self {
        Self {
            mrsf_version: "1.0".into(),
            document: String::new(),
            comments: Vec::new(),
            extra: Extensions::new(),
        }
    }
}

impl MrsfDocument {
    /// Create an empty v1 sidecar for a workspace-relative Markdown document.
    pub fn new(document: impl Into<String>) -> Self {
        Self {
            document: document.into(),
            ..Self::default()
        }
    }
}

/// Comment positions use 1-based lines and 0-based UTF-16 code units.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
pub struct Comment {
    /// Stable opaque identity. Use UUIDs for new comments, never array indexes.
    pub id: String,
    /// Self-asserted reviewer attribution; not proof of authenticated identity.
    pub author: String,
    /// Creation time in RFC 3339 including `Z` or a numeric timezone offset.
    pub timestamp: String,
    /// Plain review text, not Markdown that should be trusted/rendered as HTML.
    pub text: String,
    /// Independent lifecycle state: resolving a parent does not resolve replies.
    pub resolved: bool,
    /// Starting line, 1-based. After reanchoring this can refer to an uncommitted
    /// working snapshot, not the revision still retained in `commit`.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub line: Option<usize>,
    /// Inclusive ending source line; absent means the starting line.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub end_line: Option<usize>,
    /// Inclusive UTF-16 code-unit offset, never a UTF-8 byte position.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub start_column: Option<usize>,
    /// Exclusive UTF-16 offset in end_line (or line when end_line is absent).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub end_column: Option<usize>,
    /// Original reviewer selection. Reanchoring preserves it by default.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub selected_text: Option<String>,
    /// Lowercase SHA-256 of selected_text's UTF-8 bytes.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub selected_text_hash: Option<String>,
    /// Current resolved text when an edited match differs from selected_text.
    /// Also retains the first verified relocation of a line-only anchor, so a
    /// later run can verify that range without reapplying a stale Git shift.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub anchored_text: Option<String>,
    /// Source Git revision. Full hashes avoid future abbreviation ambiguity.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub commit: Option<String>,
    /// Wire field `type`; `r#` escapes the Rust keyword without changing YAML/JSON.
    #[serde(rename = "type", skip_serializing_if = "Option::is_none")]
    pub r#type: Option<String>,
    /// Canonical values are low, medium, high; validation checks the wire schema.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub severity: Option<String>,
    /// Parent comment id in the same document. Forward references are allowed.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reply_to: Option<String>,
    /// Unknown fields, including other tools' extensions; do not reinterpret them.
    #[serde(flatten)]
    pub extra: Extensions,
}

/// New-comment inputs. Required strings are owned so the generated comment
/// never borrows a caller's short-lived buffers. `Default` supplies optional
/// omissions; callers normally specify `author` and `text` explicitly.
#[derive(Clone, Debug, Default)]
pub struct AddCommentOptions {
    pub text: String,
    pub author: String,
    pub id: Option<String>,
    pub timestamp: Option<String>,
    pub line: Option<usize>,
    pub end_line: Option<usize>,
    pub start_column: Option<usize>,
    pub end_column: Option<usize>,
    pub selected_text: Option<String>,
    pub commit: Option<String>,
    pub r#type: Option<String>,
    pub severity: Option<String>,
    pub reply_to: Option<String>,
    pub extensions: Extensions,
}

/// Equality filters combine with logical AND; `None` leaves a field unrestricted.
#[derive(Clone, Debug, Default)]
pub struct CommentFilter {
    pub open: Option<bool>,
    pub resolved: Option<bool>,
    pub orphaned: Option<bool>,
    pub author: Option<String>,
    pub r#type: Option<String>,
    pub severity: Option<String>,
}

/// Aggregate comment counts without changing comment order or thread state.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct CommentSummary {
    pub total: usize,
    pub open: usize,
    pub resolved: usize,
    pub orphaned: usize,
    pub threads: usize,
    pub by_type: std::collections::BTreeMap<String, usize>,
    pub by_severity: std::collections::BTreeMap<String, usize>,
}

/// Destructive deletion is an explicit opt-in rather than the default.
#[derive(Clone, Copy, Debug, Default)]
pub struct RemoveCommentOptions {
    /// Delete all descendants rather than promoting direct replies.
    pub cascade: bool,
}

/// `.mrsf.yaml` workspace configuration. Unknown config keys are disallowed by
/// the bundled canonical config schema, unlike sidecar extension fields.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
pub struct MrsfConfig {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub sidecar_root: Option<String>,
    #[serde(flatten)]
    pub extra: Extensions,
}

/// Anchor Mesh outcomes. `Fuzzy` is tentative/reviewable; `Ambiguous` is
/// deliberate abstention, and `Orphaned` never means deleting a comment.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ReanchorStatus {
    Anchored,
    Shifted,
    Fuzzy,
    Ambiguous,
    Orphaned,
}

/// Proposed location of one existing comment. `None` range fields mean no
/// replacement was established; callers should retain the original value.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct ReanchorResult {
    pub comment_id: String,
    pub status: ReanchorStatus,
    pub score: f64,
    pub reason: String,
    pub new_line: Option<usize>,
    pub new_end_line: Option<usize>,
    pub new_start_column: Option<usize>,
    pub new_end_column: Option<usize>,
    pub anchored_text: Option<String>,
    pub previous_selected_text: Option<String>,
}

/// Reanchoring policy. Defaults favor preserving reviewer intent over silently
/// replacing original selected text or stamping an uncertain result as current.
#[derive(Clone, Debug)]
pub struct ReanchorOptions {
    /// Minimum unboosted fuzzy similarity; default `0.6`.
    pub threshold: f64,
    /// Maximum unverified exact relocation distance in lines; default `5`.
    pub proximity_window: usize,
    /// Disable Git entirely, including repository discovery and HEAD queries.
    pub no_git: bool,
    /// Explicit source revision overriding each comment's stored commit. This
    /// does not manufacture source coordinates for already-captured line-only
    /// anchors; those use conservative current-text matching instead.
    pub from_commit: Option<String>,
    /// Replace selected_text on edited matches and recompute its SHA-256 hash.
    pub update_text: bool,
    /// Stamp certain successful anchors with HEAD and clear stale-status extras.
    /// Line-only captures remain intact: HEAD may not include working-tree edits.
    pub force: bool,
    /// File helpers return proposals without modifying the sidecar.
    pub dry_run: bool,
}

impl Default for ReanchorOptions {
    fn default() -> Self {
        Self {
            threshold: 0.6,
            proximity_window: 5,
            no_git: false,
            from_commit: None,
            update_text: false,
            force: false,
            dry_run: false,
        }
    }
}

/// Verified text candidate with inclusive line bounds and half-open UTF-16 columns.
#[derive(Clone, Debug, PartialEq)]
pub struct FuzzyCandidate {
    pub text: String,
    pub line: usize,
    pub end_line: usize,
    pub start_column: usize,
    pub end_column: usize,
    pub score: f64,
}

/// One zero-context unified diff hunk, preserving signed operations as strings.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct DiffHunk {
    pub old_start: usize,
    pub old_count: usize,
    pub new_start: usize,
    pub new_count: usize,
    pub lines: Vec<String>,
}

/// Validation policy; warning escalation does not erase the warning diagnostics.
#[derive(Clone, Copy, Debug, Default)]
pub struct ValidateOptions {
    pub strict: bool,
}
