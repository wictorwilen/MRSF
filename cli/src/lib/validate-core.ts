import AjvModule from "ajv";
import addFormatsModule from "ajv-formats";
import { mrsfSchema } from "./schema.js";
import type {
  MrsfDocument,
  ValidationDiagnostic,
  ValidationResult,
} from "./types.js";

const Ajv = (AjvModule as any).default ?? AjvModule;
const addFormats = (addFormatsModule as any).default ?? addFormatsModule;

export type HashFunction = (text: string) => string;

export function validateDocument(
  doc: MrsfDocument,
  schema: object = mrsfSchema,
): ValidationResult {
  const errors: ValidationDiagnostic[] = [];
  const warnings: ValidationDiagnostic[] = [];

  validateSchema(doc, schema, errors);
  validateCrossFields(doc, errors, warnings);

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

export function validateSchema(
  doc: MrsfDocument,
  rawSchema: object,
  errors: ValidationDiagnostic[],
): void {
  const { $schema, ...schema } = rawSchema as Record<string, unknown>;
  void $schema;
  const ajv = new Ajv({ allErrors: true, strict: false });
  addFormats(ajv);
  const ajvValidate = ajv.compile(schema);
  const schemaValid = ajvValidate(doc);

  if (!schemaValid && ajvValidate.errors) {
    for (const err of ajvValidate.errors) {
      errors.push({
        severity: "error",
        code: "schema-violation",
        message: `${err.instancePath || "/"}: ${err.message ?? "schema error"}`,
        path: err.instancePath || "/",
      });
    }
  }
}

export function validateCrossFields(
  doc: MrsfDocument,
  errors: ValidationDiagnostic[],
  warnings: ValidationDiagnostic[],
  hash?: HashFunction,
): void {
  if (!Array.isArray(doc.comments)) return;

  const ids = new Set<string>();
  const allIds = doc.comments.map((x) => x.id);

  for (let i = 0; i < doc.comments.length; i++) {
    const c = doc.comments[i];
    const prefix = `/comments/${i}`;

    if (c.id) {
      if (ids.has(c.id)) {
        errors.push({
          severity: "error",
          code: "duplicate-id",
          message: `Duplicate comment id "${c.id}"`,
          path: `${prefix}/id`,
          commentId: c.id,
        });
      }
      ids.add(c.id);
    }

    if (c.line != null && c.end_line != null && c.end_line < c.line) {
      errors.push({
        severity: "error",
        code: "end-line-before-line",
        message: `end_line (${c.end_line}) must be ≥ line (${c.line})`,
        path: `${prefix}/end_line`,
        commentId: c.id,
      });
    }

    if (
      c.start_column != null &&
      c.end_column != null &&
      (c.line == null || c.end_line == null || c.line === c.end_line) &&
      c.end_column < c.start_column
    ) {
      errors.push({
        severity: "error",
        code: "end-column-before-start-column",
        message: `end_column (${c.end_column}) must be ≥ start_column (${c.start_column}) on the same line`,
        path: `${prefix}/end_column`,
        commentId: c.id,
      });
    }

    if (c.selected_text && c.selected_text.length > 4096) {
      errors.push({
        severity: "error",
        code: "selected-text-too-long",
        message: `selected_text exceeds 4096 characters (${c.selected_text.length})`,
        path: `${prefix}/selected_text`,
        commentId: c.id,
      });
    }

    if (c.text && c.text.length > 16384) {
      warnings.push({
        severity: "warning",
        code: "text-too-long",
        message: `text exceeds recommended 16384 characters (${c.text.length})`,
        path: `${prefix}/text`,
        commentId: c.id,
      });
    }

    // Browser-safe callers do not get the Node SHA-256 implementation.
    // The hash check runs only when a hash function is injected by the Node validator.
    if (hash && c.selected_text && c.selected_text_hash) {
      const expected = hash(c.selected_text);
      if (c.selected_text_hash !== expected) {
        warnings.push({
          severity: "warning",
          code: "hash-mismatch",
          message: `selected_text_hash mismatch (expected ${expected.slice(0, 12)}…, got ${c.selected_text_hash.slice(0, 12)}…)`,
          path: `${prefix}/selected_text_hash`,
          commentId: c.id,
        });
      }
    }

    if (c.reply_to && !ids.has(c.reply_to) && !allIds.includes(c.reply_to)) {
      warnings.push({
        severity: "warning",
        code: "unresolved-reply-to",
        message: `reply_to "${c.reply_to}" does not resolve to any comment id in this file`,
        path: `${prefix}/reply_to`,
        commentId: c.id,
      });
    }

    if (c.line != null && !c.selected_text) {
      warnings.push({
        severity: "warning",
        code: "missing-selected-text",
        message: "Comment has line anchors but no selected_text — anchoring will be fragile across edits",
        path: `${prefix}/selected_text`,
        commentId: c.id,
      });
    }
  }
}
