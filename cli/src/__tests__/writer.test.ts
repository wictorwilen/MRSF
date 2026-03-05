/**
 * Tests for the MRSF Writer — round-trip, serialisation, and hash logic.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { writeFile, readFile, mkdir, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import {
  computeHash,
  syncHash,
  toYaml,
  toJson,
  writeSidecar,
} from "../lib/writer.js";
import type { Comment, MrsfDocument } from "../lib/types.js";

/* ── Helpers ─────────────────────────────────────────────────────── */

function makeDoc(comments: Comment[] = []): MrsfDocument {
  return {
    mrsf_version: "1.0",
    document: "test.md",
    comments,
  };
}

function makeComment(overrides: Partial<Comment> = {}): Comment {
  return {
    id: "c-001",
    author: "Alice",
    timestamp: "2026-01-01T00:00:00Z",
    text: "Fix this",
    resolved: false,
    ...overrides,
  };
}

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await import("node:fs/promises").then((fs) =>
    fs.mkdtemp(path.join(os.tmpdir(), "mrsf-writer-")),
  );
});

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

/* ================================================================ */
/*  computeHash                                                      */
/* ================================================================ */

describe("computeHash", () => {
  it("returns a 64-char hex SHA-256", () => {
    const h = computeHash("hello");
    expect(h).toHaveLength(64);
    expect(h).toMatch(/^[a-f0-9]{64}$/);
  });

  it("is deterministic", () => {
    expect(computeHash("test")).toBe(computeHash("test"));
  });

  it("differs for different inputs", () => {
    expect(computeHash("a")).not.toBe(computeHash("b"));
  });
});

/* ================================================================ */
/*  syncHash                                                         */
/* ================================================================ */

describe("syncHash", () => {
  it("sets hash when selected_text is present", () => {
    const c = makeComment({ selected_text: "hello" });
    syncHash(c);
    expect(c.selected_text_hash).toBe(computeHash("hello"));
  });

  it("removes hash when selected_text is absent", () => {
    const c = makeComment({ selected_text_hash: "stale" });
    syncHash(c);
    expect(c.selected_text_hash).toBeUndefined();
  });

  it("removes hash when selected_text is empty string", () => {
    const c = makeComment({ selected_text: "", selected_text_hash: "stale" });
    syncHash(c);
    expect(c.selected_text_hash).toBeUndefined();
  });

  it("returns the same comment object (mutates in place)", () => {
    const c = makeComment({ selected_text: "x" });
    const ret = syncHash(c);
    expect(ret).toBe(c);
  });
});

/* ================================================================ */
/*  toYaml                                                           */
/* ================================================================ */

describe("toYaml", () => {
  it("produces parseable YAML with correct fields", () => {
    const doc = makeDoc([makeComment()]);
    const yaml = toYaml(doc);
    expect(yaml).toContain("mrsf_version:");
    expect(yaml).toContain("document: test.md");
    expect(yaml).toContain("comments:");
    expect(yaml).toContain("id: c-001");
    expect(yaml).toContain("author: Alice");
  });

  it("serialises an empty comments array", () => {
    const doc = makeDoc();
    const yaml = toYaml(doc);
    expect(yaml).toContain("comments: []");
  });
});

/* ================================================================ */
/*  toJson                                                           */
/* ================================================================ */

describe("toJson", () => {
  it("produces valid JSON", () => {
    const doc = makeDoc([makeComment()]);
    const json = toJson(doc);
    const parsed = JSON.parse(json);
    expect(parsed.mrsf_version).toBe("1.0");
    expect(parsed.comments).toHaveLength(1);
    expect(parsed.comments[0].id).toBe("c-001");
  });

  it("ends with a trailing newline", () => {
    const json = toJson(makeDoc());
    expect(json.endsWith("\n")).toBe(true);
  });
});

/* ================================================================ */
/*  writeSidecar — new file                                          */
/* ================================================================ */

