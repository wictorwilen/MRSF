/**
 * MRSF Validator — JSON Schema + cross-field validation per §10.
 */

import AjvModule from "ajv";
import addFormatsModule from "ajv-formats";

// ESM interop: handle both default and namespace imports
const Ajv = (AjvModule as any).default ?? AjvModule;
const addFormats = (addFormatsModule as any).default ?? addFormatsModule;
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { computeHash } from "./writer.js";
import type {
  MrsfDocument,
  ValidationResult,
  ValidationDiagnostic,
  ValidateOptions,
} from "./types.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let _schemaCache: object | null = null;

async function loadSchema(): Promise<object> {
  if (_schemaCache) return _schemaCache;

  // The schema lives at the repo root, two levels up from dist/lib/
  // When installed as a package, it's at the package root (cli/)
  const candidates = [
    path.resolve(__dirname, "../../mrsf.schema.json"),          // from dist/lib/ → cli/ (installed package)
    path.resolve(__dirname, "../../../mrsf.schema.json"),       // from dist/lib/ → repo root (dev)
    path.resolve(__dirname, "../../../../mrsf.schema.json"),    // fallback
    path.resolve(process.cwd(), "mrsf.schema.json"),           // cwd fallback
  ];

  for (const candidate of candidates) {
    try {
      const raw = await readFile(candidate, "utf-8");
      _schemaCache = JSON.parse(raw);
      return _schemaCache!;
    } catch {
      // try next
    }
  }

  throw new Error("Could not locate mrsf.schema.json");
}

/**
 * Validate an MRSF document (parsed object).
 */
export async function validate(
  doc: MrsfDocument,
  options: ValidateOptions = {},
): Promise<ValidationResult> {
  const errors: ValidationDiagnostic[] = [];
  const warnings: ValidationDiagnostic[] = [];

  // ── JSON Schema validation ──
  const rawSchema = await loadSchema();
  // Ajv 8 doesn't natively support 2020-12; strip $schema to use draft-07 mode
  const { $schema, ...schema } = rawSchema as Record<string, unknown>;
  const ajv = new Ajv({ allErrors: true, strict: false });
  addFormats(ajv);
  const ajvValidate = ajv.compile(schema);
  const schemaValid = ajvValidate(doc);

  if (!schemaValid && ajvValidate.errors) {
    for (const err of ajvValidate.errors) {
      errors.push({
        severity: "error",
        message: `${err.instancePath || "/"}: ${err.message ?? "schema error"}`,
        path: err.instancePath || "/",
      });
    }
  }

  // ── Cross-field validation (§10) ──
  if (Array.isArray(doc.comments)) {
    const ids = new Set<string>();

    for (let i = 0; i < doc.comments.length; i++) {
      const c = doc.comments[i];
      const prefix = `/comments/${i}`;

      // Unique id check
      if (c.id) {
        if (ids.has(c.id)) {
          errors.push({
            severity: "error",
            message: `Duplicate comment id "${c.id}"`,
            path: `${prefix}/id`,
            commentId: c.id,
          });
        }
        ids.add(c.id);
      }

      // end_line ≥ line
      if (c.line != null && c.end_line != null && c.end_line < c.line) {
        errors.push({
          severity: "error",
          message: `end_line (${c.end_line}) must be ≥ line (${c.line})`,
          path: `${prefix}/end_line`,
          commentId: c.id,
        });
      }

      // end_column ≥ start_column when same line
      if (
        c.start_column != null &&
        c.end_column != null &&
        (c.line == null || c.end_line == null || c.line === c.end_line) &&
        c.end_column < c.start_column
      ) {
        errors.push({
          severity: "error",
          message: `end_column (${c.end_column}) must be ≥ start_column (${c.start_column}) on the same line`,
          path: `${prefix}/end_column`,
          commentId: c.id,
        });
      }

      // selected_text length
      if (c.selected_text && c.selected_text.length > 4096) {
        errors.push({
          severity: "error",
          message: `selected_text exceeds 4096 characters (${c.selected_text.length})`,
          path: `${prefix}/selected_text`,
          commentId: c.id,
        });
      }

      // text length
      if (c.text && c.text.length > 16384) {
        warnings.push({
          severity: "warning",
          message: `text exceeds recommended 16384 characters (${c.text.length})`,
          path: `${prefix}/text`,
          commentId: c.id,
        });
      }

      // selected_text_hash consistency
      if (c.selected_text && c.selected_text_hash) {
        const expected = computeHash(c.selected_text);
        if (c.selected_text_hash !== expected) {
          warnings.push({
            severity: "warning",
            message: `selected_text_hash mismatch (expected ${expected.slice(0, 12)}…, got ${c.selected_text_hash.slice(0, 12)}…)`,
            path: `${prefix}/selected_text_hash`,
            commentId: c.id,
          });
        }
      }

      // reply_to resolution
      if (c.reply_to && !ids.has(c.reply_to)) {
        // Check forward references too
        const allIds = doc.comments.map((x) => x.id);
        if (!allIds.includes(c.reply_to)) {
          warnings.push({
            severity: "warning",
            message: `reply_to "${c.reply_to}" does not resolve to any comment id in this file`,
            path: `${prefix}/reply_to`,
            commentId: c.id,
          });
        }
      }

      // Missing selected_text warning
      if (c.line != null && !c.selected_text) {
        warnings.push({
          severity: "warning",
          message: `Comment has line anchors but no selected_text — anchoring will be fragile across edits`,
          path: `${prefix}/selected_text`,
          commentId: c.id,
        });
      }
    }
  }

  const valid = errors.length === 0 && (!options.strict || warnings.length === 0);

  return { valid, errors, warnings };
}

/**
 * Validate from a file path — convenience wrapper.
 */
export async function validateFile(
  filePath: string,
  options: ValidateOptions = {},
): Promise<ValidationResult> {
  const { parseSidecar } = await import("./parser.js");
  try {
    const doc = await parseSidecar(filePath);
    return validate(doc, options);
  } catch (e) {
    return {
      valid: false,
      errors: [
        {
          severity: "error",
          message: `Failed to parse: ${(e as Error).message}`,
        },
      ],
      warnings: [],
    };
  }
}
