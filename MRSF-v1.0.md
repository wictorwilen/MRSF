# Markdown Review Sidecar Format (MRSF) v1.0 (Draft)

## Abstract
The Markdown Review Sidecar Format (MRSF) defines a structured, portable, and machine-actionable way to store review comments externally to Markdown documents. It keeps Markdown sources free of annotations while enabling durable review history, precise anchoring, and collaboration among humans, automated tooling, and AI agents.

## Status of This Memo
This document is a draft and work in progress. It is published for community review and comment. Feedback and proposed changes are welcome via issues and pull requests.

## 1. Introduction
MRSF specifies how to persist review comments for Markdown documents in a sidecar file. The format aims to be:
- Minimally invasive to source Markdown
- Deterministic for tooling and agents
- Human-readable and hand-editable
- Stable across document revisions through multiple anchoring strategies

## 2. Conventions and Terminology
The key words MUST, MUST NOT, REQUIRED, SHOULD, SHOULD NOT, MAY are to be interpreted as described in RFC 2119 and RFC 8174 when appearing in uppercase. YAML examples follow YAML 1.2; JSON examples follow RFC 8259. Lines are 1-based; columns are 0-based. `selected_text` refers to the exact substring captured by a reviewer. `mrsf_version` denotes the MRSF format version, distinct from the target document’s own revision.

## 3. File Naming
Sidecar files MUST follow this naming pattern:

```
<document>.review.yaml
```

Example: `docs/architecture.md.review.yaml`

In this pattern, <document> is the full filename (and relative path, if applicable) of the Markdown file being annotated, without any omission. This ensures deterministic discovery by tools and agents.

MRSF may also be serialized as JSON; when JSON is used, a `.review.json` suffix MAY be used. YAML is the RECOMMENDED canonical format for human editing; JSON is equivalent for tooling and interchange.

## 4. Top-Level Structure
A valid MRSF file MUST contain:

```yaml
mrsf_version: "1.0"
document: <path-to-markdown>
comments:
  - <comment-object>
```

`mrsf_version` identifies the format version. `document` is the relative path from the repository or workspace root to the annotated Markdown file, including the full filename. Because the sidecar file MUST be co-located with the Markdown file (Section 3), the `document` value will match the sidecar's own path with the `.review.yaml` suffix removed. `comments` is an array of comment objects; an empty array is valid and represents a document with no review comments.

## 5. Versioning
- `mrsf_version` MUST be present and MUST be set to the supported major.minor format version ("1.0" for this specification).
- Tools MUST reject unknown major versions and MAY accept newer minor versions according to their compatibility policy.
- `document`-level revision tracking is out of scope; authors MAY store that in a separate field within `comment` text or future extensions.

## 6. Comment Object Specification
### 6.1 Required Fields
- `id`: Globally unique, opaque identifier; MUST be a string; SHOULD be collision-resistant (e.g., UUIDv4 or ULID); MUST remain stable across revisions.
- `author`: Creator of the comment; free-form string; SHOULD follow the convention `Display Name (identifier)` (e.g., `Wictor (wictorwilen)`) to provide both a human-readable name and a stable, machine-comparable identifier.
- `timestamp`: ISO 8601 / RFC 3339 timestamp of comment creation; MUST include timezone offset (e.g., Z or +00:00).
- `text`: Comment content; MUST be plain text; SHOULD NOT exceed 16384 characters; implementations MAY impose lower limits.
- `resolved`: Boolean indicating whether the comment has been addressed (`false` = open, `true` = resolved).

### 6.2 Optional Fields
- `commit`: Git commit hash associated with the comment; SHOULD be the full (long) SHA for durability; short SHAs are acceptable for human readability but MAY become ambiguous as repositories grow.
- `type`: Comment category; RECOMMENDED values: suggestion, issue, question, accuracy, style, clarity.
- `severity`: Importance level; values: low, medium, high.
- `selected_text`: Exact text selected by the reviewer; SHOULD match the substring defined by line/column fields and is authoritative for re-anchoring; MUST NOT exceed 4096 characters to avoid oversized payloads. Reviewers SHOULD capture enough surrounding context to make the value reasonably unique within the document; very short or common fragments (e.g., a single word) are likely to match multiple locations and degrade re-anchoring reliability.
- `reply_to`: ID of another comment in the same sidecar file to which this comment is a reply; SHOULD resolve to an existing `id` to preserve thread integrity; replies MAY omit targeting fields and inherit context from the parent so short acknowledgments or meta-discussion do not need duplicate anchors.