describe("writeSidecar — new file", () => {
  it("creates a YAML file with all fields", async () => {
    const fp = path.join(tmpDir, "new.review.yaml");
    const doc = makeDoc([makeComment({ line: 5, selected_text: "hi" })]);
    await writeSidecar(fp, doc);

    const content = await readFile(fp, "utf-8");
    expect(content).toContain("mrsf_version:");
    expect(content).toContain("id: c-001");
    // Hash should have been auto-added
    expect(content).toContain("selected_text_hash:");
  });

  it("creates a JSON file when path ends in .review.json", async () => {
    const fp = path.join(tmpDir, "new.review.json");
    const doc = makeDoc([makeComment()]);
    await writeSidecar(fp, doc);

    const content = await readFile(fp, "utf-8");
    const parsed = JSON.parse(content);
    expect(parsed.mrsf_version).toBe("1.0");
  });
});

/* ================================================================ */
/*  writeSidecar — round-trip (byte-identical)                       */
/* ================================================================ */

describe("writeSidecar — round-trip preservation", () => {
  it("is byte-identical when nothing changed", async () => {
    const fp = path.join(tmpDir, "rt.review.yaml");
    const original = `mrsf_version: "1.0"
document: test.md
comments:
  - id: c-001
    author: Alice
    timestamp: "2026-01-01T00:00:00Z"
    text: Fix this
    resolved: false
    line: 5
    selected_text: hello world
    selected_text_hash: ${computeHash("hello world")}
    commit: abc123
`;
    await writeFile(fp, original, "utf-8");

    // Parse the same data back
    const doc: MrsfDocument = {
      mrsf_version: "1.0",
      document: "test.md",
      comments: [
        {
          id: "c-001",
          author: "Alice",
          timestamp: "2026-01-01T00:00:00Z",
          text: "Fix this",
          resolved: false,
          line: 5,
          selected_text: "hello world",
          selected_text_hash: computeHash("hello world"),
          commit: "abc123",
        },
      ],
    };

    await writeSidecar(fp, doc);
    const result = await readFile(fp, "utf-8");
    expect(result).toBe(original);
  });

  it("preserves YAML comments (# lines)", async () => {
    const fp = path.join(tmpDir, "comments.review.yaml");
    const original = `# Auto-generated sidecar
mrsf_version: "1.0"
document: test.md
# Review comments below
comments:
  - id: c-001
    author: Alice
    timestamp: "2026-01-01T00:00:00Z"
    text: Fix this
    resolved: false
`;
    await writeFile(fp, original, "utf-8");

    const doc: MrsfDocument = {
      mrsf_version: "1.0",
      document: "test.md",
      comments: [
        {
          id: "c-001",
          author: "Alice",
          timestamp: "2026-01-01T00:00:00Z",
          text: "Fix this",
          resolved: false,
        },
      ],
    };

    await writeSidecar(fp, doc);
    const result = await readFile(fp, "utf-8");
    expect(result).toBe(original);
  });

  it("preserves block scalar styles (|, >)", async () => {
    const fp = path.join(tmpDir, "block.review.yaml");
    const original = `mrsf_version: "1.0"
document: test.md
comments:
  - id: c-001
    author: Alice
    timestamp: "2026-01-01T00:00:00Z"
    text: |
      This is a long comment
      that spans multiple lines.
    resolved: false
`;
    await writeFile(fp, original, "utf-8");

    const doc: MrsfDocument = {
      mrsf_version: "1.0",
      document: "test.md",
      comments: [
        {
          id: "c-001",
          author: "Alice",
          timestamp: "2026-01-01T00:00:00Z",
          text: "This is a long comment\nthat spans multiple lines.\n",
          resolved: false,
        },
      ],
    };

    await writeSidecar(fp, doc);
    const result = await readFile(fp, "utf-8");
    expect(result).toBe(original);
  });

  it("preserves quoted string styles", async () => {
    const fp = path.join(tmpDir, "quoted.review.yaml");
    const original = `mrsf_version: "1.0"
document: test.md
comments:
  - id: "c-001"
    author: 'Alice'
    timestamp: "2026-01-01T00:00:00Z"
    text: Fix this
    resolved: false
`;
    await writeFile(fp, original, "utf-8");

    const doc: MrsfDocument = {
      mrsf_version: "1.0",
      document: "test.md",
      comments: [
        {
          id: "c-001",
          author: "Alice",
          timestamp: "2026-01-01T00:00:00Z",
          text: "Fix this",
          resolved: false,
        },
      ],
    };

    await writeSidecar(fp, doc);
    const result = await readFile(fp, "utf-8");
    expect(result).toBe(original);
  });

  it("preserves key ordering", async () => {
    const fp = path.join(tmpDir, "order.review.yaml");
    // Non-standard key order: resolved before text
    const original = `mrsf_version: "1.0"
document: test.md
comments:
  - id: c-001
    resolved: false
    author: Alice
    timestamp: "2026-01-01T00:00:00Z"
    text: Fix this
`;
    await writeFile(fp, original, "utf-8");

    const doc: MrsfDocument = {
      mrsf_version: "1.0",
      document: "test.md",
      comments: [
        {
          id: "c-001",
          resolved: false,
          author: "Alice",
          timestamp: "2026-01-01T00:00:00Z",
          text: "Fix this",
        },
      ],
    };

    await writeSidecar(fp, doc);
    const result = await readFile(fp, "utf-8");
    expect(result).toBe(original);
  });
});

