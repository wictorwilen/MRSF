"""MRSF Discovery — resolve sidecar file paths per §3.3.

Discovery order:
 1. Check for .mrsf.yaml at repo/workspace root → use sidecar_root if defined.
 2. Otherwise, co-located sidecar next to the Markdown file.
"""

from __future__ import annotations

import os
from pathlib import Path

from ruamel.yaml import YAML

from .types import MrsfConfig

_yaml = YAML()

CONFIG_FILENAME = ".mrsf.yaml"
SIDECAR_SUFFIX = ".review.yaml"
SIDECAR_SUFFIX_JSON = ".review.json"


def find_workspace_root(start_dir: str | Path) -> str:
    """Find workspace/repo root by walking up looking for .mrsf.yaml or .git."""
    d = Path(start_dir).resolve()
    while True:
        if (d / CONFIG_FILENAME).exists() or (d / ".git").exists():
            return str(d)
        parent = d.parent
        if parent == d:
            break
        d = parent
    return str(Path(start_dir).resolve())


def load_config(workspace_root: str, config_path: str | None = None) -> MrsfConfig | None:
    """Load and validate .mrsf.yaml config. Returns None if not found."""
    if config_path:
        cfg_path = Path(config_path).resolve()
    else:
        cfg_path = Path(workspace_root) / CONFIG_FILENAME

    if not cfg_path.exists():
        return None

    raw = cfg_path.read_text(encoding="utf-8")
    parsed = _yaml.load(raw)

    if not isinstance(parsed, dict):
        return None

    config = MrsfConfig()

    sr = parsed.get("sidecar_root")
    if isinstance(sr, str):
        if os.path.isabs(sr):
            raise ValueError(f'.mrsf.yaml: sidecar_root must be a relative path (got "{sr}")')
        if ".." in sr:
            raise ValueError(f'.mrsf.yaml: sidecar_root must not contain ".." (got "{sr}")')
        config.sidecar_root = sr

    return config


def discover_sidecar(
    document_path: str | Path,
    *,
    cwd: str | None = None,
    config_path: str | None = None,
) -> str:
    """Discover sidecar file path for a document. Returns absolute path."""
    effective_cwd = cwd or os.getcwd()
    workspace_root = find_workspace_root(effective_cwd)
    config = load_config(workspace_root, config_path)

    doc_path = Path(document_path)
    if doc_path.is_absolute():
        rel_doc = str(doc_path.relative_to(workspace_root))
    else:
        rel_doc = str(document_path)

    if config and config.sidecar_root:
        return str(Path(workspace_root) / config.sidecar_root / (rel_doc + SIDECAR_SUFFIX))

    return str(Path(workspace_root) / (rel_doc + SIDECAR_SUFFIX))


def sidecar_to_document(sidecar_path: str | Path) -> str:
    """Given a sidecar path, resolve the Markdown document path."""
    abs_path = str(Path(sidecar_path).resolve())

    if abs_path.endswith(SIDECAR_SUFFIX):
        return abs_path[: -len(SIDECAR_SUFFIX)]
    elif abs_path.endswith(SIDECAR_SUFFIX_JSON):
        return abs_path[: -len(SIDECAR_SUFFIX_JSON)]

    return abs_path


def discover_all_sidecars(dir_path: str | Path) -> list[str]:
    """Discover all sidecar files in a directory (recursive)."""
    p = Path(dir_path).resolve()

    if p.is_file():
        return [str(p)]

    results: list[str] = []

    def walk(d: Path) -> None:
        try:
            entries = sorted(d.iterdir())
        except PermissionError:
            return
        for entry in entries:
            if entry.is_dir():
                if entry.name in ("node_modules", ".git", "__pycache__", ".venv"):
                    continue
                walk(entry)
            elif entry.name.endswith(SIDECAR_SUFFIX) or entry.name.endswith(SIDECAR_SUFFIX_JSON):
                results.append(str(entry))

    walk(p)
    return results
