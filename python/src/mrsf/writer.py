"""MRSF Writer — serialize MrsfDocument back to YAML or JSON.

Uses ruamel.yaml for round-trip YAML preservation (comments, scalar styles,
key ordering, whitespace). Auto-computes selected_text_hash when selected_text changes.
"""

from __future__ import annotations

import hashlib
import json
import os
import tempfile
import threading
from io import StringIO
from pathlib import Path
from typing import Any

from ruamel.yaml import YAML

from .types import Comment, MrsfDocument

_yaml_rt = YAML()
_yaml_rt.preserve_quotes = True
_yaml_rt.default_flow_style = False
_yaml_rt.width = 4096
_yaml_rt.indent(mapping=2, sequence=4, offset=2)

# Per-file write serialization
_write_locks: dict[str, threading.Lock] = {}
_locks_lock = threading.Lock()

# Preferred key order for new comments
COMMENT_KEY_ORDER = [
    "id",
    "author",
    "timestamp",
    "text",
    "type",
    "severity",
    "resolved",
    "reply_to",
    "line",
    "end_line",
    "start_column",
    "end_column",
    "selected_text",
    "selected_text_hash",
    "anchored_text",
    "commit",
]


def _get_file_lock(path: str) -> threading.Lock:
    with _locks_lock:
        if path not in _write_locks:
            _write_locks[path] = threading.Lock()
        return _write_locks[path]


# ---------------------------------------------------------------------------
# Hash helpers
# ---------------------------------------------------------------------------


def compute_hash(text: str) -> str:
    """Compute SHA-256 hex hash of a string (UTF-8)."""
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def sync_hash(comment: Comment) -> Comment:
    """Ensure selected_text_hash is consistent for a comment."""
    if comment.selected_text is not None and len(comment.selected_text) > 0:
        comment.selected_text_hash = compute_hash(comment.selected_text)
    else:
        comment.selected_text_hash = None
    return comment


# ---------------------------------------------------------------------------
# Serialization
# ---------------------------------------------------------------------------


def _ordered_comment_dict(comment: Comment) -> dict[str, Any]:
    """Create a dict with keys in preferred order."""
    raw = comment.to_dict()
    ordered: dict[str, Any] = {}
    for key in COMMENT_KEY_ORDER:
        if key in raw:
            ordered[key] = raw.pop(key)
    # Remaining extension fields
    ordered.update(raw)
    return ordered


def to_yaml(doc: MrsfDocument) -> str:
    """Serialize an MrsfDocument to YAML."""
    data: dict[str, Any] = {
        "mrsf_version": doc.mrsf_version,
        "document": doc.document,
        "comments": [_ordered_comment_dict(c) for c in doc.comments],
    }
    data.update(doc.extra)
    stream = StringIO()
    yaml_out = YAML()
    yaml_out.default_flow_style = False
    yaml_out.width = 4096
    yaml_out.indent(mapping=2, sequence=4, offset=2)
    yaml_out.dump(data, stream)
    return stream.getvalue()


def to_json(doc: MrsfDocument) -> str:
    """Serialize an MrsfDocument to JSON."""
    return json.dumps(doc.to_dict(), indent=2, ensure_ascii=False) + "\n"


# ---------------------------------------------------------------------------
# Atomic file write
# ---------------------------------------------------------------------------


def _atomic_write_file(file_path: str, content: str) -> None:
    """Atomically write content via temp + rename."""
    dir_name = os.path.dirname(file_path)
    fd, tmp_path = tempfile.mkstemp(dir=dir_name, suffix=".tmp")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            f.write(content)
        os.replace(tmp_path, file_path)
    except Exception:
        try:
            os.unlink(tmp_path)
        except OSError:
            pass
        raise


# ---------------------------------------------------------------------------
# Round-trip write
# ---------------------------------------------------------------------------


def write_sidecar(file_path: str | Path, doc: MrsfDocument) -> None:
    """Write an MrsfDocument to disk with round-trip YAML preservation."""
    abs_path = str(Path(file_path).resolve())
    lock = _get_file_lock(abs_path)
    with lock:
        _write_sidecar_internal(abs_path, doc)


def _write_sidecar_internal(abs_path: str, doc: MrsfDocument) -> None:
    is_json = abs_path.endswith(".review.json")

    if is_json:
        for comment in doc.comments:
            sync_hash(comment)
        _atomic_write_file(abs_path, to_json(doc))
        return

    # YAML round-trip path
    if not os.path.exists(abs_path):
        for comment in doc.comments:
            sync_hash(comment)
        _atomic_write_file(abs_path, to_yaml(doc))
        return

    try:
        raw = Path(abs_path).read_text(encoding="utf-8")
    except OSError:
        for comment in doc.comments:
            sync_hash(comment)
        _atomic_write_file(abs_path, to_yaml(doc))
        return

    # Parse existing YAML for round-trip (fresh instance preserves file-specific formatting)
    yaml_rt = YAML()
    yaml_rt.preserve_quotes = True
    yaml_rt.default_flow_style = False
    yaml_rt.width = 4096
    yaml_rt.indent(mapping=2, sequence=4, offset=2)
    try:
        existing = yaml_rt.load(raw)
    except Exception:
        for comment in doc.comments:
            sync_hash(comment)
        _atomic_write_file(abs_path, to_yaml(doc))
        return

    if not isinstance(existing, dict) or not isinstance(existing.get("comments"), list):
        for comment in doc.comments:
            sync_hash(comment)
        _atomic_write_file(abs_path, to_yaml(doc))
        return

    # Build lookup of current parsed values by comment id
    current_by_id: dict[str, dict[str, Any]] = {}
    for c in existing.get("comments", []):
        if isinstance(c, dict) and "id" in c:
            current_by_id[str(c["id"])] = dict(c)

    # Sync hashes intelligently
    for comment in doc.comments:
        cur = current_by_id.get(comment.id)
        if cur is None:
            sync_hash(comment)
        else:
            text_changed = cur.get("selected_text") != comment.selected_text
            had_hash = cur.get("selected_text_hash") is not None
            if text_changed or had_hash:
                sync_hash(comment)
            else:
                comment.selected_text_hash = None

    # Update top-level fields
    existing["mrsf_version"] = doc.mrsf_version
    existing["document"] = doc.document

    # Index existing comments by id for round-trip merge
    existing_comment_map: dict[str, dict[str, Any]] = {}
    for c in existing["comments"]:
        if isinstance(c, dict) and "id" in c:
            existing_comment_map[str(c["id"])] = c

    # Build new comments list preserving existing CommentedMap objects.
    # Mutate the existing CommentedSeq in-place to preserve indentation metadata.
    existing_seq = existing["comments"]
    new_items = []
    for comment in doc.comments:
        new_data = _ordered_comment_dict(comment)
        ec = existing_comment_map.get(comment.id)
        if ec is not None:
            # Round-trip: update existing dict in-place to preserve formatting
            keys_to_remove = [k for k in ec if k not in new_data]
            for k in keys_to_remove:
                del ec[k]
            for k, v in new_data.items():
                ec[k] = v
            new_items.append(ec)
        else:
            new_items.append(new_data)

    # Replace contents of existing CommentedSeq in-place
    del existing_seq[:]
    for item in new_items:
        existing_seq.append(item)

    # Write back
    stream = StringIO()
    yaml_rt.dump(existing, stream)
    _atomic_write_file(abs_path, stream.getvalue())