/* ================================================================ */
/*  writeSidecar — surgical edits                                    */
/* ================================================================ */

describe("writeSidecar — surgical edits", () => {
  it("only changes the modified value", async () => {
    const fp = path.join(tmpDir, "edit.review.yaml");
    const original = `mrsf_version: "1.0"
document: test.md
comments:
  - id: c-001
    author: Alice
    timestamp: "2026-01-01T00:00:00Z"
    text: Fix this
    resolved: false
`;
    await writeFile(fp, original, "utf-8");

    const doc: MrsfDocument = {
      mrsf_version: "1.0",
      document: "test.md",
      comments: [
        {
          id: "c-001",
          author: "Alice",
          timestamp: "2026-01-01T00:00:00Z",
          text: "Fix this",
          resolved: true, // <-- changed
        },
      ],
    };

    await writeSidecar(fp, doc);
    const result = await readFile(fp, "utf-8");
    // Only "resolved" line should differ
    expect(result).toContain("resolved: true");
    // Everything else preserved
    expect(result).toContain("author: Alice");
    expect(result).toContain("text: Fix this");
    // The rest of the file is byte-identical except the resolved line
    const expected = original.replace("resolved: false", "resolved: true");
    expect(result).toBe(expected);
  });

  it("updates line number without touching other fields", async () => {
    const fp = path.join(tmpDir, "line.review.yaml");
    const original = `mrsf_version: "1.0"
document: test.md
comments:
  - id: c-001
    author: Alice
    timestamp: "2026-01-01T00:00:00Z"
    text: Fix this
    resolved: false
    line: 10
    commit: abc123
`;
    await writeFile(fp, original, "utf-8");

    const doc: MrsfDocument = {
      mrsf_version: "1.0",
      document: "test.md",
      comments: [
        {
          id: "c-001",
          author: "Alice",
          timestamp: "2026-01-01T00:00:00Z",
          text: "Fix this",
          resolved: false,
          line: 15,
          commit: "abc123",
        },
      ],
    };

    await writeSidecar(fp, doc);
    const result = await readFile(fp, "utf-8");
    const expected = original.replace("line: 10", "line: 15");
    expect(result).toBe(expected);
  });
});

/* ================================================================ */
/*  writeSidecar — adding / removing comments                        */
/* ================================================================ */

