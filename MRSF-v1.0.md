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

## 3. File Naming and Discovery
Sidecar files MUST follow this naming pattern:

```
<document>.review.yaml
```

Example: `docs/architecture.md.review.yaml`

In this pattern, <document> is the full filename (and relative path, if applicable) of the Markdown file being annotated, without any omission. This ensures deterministic discovery by tools and agents.

MRSF may also be serialized as JSON; when JSON is used, a `.review.json` suffix MAY be used. YAML is the RECOMMENDED canonical format for human editing; JSON is equivalent for tooling and interchange.

### 3.1 Default Discovery (Co-location)
By default, the sidecar file MUST be co-located with the Markdown file it annotates. Tools discover the sidecar by appending `.review.yaml` to the document path.

### 3.2 Alternate Sidecar Location
When co-location is not desirable (e.g., read-only source trees, monorepo policies, or clean-directory requirements), a repository MAY provide a `.mrsf.yaml` configuration file at the repository or workspace root to redirect sidecar discovery.

The configuration file uses the following structure:

```yaml
sidecar_root: .reviews
```

When `sidecar_root` is present, tools MUST resolve sidecar files by joining `sidecar_root` with the document's relative path plus the `.review.yaml` suffix. For example, with `sidecar_root: .reviews`, the sidecar for `docs/architecture.md` is located at:

```
.reviews/docs/architecture.md.review.yaml
```

The `sidecar_root` path MUST be relative to the repository or workspace root. Absolute paths and paths containing `..` MUST be rejected.

### 3.3 Discovery Order
Tools MUST resolve sidecar locations using the following order:

1. Check for a `.mrsf.yaml` file at the repository or workspace root. If present and `sidecar_root` is defined, derive the sidecar path from it.
2. Otherwise, look for the sidecar co-located with the Markdown file (default).

Tools MUST NOT search both locations and merge results; exactly one location is authoritative per repository.

## 4. Top-Level Structure
A valid MRSF file MUST contain:

```yaml
mrsf_version: "1.0"
document: <path-to-markdown>
comments:
  - <comment-object>
```

`mrsf_version` identifies the format version. `document` is the relative path from the repository or workspace root to the annotated Markdown file, including the full filename. When co-located (Section 3.1), the `document` value will match the sidecar's own path with the `.review.yaml` suffix removed. When `sidecar_root` is configured (Section 3.2), the sidecar resides under the configured directory but `document` still reflects the path to the Markdown file from the repository root. `comments` is an array of comment objects; an empty array is valid and represents a document with no review comments.

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
- `commit`: Git commit hash associated with the comment; SHOULD be the full (long) SHA for durability; short SHAs are acceptable for human readability but MAY become ambiguous as repositories grow. When `commit` is absent, implementations MUST treat all positional anchors (line/column) as best-effort and rely on `selected_text` for resolution. MRSF does not track file renames or moves; if the annotated file is renamed, the `document` field and sidecar filename MUST be updated to reflect the new path. Tools MAY automate this as part of VCS rename detection.
- `type`: Comment category; RECOMMENDED values: suggestion, issue, question, accuracy, style, clarity.
- `severity`: Importance level; values: low, medium, high.
- `selected_text`: Exact text selected by the reviewer; SHOULD match the substring defined by line/column fields and is authoritative for re-anchoring; MUST NOT exceed 4096 characters to avoid oversized payloads. Reviewers SHOULD capture enough surrounding context to make the value reasonably unique within the document; very short or common fragments (e.g., a single word) are likely to match multiple locations and degrade re-anchoring reliability. For line-only comments, `selected_text` SHOULD contain the full content of the referenced line (excluding the trailing newline). For multi-line comments, it SHOULD contain the full text of the spanned lines. For column-span comments, it SHOULD contain the substring defined by the column range.
- `reply_to`: ID of another comment in the same sidecar file to which this comment is a reply; SHOULD resolve to an existing `id` to preserve thread integrity; replies MAY omit targeting fields and inherit context from the parent so short acknowledgments or meta-discussion do not need duplicate anchors.
- `selected_text_hash`: Hex-encoded SHA-256 hash of `selected_text`; allows implementations to detect text changes without comparing the full string. When present, it MUST be the lowercase hex digest of the UTF-8 encoded `selected_text` value. Implementations SHOULD verify consistency between `selected_text` and `selected_text_hash` and flag mismatches as potential data corruption.

