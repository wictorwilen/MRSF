#![doc = include_str!("../README.md")]
#![forbid(unsafe_code)]
pub mod calibration;
mod comments;
pub mod context;
mod discovery;
mod error;
pub mod fuzzy;
pub mod git;
mod model;
mod parser;
mod reanchor;
pub mod reconciliation;
pub mod revision;
mod text;
mod validation;
mod writer;

pub use comments::*;
pub use context::{create_anchor_context_index, resolve_context_anchor, AnchorContextIndex};
pub use discovery::*;
pub use error::{Error, Result};
pub use model::*;
pub use parser::*;
pub use reanchor::*;
pub use reconciliation::reconcile_comment_anchors;
pub use revision::{
    create_revision_projection, project_comment_anchor, ProjectedAnchor, RevisionProjectionIndex,
};
pub use text::*;
pub use validation::*;
pub use writer::*;