describe("writeSidecar — comment mutations", () => {
  const twoComments = `mrsf_version: "1.0"
document: test.md
comments:
  - id: c-001
    author: Alice
    timestamp: "2026-01-01T00:00:00Z"
    text: First comment
    resolved: false
  - id: c-002
    author: Bob
    timestamp: "2026-01-02T00:00:00Z"
    text: Second comment
    resolved: false
`;

  it("appends a new comment while preserving existing ones", async () => {
    const fp = path.join(tmpDir, "append.review.yaml");
    await writeFile(fp, twoComments, "utf-8");

    const doc: MrsfDocument = {
      mrsf_version: "1.0",
      document: "test.md",
      comments: [
        {
          id: "c-001",
          author: "Alice",
          timestamp: "2026-01-01T00:00:00Z",
          text: "First comment",
          resolved: false,
        },
        {
          id: "c-002",
          author: "Bob",
          timestamp: "2026-01-02T00:00:00Z",
          text: "Second comment",
          resolved: false,
        },
        {
          id: "c-003",
          author: "Carol",
          timestamp: "2026-01-03T00:00:00Z",
          text: "New comment",
          resolved: false,
        },
      ],
    };

    await writeSidecar(fp, doc);
    const result = await readFile(fp, "utf-8");

    // Original content preserved
    expect(result.startsWith(twoComments.trimEnd())).toBe(true);
    // New comment appended
    expect(result).toContain("id: c-003");
    expect(result).toContain("author: Carol");
    expect(result).toContain("text: New comment");
  });

  it("removes a comment while preserving others", async () => {
    const fp = path.join(tmpDir, "remove.review.yaml");
    await writeFile(fp, twoComments, "utf-8");

    // Only keep the second comment
    const doc: MrsfDocument = {
      mrsf_version: "1.0",
      document: "test.md",
      comments: [
        {
          id: "c-002",
          author: "Bob",
          timestamp: "2026-01-02T00:00:00Z",
          text: "Second comment",
          resolved: false,
        },
      ],
    };

    await writeSidecar(fp, doc);
    const result = await readFile(fp, "utf-8");
    expect(result).not.toContain("c-001");
    expect(result).not.toContain("Alice");
    expect(result).toContain("id: c-002");
    expect(result).toContain("author: Bob");
  });
});

/* ================================================================ */
/*  writeSidecar — hash behaviour                                    */
/* ================================================================ */

describe("writeSidecar — hash management", () => {
  it("does NOT inject selected_text_hash if it was not originally present", async () => {
    const fp = path.join(tmpDir, "nohash.review.yaml");
    const original = `mrsf_version: "1.0"
document: test.md
comments:
  - id: c-001
    author: Alice
    timestamp: "2026-01-01T00:00:00Z"
    text: Fix this
    resolved: false
    line: 5
    selected_text: hello world
`;
    await writeFile(fp, original, "utf-8");

    const doc: MrsfDocument = {
      mrsf_version: "1.0",
      document: "test.md",
      comments: [
        {
          id: "c-001",
          author: "Alice",
          timestamp: "2026-01-01T00:00:00Z",
          text: "Fix this",
          resolved: false,
          line: 5,
          selected_text: "hello world",
        },
      ],
    };

    await writeSidecar(fp, doc);
    const result = await readFile(fp, "utf-8");
    expect(result).not.toContain("selected_text_hash");
    expect(result).toBe(original);
  });

  it("updates hash when selected_text changes and hash was tracked", async () => {
    const fp = path.join(tmpDir, "hashupdate.review.yaml");
    const oldHash = computeHash("old text");
    const original = `mrsf_version: "1.0"
document: test.md
comments:
  - id: c-001
    author: Alice
    timestamp: "2026-01-01T00:00:00Z"
    text: Fix this
    resolved: false
    selected_text: old text
    selected_text_hash: ${oldHash}
`;
    await writeFile(fp, original, "utf-8");

    const doc: MrsfDocument = {
      mrsf_version: "1.0",
      document: "test.md",
      comments: [
        {
          id: "c-001",
          author: "Alice",
          timestamp: "2026-01-01T00:00:00Z",
          text: "Fix this",
          resolved: false,
          selected_text: "new text",
          selected_text_hash: computeHash("new text"),
        },
      ],
    };

    await writeSidecar(fp, doc);
    const result = await readFile(fp, "utf-8");
    expect(result).toContain(`selected_text: new text`);
    expect(result).toContain(`selected_text_hash: ${computeHash("new text")}`);
    expect(result).not.toContain(oldHash);
  });

  it("adds hash for brand-new comments with selected_text", async () => {
    const fp = path.join(tmpDir, "newhash.review.yaml");
    const original = `mrsf_version: "1.0"
document: test.md
comments:
  - id: c-001
    author: Alice
    timestamp: "2026-01-01T00:00:00Z"
    text: Existing
    resolved: false
`;
    await writeFile(fp, original, "utf-8");

    const doc: MrsfDocument = {
      mrsf_version: "1.0",
      document: "test.md",
      comments: [
        {
          id: "c-001",
          author: "Alice",
          timestamp: "2026-01-01T00:00:00Z",
          text: "Existing",
          resolved: false,
        },
        {
          id: "c-002",
          author: "Bob",
          timestamp: "2026-01-02T00:00:00Z",
          text: "New",
          resolved: false,
          selected_text: "some code",
        },
      ],
    };

    await writeSidecar(fp, doc);
    const result = await readFile(fp, "utf-8");
    // Hash may be quoted (starts with a digit) — just check it's present
    expect(result).toContain("selected_text_hash:");
    expect(result).toContain(computeHash("some code"));
  });
});

