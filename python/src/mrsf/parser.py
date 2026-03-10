"""MRSF Parser — load and parse MRSF sidecar files (YAML or JSON)."""

from __future__ import annotations

import json
import re
from datetime import date, datetime
from dataclasses import dataclass
from pathlib import Path

from ruamel.yaml import YAML

from .types import Comment, MrsfDocument

_yaml = YAML()
_yaml.preserve_quotes = True


def _datetime_to_iso(dt: datetime) -> str:
    """Convert a datetime to an RFC 3339 string, trimming unnecessary microsecond zeros."""
    s = dt.isoformat()
    # Trim trailing zeros from fractional seconds: .197000 → .197
    if "." in s:
        head, frac_and_tz = s.split(".", 1)
        # frac_and_tz is like "197000+00:00" or "197000"
        frac = ""
        tz = ""
        for i, ch in enumerate(frac_and_tz):
            if ch in ("+", "-") or frac_and_tz[i:] == "Z":
                frac = frac_and_tz[:i]
                tz = frac_and_tz[i:]
                break
        else:
            frac = frac_and_tz
        frac = frac.rstrip("0") or "0"
        s = f"{head}.{frac}{tz}"
    return s.replace("+00:00", "Z")


def _normalize_timestamps(obj: object) -> None:
    """Convert any datetime/date values in a parsed YAML structure to ISO strings.

    ruamel.yaml auto-converts unquoted ISO timestamps to datetime objects;
    this walks the tree and converts them back so downstream code always
    sees plain strings.
    """
    if isinstance(obj, dict):
        for k in obj:
            v = obj[k]
            if isinstance(v, datetime):
                obj[k] = _datetime_to_iso(v)
            elif isinstance(v, date):
                obj[k] = v.isoformat()
            elif isinstance(v, (dict, list)):
                _normalize_timestamps(v)
    elif isinstance(obj, list):
        for i, v in enumerate(obj):
            if isinstance(v, datetime):
                obj[i] = _datetime_to_iso(v)
            elif isinstance(v, date):
                obj[i] = v.isoformat()
            elif isinstance(v, (dict, list)):
                _normalize_timestamps(v)


# ---------------------------------------------------------------------------
# Lenient parse result
# ---------------------------------------------------------------------------


@dataclass
class LenientParseResult:
    """Result from a lenient (non-throwing) parse attempt."""

    doc: MrsfDocument | None = None
    error: str | None = None
    partial_comments: list[Comment] | None = None


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------


def parse_sidecar(file_path: str | Path) -> MrsfDocument:
    """Parse an MRSF sidecar file from disk."""
    abs_path = Path(file_path).resolve()
    content = abs_path.read_text(encoding="utf-8")
    return parse_sidecar_content(content, str(abs_path))


def parse_sidecar_content(content: str, filename_hint: str | None = None) -> MrsfDocument:
    """Parse MRSF sidecar content from a string."""
    trimmed = content.strip()
    leading_trimmed = content.lstrip()

    is_json = leading_trimmed.startswith("{") or (
        filename_hint is not None and filename_hint.endswith(".review.json")
    )

    if is_json:
        try:
            parsed = json.loads(leading_trimmed)
        except json.JSONDecodeError as e:
            raise ValueError(f"Failed to parse JSON: {e}") from e
    else:
        try:
            parsed = _yaml.load(content)
        except Exception as e:
            raise ValueError(f"Failed to parse YAML: {e}") from e

    if not isinstance(parsed, dict):
        raise ValueError("MRSF sidecar must be a YAML/JSON object")

    _normalize_timestamps(parsed)
    return MrsfDocument.from_dict(parsed)


def parse_sidecar_lenient(file_path: str | Path) -> LenientParseResult:
    """Lenient parse: attempts to parse without raising."""
    abs_path = Path(file_path).resolve()
    try:
        content = abs_path.read_text(encoding="utf-8")
    except OSError as e:
        return LenientParseResult(doc=None, error=f"Cannot read file: {e}")

    return parse_sidecar_content_lenient(content, str(abs_path))


