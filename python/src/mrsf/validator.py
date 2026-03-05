"""MRSF Validator — JSON Schema + cross-field validation per §10."""

from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any

import jsonschema

from .parser import parse_sidecar
from .schemas import MRSF_SCHEMA_PATH
from .types import MrsfDocument, ValidateOptions, ValidationDiagnostic, ValidationResult
from .writer import compute_hash

# Strict RFC 3339 with mandatory timezone offset (§6.1)
_RFC3339_TZ = re.compile(
    r"^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$",
    re.IGNORECASE,
)

_schema_cache: dict[str, Any] | None = None


def _load_schema() -> dict[str, Any]:
    global _schema_cache
    if _schema_cache is not None:
        return _schema_cache
    raw = MRSF_SCHEMA_PATH.read_text(encoding="utf-8")
    _schema_cache = json.loads(raw)
    return _schema_cache


def validate(doc: MrsfDocument, options: ValidateOptions | None = None) -> ValidationResult:
    """Validate an MRSF document (parsed object)."""
    if options is None:
        options = ValidateOptions()

    errors: list[ValidationDiagnostic] = []
    warnings: list[ValidationDiagnostic] = []

    # JSON Schema validation
    raw_schema = _load_schema()
    # Strip $schema for compatibility with jsonschema validator
    schema = {k: v for k, v in raw_schema.items() if k != "$schema"}

    doc_dict = doc.to_dict()
    validator = jsonschema.Draft7Validator(schema, format_checker=jsonschema.FormatChecker())
    for error in sorted(validator.iter_errors(doc_dict), key=lambda e: list(e.absolute_path)):
        path_str = (
            "/" + "/".join(str(p) for p in error.absolute_path) if error.absolute_path else "/"
        )
        errors.append(
            ValidationDiagnostic(
                severity="error",
                message=f"{path_str}: {error.message}",
                path=path_str,
            )
        )

    # Top-level field checks (§4)
    if not doc.document:
        errors.append(
            ValidationDiagnostic(
                severity="error",
                message='/document: "document" must be a non-empty string',
                path="/document",
            )
        )

    # Cross-field validation (§10)
    comments = doc.comments
    ids: set[str] = set()

    for i, c in enumerate(comments):
        prefix = f"/comments/{i}"

        # Required field emptiness checks (§6.1)
        # Python's Comment.from_dict fills "" defaults for missing required
        # string fields; we must catch empties that the JSON Schema misses.
        if not c.author:
            errors.append(
                ValidationDiagnostic(
                    severity="error",
                    message=f'{prefix}/author: required field "author" is missing or empty',
                    path=f"{prefix}/author",
                    comment_id=c.id,
                )
            )
        if not c.timestamp:
            errors.append(
                ValidationDiagnostic(
                    severity="error",
                    message=f'{prefix}/timestamp: required field "timestamp" is missing or empty',
                    path=f"{prefix}/timestamp",
                    comment_id=c.id,
                )
            )
        elif isinstance(c.timestamp, str) and not _RFC3339_TZ.match(c.timestamp):
            errors.append(
                ValidationDiagnostic(
                    severity="error",
                    message=(
                        f'{prefix}/timestamp: "{c.timestamp}" is not valid'
                        f" RFC 3339 with timezone offset"
                    ),
                    path=f"{prefix}/timestamp",
                    comment_id=c.id,
                )
            )
        if not c.text:
            errors.append(
                ValidationDiagnostic(
                    severity="error",
                    message=f'{prefix}/text: required field "text" is missing or empty',
                    path=f"{prefix}/text",
                    comment_id=c.id,
                )
            )

        # Unique id check
        if c.id:
            if c.id in ids:
                errors.append(
                    ValidationDiagnostic(
                        severity="error",
                        message=f'Duplicate comment id "{c.id}"',
                        path=f"{prefix}/id",
                        comment_id=c.id,
                    )
                )
            ids.add(c.id)

        # end_line >= line
        if c.line is not None and c.end_line is not None and c.end_line < c.line:
            errors.append(
                ValidationDiagnostic(
                    severity="error",
                    message=f"end_line ({c.end_line}) must be ≥ line ({c.line})",
                    path=f"{prefix}/end_line",
                    comment_id=c.id,
                )
            )

        # end_column >= start_column when same line
        if (
            c.start_column is not None
            and c.end_column is not None
            and (c.line is None or c.end_line is None or c.line == c.end_line)
            and c.end_column < c.start_column
        ):
            errors.append(
                ValidationDiagnostic(
                    severity="error",
                    message=(
                        f"end_column ({c.end_column}) must be"
                        f" ≥ start_column ({c.start_column}) on the same line"
                    ),
                    path=f"{prefix}/end_column",
                    comment_id=c.id,
                )
            )

        # selected_text length
        if c.selected_text and len(c.selected_text) > 4096:
            errors.append(
                ValidationDiagnostic(
                    severity="error",
                    message=f"selected_text exceeds 4096 characters ({len(c.selected_text)})",
                    path=f"{prefix}/selected_text",
                    comment_id=c.id,
                )
            )

        # text length
        if c.text and len(c.text) > 16384:
            warnings.append(
                ValidationDiagnostic(
                    severity="warning",
                    message=f"text exceeds recommended 16384 characters ({len(c.text)})",
                    path=f"{prefix}/text",
                    comment_id=c.id,
                )
            )

        # selected_text_hash consistency
        if c.selected_text and c.selected_text_hash:
            expected = compute_hash(c.selected_text)
            if c.selected_text_hash != expected:
                warnings.append(
                    ValidationDiagnostic(
                        severity="warning",
                        message=(
                            f"selected_text_hash mismatch"
                            f" (expected {expected[:12]}…,"
                            f" got {c.selected_text_hash[:12]}…)"
                        ),
                        path=f"{prefix}/selected_text_hash",
                        comment_id=c.id,
                    )
                )

        # reply_to resolution
        if c.reply_to and c.reply_to not in ids:
            all_ids = [x.id for x in comments]
            if c.reply_to not in all_ids:
                warnings.append(
                    ValidationDiagnostic(
                        severity="warning",
                        message=(
                            f'reply_to "{c.reply_to}" does not resolve'
                            f" to any comment id in this file"
                        ),
                        path=f"{prefix}/reply_to",
                        comment_id=c.id,
                    )
                )

        # Missing selected_text warning
        if c.line is not None and not c.selected_text:
            warnings.append(
                ValidationDiagnostic(
                    severity="warning",
                    message=(
                        "Comment has line anchors but no selected_text"
                        " — anchoring will be fragile across edits"
                    ),
                    path=f"{prefix}/selected_text",
                    comment_id=c.id,
                )
            )

    valid = len(errors) == 0 and (not options.strict or len(warnings) == 0)
    return ValidationResult(valid=valid, errors=errors, warnings=warnings)


def validate_file(
    file_path: str | Path, options: ValidateOptions | None = None
) -> ValidationResult:
    """Validate from a file path — convenience wrapper."""
    try:
        doc = parse_sidecar(file_path)
        return validate(doc, options)
    except Exception as e:
        return ValidationResult(
            valid=False,
            errors=[ValidationDiagnostic(severity="error", message=f"Failed to parse: {e}")],
            warnings=[],
        )
