"""Shared helper for resolving CLI file arguments."""

from __future__ import annotations

from pathlib import Path

from .discovery import discover_all_sidecars, discover_sidecar, find_workspace_root

SIDECAR_EXTENSIONS = (".review.yaml", ".review.json")


def _is_sidecar_path(file: str) -> bool:
    return any(file.endswith(ext) for ext in SIDECAR_EXTENSIONS)


def resolve_sidecar_paths(files: list[str], cwd: str) -> list[str]:
    """Resolve a list of CLI file arguments to sidecar paths."""
    if not files:
        root = find_workspace_root(cwd)
        return discover_all_sidecars(root or cwd)

    resolved: list[str] = []
    for f in files:
        abs_path = str(Path(cwd, f).resolve())
        if _is_sidecar_path(abs_path):
            resolved.append(abs_path)
        else:
            sidecar = discover_sidecar(abs_path, cwd=cwd)
            resolved.append(sidecar)
    return resolved
