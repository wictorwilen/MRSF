"""MRSF — Public API (library surface).

Usage:
    from mrsf import validate, reanchor_file, add_comment, ...
"""

# Types
# Comments
from .comments import (
    add_comment,
    filter_comments,
    get_threads,
    populate_selected_text,
    remove_comment,
    resolve_comment,
    summarize,
    unresolve_comment,
)

# Discovery
from .discovery import (
    discover_all_sidecars,
    discover_sidecar,
    find_workspace_root,
    load_config,
    sidecar_to_document,
)

# Fuzzy matching
from .fuzzy import combined_score, exact_match, fuzzy_search, normalized_match

# Git
from .git import (
    detect_renames,
    find_repo_root,
    get_current_commit,
    get_diff,
    get_file_at_commit,
    get_line_shift,
    get_staged_files,
    is_git_available,
    is_stale,
    parse_diff_hunks,
)

# Parsing
from .parser import (
    LenientParseResult,
    parse_sidecar,
    parse_sidecar_content,
    parse_sidecar_content_lenient,
    parse_sidecar_lenient,
    read_document_lines,
)

# Re-anchoring
from .reanchor import (
    apply_reanchor_results,
    reanchor_comment,
    reanchor_document,
    reanchor_file,
)

# File resolution
from .resolve_files import resolve_sidecar_paths
from .types import (
    AddCommentOptions,
    AnchorHealth,
    BaseOptions,
    Comment,
    CommentFilter,
    CommentSummary,
    DiagnosticSeverity,
    DiffHunk,
    FuzzyCandidate,
    MrsfConfig,
    MrsfDocument,
    ReanchorOptions,
    ReanchorResult,
    ReanchorStatus,
    RemoveCommentOptions,
    StatusResult,
    ValidateOptions,
    ValidationDiagnostic,
    ValidationResult,
)

# Validation
from .validator import validate, validate_file

# Writing
from .writer import compute_hash, sync_hash, to_json, to_yaml, write_sidecar

__all__ = [
    # Types
    "AddCommentOptions",
    "AnchorHealth",
    "BaseOptions",
    "Comment",
    "CommentFilter",
    "CommentSummary",
    "DiagnosticSeverity",
    "DiffHunk",
    "FuzzyCandidate",
    "LenientParseResult",
    "MrsfConfig",
    "MrsfDocument",
    "ReanchorOptions",
    "ReanchorResult",
    "ReanchorStatus",
    "RemoveCommentOptions",
    "StatusResult",
    "ValidateOptions",
    "ValidationDiagnostic",
    "ValidationResult",
    # Discovery
    "discover_all_sidecars",
    "discover_sidecar",
    "find_workspace_root",
    "load_config",
    "sidecar_to_document",
    # File resolution
    "resolve_sidecar_paths",
    # Parsing
    "parse_sidecar",
    "parse_sidecar_content",
    "parse_sidecar_content_lenient",
    "parse_sidecar_lenient",
    "read_document_lines",
    # Writing
    "compute_hash",
    "sync_hash",
    "to_json",
    "to_yaml",
    "write_sidecar",
    # Validation
    "validate",
    "validate_file",
    # Fuzzy
    "combined_score",
    "exact_match",
    "fuzzy_search",
    "normalized_match",
    # Git
    "detect_renames",
    "find_repo_root",
    "get_current_commit",
    "get_diff",
    "get_file_at_commit",
    "get_line_shift",
    "get_staged_files",
    "is_git_available",
    "is_stale",
    "parse_diff_hunks",
    # Re-anchoring
    "apply_reanchor_results",
    "reanchor_comment",
    "reanchor_document",
    "reanchor_file",
    # Comments
    "add_comment",
    "filter_comments",
    "get_threads",
    "populate_selected_text",
    "remove_comment",
    "resolve_comment",
    "summarize",
    "unresolve_comment",
]