/* ================================================================ */
/*  writeSidecar — idempotency                                       */
/* ================================================================ */

describe("writeSidecar — idempotency", () => {
  it("writing twice produces identical output", async () => {
    const fp = path.join(tmpDir, "idempotent.review.yaml");
    const original = `mrsf_version: "1.0"
document: test.md
comments:
  - id: c-001
    author: Alice
    timestamp: "2026-01-01T00:00:00Z"
    text: |
      Multi-line
      comment text.
    type: suggestion
    severity: medium
    resolved: false
    line: 42
    selected_text: |-
      Some selected
      text here.
    selected_text_hash: ${computeHash("Some selected\ntext here.")}
    commit: deadbeef
`;
    await writeFile(fp, original, "utf-8");

    const doc: MrsfDocument = {
      mrsf_version: "1.0",
      document: "test.md",
      comments: [
        {
          id: "c-001",
          author: "Alice",
          timestamp: "2026-01-01T00:00:00Z",
          text: "Multi-line\ncomment text.\n",
          type: "suggestion",
          severity: "medium",
          resolved: false,
          line: 42,
          selected_text: "Some selected\ntext here.",
          selected_text_hash: computeHash("Some selected\ntext here."),
          commit: "deadbeef",
        },
      ],
    };

    await writeSidecar(fp, doc);
    const first = await readFile(fp, "utf-8");

    await writeSidecar(fp, doc);
    const second = await readFile(fp, "utf-8");

    expect(first).toBe(second);
    expect(first).toBe(original);
  });
});

/* ================================================================ */
/*  writeSidecar — adding new fields to existing comments            */
/* ================================================================ */