## 7. Targeting and Anchoring
### 7.1 Targeting Fields
- `line`: Starting line number (1-based).
- `end_line`: Ending line number (inclusive); MUST be ≥ line.
- `start_column`: Starting column index (0-based); MUST be ≥ 0.
- `end_column`: Ending column index; MUST be ≥ `start_column` when `line` equals `end_line` (same-line span); when `end_line` > `line` (multi-line span), `end_column` is independent of `start_column`.

### 7.2 Targeting Rules
- `line` alone → single-line comment.
- `line` + `end_line` → multi-line comment.
- `line` + `start_column` + `end_column` → inline span.
- `selected_text` SHOULD be used as the primary anchor when it still matches; if it no longer matches due to edits, agents SHOULD fall back to line/column anchors and mark the comment as needing re-anchoring.
- When `selected_text` matches multiple locations in the document, agents MUST use line/column fields to disambiguate; if no line/column fields are present, agents SHOULD flag the comment as ambiguous rather than guessing.

### 7.3 Re-anchoring Guidance
- Agents SHOULD re-anchor using `selected_text` when text moves but remains identical. When multiple identical matches exist, agents SHOULD prefer the match closest to the original line/column position.
- If `selected_text` conflicts with line/column, `selected_text` SHOULD take precedence; agents SHOULD attempt reconciliation before failing.
- If anchors cannot be reconciled, agents SHOULD mark the comment as needing attention rather than silently discarding it.
- If `selected_text` no longer matches due to author edits, agents SHOULD attempt re-anchoring using surrounding context and line/column hints, then flag the comment for reviewer attention if still unresolved.
- If the referenced text and lines have been removed and cannot be re-anchored, agents SHOULD retain the comment, mark it as orphaned, and surface it for reviewer action (e.g., resolve or retarget) rather than deleting it.

## 8. AI Agent Behavior
AI agents interacting with MRSF SHOULD:
- Use `selected_text` as the primary anchor and line/column as secondary.
- Re-anchor after edits and detect when referenced text changes or disappears.
- Mark comments resolved when referenced text is removed intentionally and the issue is addressed; when removal is ambiguous or unintentional, leave the comment open and mark it as orphaned for reviewer decision.
- Maintain stable id values.

## 9. Lifecycle
The minimal lifecycle is represented by `resolved`:
- `resolved`: `false` → open
- `resolved`: `true` → resolved

Tools MAY implement richer states (open, in-progress, addressed, closed) but MUST map them to resolved for interoperability.

Resolving a parent comment MUST NOT automatically resolve its replies; each comment's `resolved` field is independent. A reply MAY raise a distinct concern that outlives the parent thread.

## 10. Conformance and Error Handling
- Files MUST include `mrsf_version`, `document`, and `comments` (array).
- Parsers MUST treat unknown fields as ignorable extensions.
- Parsers SHOULD reject documents missing required fields or with invalid types.
- Parsers SHOULD validate cross-field constraints (e.g., `end_line` ≥ `line`; `end_column` ≥ `start_column` when applicable).
- Parsers SHOULD reject `selected_text` values longer than 4096 characters.
- Parsers SHOULD flag `reply_to` values that do not resolve to another `id` in the same file; implementations MAY keep the comment but SHOULD mark it orphaned.
- Implementations SHOULD treat this draft specification as experimental and expect minor changes before stabilization.

### 10.1 Implementation Guidance (Non-Normative)
- Preserve input order of `comments` when emitting files to aid human review diffs; tools MAY sort for deterministic output but SHOULD not reorder within a single thread.
- When `reply_to` is present and targeting fields are omitted, consumers SHOULD inherit anchor context from the parent comment for display and navigation.
- Emit warnings (not hard failures) for unresolved `reply_to`, orphaned anchors, or stale `selected_text`, and surface them to reviewers for decision.
- Prefer YAML for human-facing workflows and JSON for APIs; avoid lossy transformations between them.
- Tools MAY offer cascading resolution (resolving a parent resolves all its replies) as a user-facing convenience, but SHOULD allow individual replies to remain open when they represent independent concerns.

## 11. Examples
Unless stated otherwise, examples use YAML. Section 11.3 shows the equivalent JSON serialization.

