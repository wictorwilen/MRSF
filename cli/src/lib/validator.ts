/**
 * MRSF Validator — JSON Schema + cross-field validation per §10.
 */

import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { computeHash } from "./writer.js";
import { validateCrossFields, validateSchema } from "./validate-core.js";
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
    path.resolve(__dirname, "mrsf.schema.json"),                // same dir (esbuild bundle, e.g. MCP server)
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
  validateSchema(doc, rawSchema, errors);

  // ── Cross-field validation (§10) ──
  validateCrossFields(doc, errors, warnings, computeHash);

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
          code: "parse-error",
          message: `Failed to parse: ${(e as Error).message}`,
        },
      ],
      warnings: [],
    };
  }
}