describe("writeSidecar — adding fields", () => {
  it("adds a new key to an existing comment", async () => {
    const fp = path.join(tmpDir, "addfield.review.yaml");
    const original = `mrsf_version: "1.0"
document: test.md
comments:
  - id: c-001
    author: Alice
    timestamp: "2026-01-01T00:00:00Z"
    text: Fix this
    resolved: false
`;
    await writeFile(fp, original, "utf-8");

    const doc: MrsfDocument = {
      mrsf_version: "1.0",
      document: "test.md",
      comments: [
        {
          id: "c-001",
          author: "Alice",
          timestamp: "2026-01-01T00:00:00Z",
          text: "Fix this",
          resolved: false,
          line: 10, // new field
        },
      ],
    };

    await writeSidecar(fp, doc);
    const result = await readFile(fp, "utf-8");
    expect(result).toContain("line: 10");
    // The original content up to the last field is preserved
    expect(result).toContain("author: Alice");
    expect(result).toContain("resolved: false");
  });

  it("removes a field when set to undefined", async () => {
    const fp = path.join(tmpDir, "rmfield.review.yaml");
    const original = `mrsf_version: "1.0"
document: test.md
comments:
  - id: c-001
    author: Alice
    timestamp: "2026-01-01T00:00:00Z"
    text: Fix this
    resolved: false
    line: 10
    commit: abc123
`;
    await writeFile(fp, original, "utf-8");

    const doc: MrsfDocument = {
      mrsf_version: "1.0",
      document: "test.md",
      comments: [
        {
          id: "c-001",
          author: "Alice",
          timestamp: "2026-01-01T00:00:00Z",
          text: "Fix this",
          resolved: false,
          // line removed (undefined)
          commit: "abc123",
        },
      ],
    };

    await writeSidecar(fp, doc);
    const result = await readFile(fp, "utf-8");
    expect(result).not.toContain("line:");
    expect(result).toContain("commit: abc123");
  });
});

/* ================================================================ */
/*  writeSidecar — top-level field updates                           */
/* ================================================================ */

describe("writeSidecar — top-level updates", () => {
  it("updates the document path", async () => {
    const fp = path.join(tmpDir, "toplevel.review.yaml");
    const original = `mrsf_version: "1.0"
document: old-name.md
comments:
  - id: c-001
    author: Alice
    timestamp: "2026-01-01T00:00:00Z"
    text: Fix this
    resolved: false
`;
    await writeFile(fp, original, "utf-8");

    const doc: MrsfDocument = {
      mrsf_version: "1.0",
      document: "new-name.md",
      comments: [
        {
          id: "c-001",
          author: "Alice",
          timestamp: "2026-01-01T00:00:00Z",
          text: "Fix this",
          resolved: false,
        },
      ],
    };

    await writeSidecar(fp, doc);
    const result = await readFile(fp, "utf-8");
    const expected = original.replace("old-name.md", "new-name.md");
    expect(result).toBe(expected);
  });
});

/* ================================================================ */
/*  writeSidecar — extension fields                                  */
/* ================================================================ */

describe("writeSidecar — extension fields", () => {
  it("preserves x_-prefixed fields on round-trip", async () => {
    const fp = path.join(tmpDir, "ext.review.yaml");
    const original = `mrsf_version: "1.0"
document: test.md
comments:
  - id: c-001
    author: Alice
    timestamp: "2026-01-01T00:00:00Z"
    text: Fix this
    resolved: false
    x_reanchor_status: anchored
    x_reanchor_score: 1
`;
    await writeFile(fp, original, "utf-8");

    const doc: MrsfDocument = {
      mrsf_version: "1.0",
      document: "test.md",
      comments: [
        {
          id: "c-001",
          author: "Alice",
          timestamp: "2026-01-01T00:00:00Z",
          text: "Fix this",
          resolved: false,
          x_reanchor_status: "anchored",
          x_reanchor_score: 1,
        },
      ],
    };

    await writeSidecar(fp, doc);
    const result = await readFile(fp, "utf-8");
    expect(result).toBe(original);
  });
});

/* ================================================================ */
/*  YAML-special character quoting (Bug 1 regression tests)         */
/* ================================================================ */