### 11.1 Minimal YAML Example
```yaml
mrsf_version: "1.0"
document: docs/architecture.md
comments:
  - id: 1d3c72b0
    author: Wictor (wictorwilen)
    timestamp: '2026-03-02T18:22:59.713284+00:00'
    text: "This section needs clarification."
    resolved: false
    line: 9
    commit: 02eb613
```
### 11.2 Advanced YAML Example (Precise Text Span)
```yaml
mrsf_version: "1.0"
document: docs/architecture.md
comments:
  - id: 3eeccbd3
    author: Wictor (wictorwilen)
    timestamp: '2026-03-02T18:24:51.742976+00:00'
    text: "Is this phrasing correct?"
    type: question
    resolved: false
    commit: 02eb613
    line: 12
    end_line: 12
    start_column: 42
    end_column: 73
    selected_text: "While many concepts are represented"
```
### 11.3 JSON Example (Equivalent to 11.2)
```json
{
  "mrsf_version": "1.0",
  "document": "docs/architecture.md",
  "comments": [
    {
      "id": "3eeccbd3",
      "author": "Wictor (wictorwilen)",
      "timestamp": "2026-03-02T18:24:51.742976+00:00",
      "text": "Is this phrasing correct?",
      "type": "question",
      "resolved": false,
      "commit": "02eb613",
      "line": 12,
      "end_line": 12,
      "start_column": 42,
      "end_column": 73,
      "selected_text": "While many concepts are represented"
    }
  ]
}
```

### 11.4 YAML Example (Threaded Reply)
```yaml
mrsf_version: "1.0"
document: docs/architecture.md
comments:
  - id: 1d3c72b0
    author: Wictor (wictorwilen)
    timestamp: '2026-03-02T18:22:59.713284+00:00'
    text: "Initial comment."
    resolved: false
    line: 9
    commit: 02eb613
  - id: badf5462
    author: Wictor (wictorwilen)
    timestamp: '2026-03-02T19:44:24.558426+00:00'
    text: "Follow-up reply."
    resolved: false
    reply_to: 1d3c72b0
    commit: 02eb613
```

## 12. Backward Compatibility
- Comments without targeting fields remain valid.
- Comments with only line remain valid.
- Tools MUST ignore unknown fields.
- Future versions MAY introduce a target object grouping targeting fields.

## 13. Security and Privacy Considerations
- Comments may contain sensitive or proprietary information; tools MUST NOT expose comments publicly without explicit permission.
- Agents MUST preserve author attribution and SHOULD record provenance where available.
- Implementations SHOULD avoid path traversal when resolving document paths and SHOULD apply size limits to guard against resource exhaustion.
- Implementations SHOULD sanitize or escape `text` and `selected_text` before rendering in HTML or other markup contexts to prevent injection attacks (e.g., XSS).
- MRSF does not provide an authentication mechanism for authors; `author` values are self-asserted. Implementations MAY use `commit` hashes and version control history as a provenance signal but SHOULD NOT treat them as proof of identity.

## 14. IANA Considerations
This draft does not request IANA action at this time. It proposes the following media type for future registration when the specification stabilizes:
- Name: `application/mrsf+json` (primary) and `application/mrsf+yaml` (optional)
- Encoding: UTF-8

## 15. Future Extensions (Non-Normative)
Potential additions for future versions:
- `target`: object replacing flat targeting fields for structured anchoring.
- `proposed`: block for suggested replacement text or fixes.
- `context_before` / `context_after`: surrounding text for diff-resilient anchoring.
- `selected_text_hash`: integrity hash of the selected text for change detection.
- Multi-agent provenance metadata for attribution across automated pipelines.

## 16. References
### 16.1 Normative References
- RFC 2119: Key words for use in RFCs to Indicate Requirement Levels — https://www.rfc-editor.org/rfc/rfc2119
- RFC 8174: Ambiguity of Uppercase vs Lowercase in RFC 2119 Key Words — https://www.rfc-editor.org/rfc/rfc8174
- RFC 8259: The JavaScript Object Notation (JSON) Data Interchange Format — https://www.rfc-editor.org/rfc/rfc8259
- RFC 3339: Date and Time on the Internet: Timestamps — https://www.rfc-editor.org/rfc/rfc3339
- YAML 1.2 Specification — https://yaml.org/spec/1.2.2/

### 16.2 Informative References
- RFC 7764: Guidance on Markdown: Design Philosophies, Stability, and Interoperability — https://www.rfc-editor.org/rfc/rfc7764
- ISO 8601: Date and time — Representations for information interchange

## Acknowledgments
This specification was developed with community input. Contributions, feedback, and implementation experience are welcome via the project repository.