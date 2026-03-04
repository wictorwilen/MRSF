"""Bundled JSON schemas for MRSF validation."""

from pathlib import Path

SCHEMA_DIR = Path(__file__).parent

MRSF_SCHEMA_PATH = SCHEMA_DIR / "mrsf.schema.json"
MRSF_CONFIG_SCHEMA_PATH = SCHEMA_DIR / "mrsf-config.schema.json"
