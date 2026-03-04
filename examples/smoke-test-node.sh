#!/usr/bin/env bash
# Run validate and reanchor --dry-run on all example sidecars using the Node.js CLI.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
EXAMPLES_DIR="$SCRIPT_DIR"

echo "=== Node.js CLI: examples smoke test ==="
echo

# Validate all sidecars
echo "── validate ──"
npx @mrsf/cli validate "$EXAMPLES_DIR"/*.review.yaml
echo

# Reanchor (dry-run) all sidecars
echo "── reanchor --dry-run ──"
npx @mrsf/cli reanchor --dry-run "$EXAMPLES_DIR"/*.review.yaml
echo

echo "✓ Node.js smoke test complete"
