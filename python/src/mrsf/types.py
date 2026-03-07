"""MRSF Types — shared type definitions for the MRSF CLI and library."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Literal

# ---------------------------------------------------------------------------
# MRSF Document
# ---------------------------------------------------------------------------


@dataclass
class Comment:
    """A single review comment."""

    # Required
    id: str
    author: str
    timestamp: str
    text: str
    resolved: bool | None = None

    # Optional — anchoring
    line: int | None = None
    end_line: int | None = None
    start_column: int | None = None
    end_column: int | None = None
    selected_text: str | None = None
    selected_text_hash: str | None = None
    anchored_text: str | None = None

    # Optional — metadata
    commit: str | None = None
    type: str | None = None
    severity: Literal["low", "medium", "high"] | None = None
    reply_to: str | None = None

    # Catch-all for unknown / x_-prefixed extension fields
    extra: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        """Serialize to a plain dict (for YAML/JSON output)."""
        d: dict[str, Any] = {
            "id": self.id,
            "author": self.author,
            "timestamp": self.timestamp,
            "text": self.text,
        }
        if self.resolved is not None:
            d["resolved"] = self.resolved
        if self.line is not None:
            d["line"] = self.line
        if self.end_line is not None:
            d["end_line"] = self.end_line
        if self.start_column is not None:
            d["start_column"] = self.start_column
        if self.end_column is not None:
            d["end_column"] = self.end_column
        if self.selected_text is not None:
            d["selected_text"] = self.selected_text
        if self.selected_text_hash is not None:
            d["selected_text_hash"] = self.selected_text_hash
        if self.anchored_text is not None:
            d["anchored_text"] = self.anchored_text
        if self.commit is not None:
            d["commit"] = self.commit
        if self.type is not None:
            d["type"] = self.type
        if self.severity is not None:
            d["severity"] = self.severity
        if self.reply_to is not None:
            d["reply_to"] = self.reply_to
        d.update(self.extra)
        return d

    @staticmethod
    def from_dict(d: dict[str, Any]) -> Comment:
        """Deserialize from a plain dict."""
        known_keys = {
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
        }
        extra = {k: v for k, v in d.items() if k not in known_keys}
        return Comment(
            id=d["id"],
            author=d.get("author", ""),
            timestamp=d.get("timestamp", ""),
            text=d.get("text", ""),
            resolved=d.get("resolved"),
            line=d.get("line"),
            end_line=d.get("end_line"),
            start_column=d.get("start_column"),
            end_column=d.get("end_column"),
            selected_text=d.get("selected_text"),
            selected_text_hash=d.get("selected_text_hash"),
            anchored_text=d.get("anchored_text"),
            commit=d.get("commit"),
            type=d.get("type"),
            severity=d.get("severity"),
            reply_to=d.get("reply_to"),
            extra=extra,
        )


@dataclass
class MrsfDocument:
    """A parsed MRSF sidecar document."""

    mrsf_version: str = "1.0"
    document: str = ""
    comments: list[Comment] = field(default_factory=list)
    # Catch-all for unknown / x_-prefixed extension fields at the top level
    extra: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        d: dict[str, Any] = {
            "mrsf_version": self.mrsf_version,
            "document": self.document,
            "comments": [c.to_dict() for c in self.comments],
        }
        d.update(self.extra)
        return d

    @staticmethod
    def from_dict(d: dict[str, Any]) -> MrsfDocument:
        known_keys = {"mrsf_version", "document", "comments"}
        extra = {k: v for k, v in d.items() if k not in known_keys}
        comments_raw = d.get("comments", [])
        comments = [Comment.from_dict(c) for c in comments_raw if isinstance(c, dict) and "id" in c]
        return MrsfDocument(
            mrsf_version=str(d.get("mrsf_version", "1.0")),
            document=str(d.get("document", "")),
            comments=comments,
            extra=extra,
        )


# ---------------------------------------------------------------------------
# Configuration (.mrsf.yaml)
# ---------------------------------------------------------------------------


@dataclass
class MrsfConfig:
    sidecar_root: str | None = None


# ---------------------------------------------------------------------------
# Validation
# ---------------------------------------------------------------------------

DiagnosticSeverity = Literal["error", "warning"]


@dataclass
class ValidationDiagnostic:
    severity: DiagnosticSeverity
    message: str
    path: str | None = None
    comment_id: str | None = None


@dataclass
class ValidationResult:
    valid: bool
    errors: list[ValidationDiagnostic] = field(default_factory=list)
    warnings: list[ValidationDiagnostic] = field(default_factory=list)


# ---------------------------------------------------------------------------
# Re-anchoring
# ---------------------------------------------------------------------------

ReanchorStatus = Literal["anchored", "shifted", "fuzzy", "ambiguous", "orphaned"]


@dataclass
class ReanchorResult:
    comment_id: str
    status: ReanchorStatus
    score: float
    reason: str
    new_line: int | None = None
    new_end_line: int | None = None
    new_start_column: int | None = None
    new_end_column: int | None = None
    anchored_text: str | None = None
    previous_selected_text: str | None = None


# ---------------------------------------------------------------------------
# Fuzzy matching
# ---------------------------------------------------------------------------


@dataclass
class FuzzyCandidate:
    """A candidate text match in the document."""

    text: str
    line: int  # 1-based
    end_line: int  # 1-based, inclusive
    start_column: int  # 0-based
    end_column: int  # 0-based
    score: float  # 0.0–1.0


# ---------------------------------------------------------------------------
# Git
# ---------------------------------------------------------------------------


@dataclass
class DiffHunk:
    old_start: int  # 1-based
    old_count: int
    new_start: int  # 1-based
    new_count: int
    lines: list[str] = field(default_factory=list)


# ---------------------------------------------------------------------------
# Comment operations
# ---------------------------------------------------------------------------


@dataclass
class AddCommentOptions:
    text: str
    author: str
    line: int | None = None
    end_line: int | None = None
    start_column: int | None = None
    end_column: int | None = None
    type: str | None = None
    severity: Literal["low", "medium", "high"] | None = None
    commit: str | None = None
    reply_to: str | None = None
    selected_text: str | None = None
    id: str | None = None
    timestamp: str | None = None
    extensions: dict[str, Any] = field(default_factory=dict)


@dataclass
class CommentFilter:
    open: bool | None = None
    resolved: bool | None = None
    orphaned: bool | None = None
    author: str | None = None
    type: str | None = None
    severity: Literal["low", "medium", "high"] | None = None


@dataclass
class CommentSummary:
    total: int = 0
    open: int = 0
    resolved: int = 0
    orphaned: int = 0
    threads: int = 0
    by_type: dict[str, int] = field(default_factory=dict)
    by_severity: dict[str, int] = field(default_factory=dict)


@dataclass
class RemoveCommentOptions:
    cascade: bool = False


# ---------------------------------------------------------------------------
# Status
# ---------------------------------------------------------------------------

AnchorHealth = Literal["fresh", "stale", "orphaned", "unknown"]


@dataclass
class StatusResult:
    comment_id: str
    health: AnchorHealth
    reason: str
    commit_age: str | None = None


# ---------------------------------------------------------------------------
# Shared options
# ---------------------------------------------------------------------------


@dataclass
class BaseOptions:
    cwd: str | None = None
    config_path: str | None = None


@dataclass
class ReanchorOptions(BaseOptions):
    dry_run: bool = False
    threshold: float = 0.6
    auto_update: bool = False
    staged: bool = False
    no_git: bool = False
    from_commit: str | None = None
    update_text: bool = False
    force: bool = False


@dataclass
class ValidateOptions(BaseOptions):
    strict: bool = False