describe("writeSidecar — YAML-special selected_text quoting", () => {
  const yamlSpecialValues = [
    { label: "leading dash (list indicator)", value: "- bullet item" },
    { label: "leading hash (comment)", value: "# Heading" },
    { label: "colon-space (mapping)", value: "key: value" },
    { label: "opening bracket", value: "[link](url)" },
    { label: "opening brace", value: "{foo: bar}" },
    { label: "leading whitespace", value: "  indented text" },
    { label: "trailing whitespace", value: "text with trailing " },
    { label: "tab character", value: "before\tafter" },
    { label: "newline", value: "line1\nline2" },
    { label: "ampersand (anchor)", value: "&anchor" },
    { label: "asterisk (alias)", value: "*alias" },
    { label: "exclamation (tag)", value: "!important" },
    { label: "percent (directive)", value: "%TAG" },
    { label: "pipe (literal block)", value: "| not a block" },
    { label: "greater-than (folded block)", value: "> not a fold" },
    { label: "at sign", value: "@mention" },
    { label: "backtick", value: "`code`" },
    { label: "YAML boolean true", value: "true" },
    { label: "YAML boolean false", value: "false" },
    { label: "YAML null", value: "null" },
    { label: "YAML tilde null", value: "~" },
    { label: "YAML yes", value: "yes" },
    { label: "YAML no", value: "no" },
    { label: "digit-leading", value: "42 is the answer" },
    { label: "empty string", value: "" },
    { label: "bare dash", value: "-" },
    { label: "double quote inside", value: 'say "hello"' },
    { label: "inline comment marker", value: "some text # comment" },
  ];

  for (const { label, value } of yamlSpecialValues) {
    it(`round-trips selected_text with ${label}`, async () => {
      const fp = path.join(tmpDir, `special-${label.replace(/\W+/g, "-")}.review.yaml`);

      // Write fresh (toYaml path — known safe)
      const doc = makeDoc([makeComment({ selected_text: value })]);
      await writeSidecar(fp, doc);

      // Verify the file is parseable YAML
      const raw = await readFile(fp, "utf-8");
      const { default: jsYaml } = await import("js-yaml");
      const parsed = jsYaml.load(raw) as MrsfDocument;
      expect(parsed.comments[0].selected_text).toBe(value);

      // Now round-trip through CST path (existing file)
      const doc2 = makeDoc([
        makeComment({ selected_text: value }),
        makeComment({ id: "c-002", selected_text: "new comment" }),
      ]);
      await writeSidecar(fp, doc2);

      const raw2 = await readFile(fp, "utf-8");
      const parsed2 = jsYaml.load(raw2) as MrsfDocument;
      expect(parsed2.comments[0].selected_text).toBe(value);
      expect(parsed2.comments).toHaveLength(2);
    });
  }

  it("round-trips a brand-new comment with YAML-special selected_text via CST path", async () => {
    const fp = path.join(tmpDir, "cst-special.review.yaml");

    // Create initial sidecar with a safe comment
    const initial = makeDoc([makeComment({ id: "safe-1", selected_text: "normal text" })]);
    await writeSidecar(fp, initial);

    // Add a comment with YAML-dangerous selected_text via the CST round-trip path
    const updated = makeDoc([
      makeComment({ id: "safe-1", selected_text: "normal text" }),
      makeComment({ id: "danger-1", selected_text: "- Why a given bullet point" }),
      makeComment({ id: "danger-2", selected_text: "# Top-level heading" }),
      makeComment({ id: "danger-3", selected_text: "key: value with colon" }),
    ]);
    await writeSidecar(fp, updated);

    // Parse the result and verify all values survived
    const raw = await readFile(fp, "utf-8");
    const { default: jsYaml } = await import("js-yaml");
    const parsed = jsYaml.load(raw) as MrsfDocument;

    expect(parsed.comments).toHaveLength(4);
    expect(parsed.comments[0].selected_text).toBe("normal text");
    expect(parsed.comments[1].selected_text).toBe("- Why a given bullet point");
    expect(parsed.comments[2].selected_text).toBe("# Top-level heading");
    expect(parsed.comments[3].selected_text).toBe("key: value with colon");
  });
});

/* ================================================================ */
/*  Concurrent write serialization (Bug 3 regression tests)         */
/* ================================================================ */