## 7. Targeting and Anchoring
### 7.1 Targeting Fields
- `line`: Starting line number (1-based).
- `end_line`: Ending line number (inclusive); MUST be ≥ line.
- `start_column`: Starting column index (0-based); MUST be ≥ 0.
- `end_column`: Ending column index; MUST be ≥ `start_column` when `line` equals `end_line` (same-line span); when `end_line` > `line` (multi-line span), `end_column` is independent of `start_column`.

Line and column values are positional: they reflect the document state at the time the comment was created. Any insertion or deletion above the anchored location will shift these values, making them unreliable on their own across revisions. For this reason, `selected_text` SHOULD always be provided alongside targeting fields; it is content-based and survives positional shifts. When `commit` is present, implementations can compare it against the current document revision to detect that line/column values may be stale before attempting resolution.

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

### 7.4 Anchoring Resolution Procedure
When resolving the anchor for a comment, implementations SHOULD follow these steps in order:

1. **Exact text match** — If `selected_text` is present, search the document for an exact match.
   - a. **Single match found** — Anchor to it. Resolution complete.
   - b. **Multiple matches found** — If `line`/column fields are present, select the match closest to the original position. If no line/column fields are present, flag the comment as ambiguous and surface it to the reviewer. Do not guess.
   - c. **No match found** — Proceed to step 2.

2. **Line/column fallback** — If `line` (and optionally `end_line`, `start_column`, `end_column`) is present, check whether those lines still exist in the document. If `commit` is present and differs from the current document revision, implementations SHOULD treat line/column values as potentially stale and apply additional scrutiny (e.g., verifying that the content at the position is plausible).
   - a. **Lines exist and content is plausible** — Anchor to the line/column position. Mark the comment as needing re-anchoring (stale `selected_text`).
   - b. **Lines exist but content at the position is clearly unrelated** — Proceed to step 3.
   - c. **Lines no longer exist** (document shrank or section removed) — Proceed to step 3.

3. **Contextual re-anchoring** — Attempt to locate the original text using surrounding context, partial similarity, or proximity to the original line/column hints.
   - a. **Plausible match found** — Anchor tentatively. Mark as needing re-anchoring. Flag for reviewer attention.
   - b. **No plausible match** — Proceed to step 4.

4. **Orphan** — Retain the comment. Mark it as orphaned and surface it for reviewer action (resolve, retarget, or delete). Implementations MUST NOT silently discard orphaned comments.

If `selected_text` is absent, begin at step 2.

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
- Fields with the prefix `x_` are reserved for non-standard, tool-specific extensions (e.g., `x_tool_metadata`, `x_ai_confidence`). Implementations MUST NOT assign semantic meaning to `x_`-prefixed fields defined by other tools. Future versions of MRSF will not introduce normative fields with the `x_` prefix.
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
    selected_text: "The gateway component routes all inbound traffic."
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
- Review comments MAY inadvertently contain secrets (API keys, tokens, credentials). Implementations SHOULD integrate with secret-scanning mechanisms where available and SHOULD warn authors before committing comments that match known secret patterns.
- In public repositories, sidecar files are visible to all readers. Authors SHOULD avoid including confidential content in `text` or `selected_text`. Implementations MAY provide a visibility or classification field in future versions; until then, repository access controls are the primary privacy mechanism.
- Agents MUST preserve author attribution and SHOULD record provenance where available.
- Implementations SHOULD avoid path traversal when resolving document paths and SHOULD apply size limits to guard against resource exhaustion.
- Implementations SHOULD sanitize or escape `text`, `selected_text`, and any `x_`-prefixed extension values before rendering in HTML or other markup contexts to prevent injection attacks (e.g., XSS).
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