def parse_sidecar_content_lenient(
    content: str, filename_hint: str | None = None
) -> LenientParseResult:
    """Lenient parse from string content."""
    trimmed = content.strip()
    leading_trimmed = content.lstrip()
    if not trimmed:
        return LenientParseResult(doc=None, error="File is empty")

    is_json = leading_trimmed.startswith("{") or (
        filename_hint is not None and filename_hint.endswith(".review.json")
    )

    # Try normal parse
    parsed = None
    try:
        if is_json:
            parsed = json.loads(leading_trimmed)
        else:
            parsed = _yaml.load(content)
    except Exception as e:
        if not is_json:
            return _salvage_yaml(content)
        return LenientParseResult(doc=None, error=f"Failed to parse JSON: {e}")

    if not isinstance(parsed, dict):
        return LenientParseResult(doc=None, error="MRSF sidecar must be a YAML/JSON object")

    _normalize_timestamps(parsed)

    doc = MrsfDocument(
        mrsf_version=str(parsed.get("mrsf_version", "1.0")),
        document=str(parsed.get("document", "unknown")),
        comments=[],
    )

    comments_raw = parsed.get("comments")
    if not isinstance(comments_raw, list):
        return LenientParseResult(
            doc=doc,
            error="comments field is not an array — file may be corrupted",
        )

    good: list[Comment] = []
    bad: list[int] = []

    for i, c in enumerate(comments_raw):
        if isinstance(c, dict) and isinstance(c.get("id"), str):
            good.append(Comment.from_dict(c))
        else:
            bad.append(i)

    doc.comments = good

    if bad:
        return LenientParseResult(
            doc=doc,
            error=(
                f"{len(bad)} comment(s) at indices "
                f"[{', '.join(str(b) for b in bad)}] were malformed and skipped"
            ),
            partial_comments=good,
        )

    return LenientParseResult(doc=doc)


def read_document_lines(file_path: str | Path) -> list[str]:
    """Read a Markdown document and return 1-indexed lines (index 0 is empty)."""
    content = Path(file_path).resolve().read_text(encoding="utf-8")
    lines = content.split("\n")
    return ["", *lines]


# ---------------------------------------------------------------------------
# Private helpers
# ---------------------------------------------------------------------------


def _salvage_yaml(content: str) -> LenientParseResult:
    """Attempt to extract comment blocks from corrupted YAML."""
    salvaged: list[Comment] = []
    mrsf_version = "1.0"
    document = "unknown"

    version_match = re.search(r'^mrsf_version:\s*["\']?([^"\'\n]+)', content, re.MULTILINE)
    if version_match:
        mrsf_version = version_match.group(1).strip()

    doc_match = re.search(r'^document:\s*["\']?([^"\'\n]+)', content, re.MULTILINE)
    if doc_match:
        document = doc_match.group(1).strip()

    blocks = re.split(r"(?=^  - id:\s)", content, flags=re.MULTILINE)

    for block in blocks:
        trimmed = block.strip()
        if not trimmed.startswith("- id:"):
            continue

        try:
            parsed = _yaml.load(trimmed)
            _normalize_timestamps(parsed)
            if isinstance(parsed, list) and len(parsed) > 0:
                c = parsed[0]
                if isinstance(c, dict) and isinstance(c.get("id"), str):
                    salvaged.append(Comment.from_dict(c))
            elif isinstance(parsed, dict) and isinstance(parsed.get("id"), str):
                salvaged.append(Comment.from_dict(parsed))
        except Exception:
            pass

    doc = MrsfDocument(
        mrsf_version=mrsf_version,
        document=document,
        comments=salvaged,
    )

    return LenientParseResult(
        doc=doc if salvaged else None,
        error=f"YAML parse failed. Salvaged {len(salvaged)} comment(s) from raw content.",
        partial_comments=salvaged if salvaged else None,
    )
