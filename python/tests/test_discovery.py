"""Tests for the discovery module — 1:1 match with discovery.test.ts."""

import os
import re

from mrsf.discovery import sidecar_to_document


# ---------------------------------------------------------------------------
# sidecarToDocument
# ---------------------------------------------------------------------------


class TestSidecarToDocument:
    def test_strips_review_yaml_suffix(self):
        result = sidecar_to_document("doc.md.review.yaml")
        assert result.endswith("doc.md")

    def test_strips_review_json_suffix(self):
        result = sidecar_to_document("doc.md.review.json")
        assert result.endswith("doc.md")

    def test_handles_nested_paths(self):
        result = sidecar_to_document("docs/guide/setup.md.review.yaml")
        assert re.search(r"docs[/\\]guide[/\\]setup\.md$", result)
