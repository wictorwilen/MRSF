#!/usr/bin/env bash
# Run validate and reanchor --dry-run on all example sidecars using the Python CLI.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
EXAMPLES_DIR="$SCRIPT_DIR"

echo "=== Python CLI: examples smoke test ==="
echo

# Validate all sidecars
echo "── validate ──"
mrsf validate "$EXAMPLES_DIR"/*.review.yaml
echo

# Reanchor (dry-run) all sidecars
echo "── reanchor --dry-run ──"
mrsf reanchor --dry-run "$EXAMPLES_DIR"/*.review.yaml
echo

echo "✓ Python smoke test complete"
