# Contributing to MRSF

Thanks for helping improve the Markdown Review Sidecar Format (MRSF). This document describes how to propose changes, file issues, and keep the spec and schema in sync.

## How to Contribute
- **Issues:** Use GitHub issues for bugs, clarifications, and proposals. Include context, examples, and expected behavior.
- **Pull Requests:** Keep PRs focused. Link to related issues. Describe the change, rationale, and any interoperability impact.
- **Draft Status:** The spec is a draft; small normative adjustments are expected. Breaking changes should be rare and well-justified.

## Style and Editorial Guidelines
- Use RFC 2119/8174 key words (MUST, SHOULD, MAY) consistently for normative requirements.
- Keep YAML as the primary example format; JSON examples should remain equivalent. Use spaces, not tabs, in examples.
- When adding or changing fields, update **both** the narrative spec and `mrsf.schema.json`, and include an example.
- Prefer concise, testable requirements. Note interoperability or migration guidance when changing behavior.

## Validation
- Validate examples against `mrsf.schema.json` (e.g., with a JSON Schema validator). Keep examples schema-compliant.
- Check that line/column and `selected_text` anchors are consistent in examples.

## Versioning
- `mrsf_version` denotes the format version. Bump the minor version for backward-compatible additions; bump major only for breaking changes.
- Document notable changes in the spec’s text; consider adding a brief changelog entry in PR descriptions.

## Security and Privacy
- Avoid adding examples with sensitive data. Call out privacy/security considerations when introducing new fields.

## Communication
- Propose substantive changes in an issue before opening a large PR.
- Be explicit about intended compatibility (backward/forward) and migration expectations.