describe("writeSidecar — concurrent writes", () => {
  it("serializes 10 parallel writes to the same file without data loss", async () => {
    const fp = path.join(tmpDir, "concurrent.review.yaml");

    // Each write adds a cumulative set of comments (1, 1+2, 1+2+3, ...)
    // Since writes are serialized, the last write wins — and it should
    // produce valid YAML with all 10 comments.
    const allComments: Comment[] = [];
    for (let i = 1; i <= 10; i++) {
      allComments.push(
        makeComment({
          id: `c-${String(i).padStart(3, "0")}`,
          text: `Comment number ${i}`,
          selected_text: `line ${i} content`,
        }),
      );
    }

    // Fire 10 writes in parallel, each with a growing list of comments
    const writes = allComments.map((_, idx) => {
      const doc = makeDoc(allComments.slice(0, idx + 1));
      return writeSidecar(fp, doc);
    });

    await Promise.all(writes);

    // The final state should be valid YAML
    const raw = await readFile(fp, "utf-8");
    const { default: jsYaml } = await import("js-yaml");
    const parsed = jsYaml.load(raw) as MrsfDocument;

    // The last write (with all 10 comments) should have won
    expect(parsed.comments).toHaveLength(10);
    for (let i = 0; i < 10; i++) {
      expect(parsed.comments[i].id).toBe(`c-${String(i + 1).padStart(3, "0")}`);
    }
  });

  it("serializes parallel writes that each add a single different comment", async () => {
    const fp = path.join(tmpDir, "concurrent-single.review.yaml");

    // Create initial file with one comment
    const initial = makeDoc([makeComment({ id: "base", text: "base comment" })]);
    await writeSidecar(fp, initial);

    // Fire 5 parallel writes, each replacing with base + one new comment
    // Since they're serialized, the last one in the queue wins
    const writes = [];
    for (let i = 1; i <= 5; i++) {
      const doc = makeDoc([
        makeComment({ id: "base", text: "base comment" }),
        makeComment({ id: `new-${i}`, text: `New comment ${i}` }),
      ]);
      writes.push(writeSidecar(fp, doc));
    }

    await Promise.all(writes);

    // Result should be valid YAML with 2 comments (base + last write's new comment)
    const raw = await readFile(fp, "utf-8");
    const { default: jsYaml } = await import("js-yaml");
    const parsed = jsYaml.load(raw) as MrsfDocument;

    expect(parsed.comments).toHaveLength(2);
    expect(parsed.comments[0].id).toBe("base");
    // The file should be valid YAML regardless of which concurrent write finished last
    expect(parsed.mrsf_version).toBe("1.0");
  });
});

/* ------------------------------------------------------------------ */
/*  Timestamp format preservation                                      */
/* ------------------------------------------------------------------ */

describe("timestamp format preservation", () => {
  it("toYaml preserves ISO 8601 timestamps as strings", () => {
    const doc = makeDoc([
      makeComment({ id: "ts-1", timestamp: "2026-03-05T21:33:56.197Z" }),
    ]);
    const yaml = toYaml(doc);
    expect(yaml).toContain("2026-03-05T21:33:56.197Z");
    // Must NOT contain Date-serialized formats like "2026-03-05 21:33:56"
    expect(yaml).not.toMatch(/2026-03-05 21:33:56/);
  });

  it("round-trips unquoted timestamps through write + parse", async () => {
    const fp = path.join(tmpDir, "ts-roundtrip.review.yaml");
    // Write a sidecar with a YAML-unquoted timestamp (the format agents produce)
    const initialYaml = `mrsf_version: "1.0"
document: test.md
comments:
  - id: c-ts
    author: Agent
    timestamp: 2026-03-05T21:33:56.197Z
    text: Review this section
    resolved: false
`;
    await writeFile(fp, initialYaml);

    // Round-trip: read + write with an update
    const doc = makeDoc([
      makeComment({
        id: "c-ts",
        author: "Agent",
        timestamp: "2026-03-05T21:33:56.197Z",
        text: "Review this section",
        resolved: true,
      }),
    ]);
    await writeSidecar(fp, doc);

    const result = await readFile(fp, "utf-8");
    // Timestamp must still be valid ISO 8601
    expect(result).toMatch(/2026-03-05T21:33:56\.197Z/);
    // Must NOT be converted to locale/space-separated format
    expect(result).not.toMatch(/2026-03-05 21:33:56/);
  });
});
