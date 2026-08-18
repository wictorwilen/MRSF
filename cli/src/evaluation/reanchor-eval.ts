import Ajv2020Module, {
  type ErrorObject,
  type ValidateFunction,
} from "ajv/dist/2020.js";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { reanchorComment, toReanchorLines } from "../lib/reanchor-core.js";
import type { Comment, ReanchorResult, ReanchorStatus } from "../lib/types.js";

const Ajv2020 = Ajv2020Module as unknown as new (
  options?: object,
) => { compile(schema: object): ValidateFunction };

export interface EvaluationDocument {
  text?: string;
  path?: string;
}

export interface EvaluationAnchor {
  line?: number;
  end_line?: number;
  start_column?: number;
  end_column?: number;
  selected_text?: string;
  selected_text_hash?: string;
  commit?: string;
}

export interface EvaluationRange {
  line: number;
  end_line?: number;
  start_column?: number;
  end_column?: number;
}

export interface EvaluationExpectation {
  status: ReanchorStatus;
  ranges?: EvaluationRange[];
  rationale?: string;
}

export interface EvaluationComment {
  id: string;
  anchor: EvaluationAnchor;
  expected: EvaluationExpectation;
}

export interface EvaluationCase {
  id: string;
  description?: string;
  categories: string[];
  source: EvaluationDocument;
  target: EvaluationDocument;
  comments: EvaluationComment[];
}

export interface EvaluationCommentResult {
  caseId: string;
  commentId: string;
  expected: EvaluationExpectation;
  actual: ReanchorResult;
  statusCorrect: boolean;
  rangeCorrect: boolean;
  passed: boolean;
  durationMs: number;
}

export interface EvaluationSummary {
  algorithm: string;
  cases: number;
  comments: number;
  passed: number;
  failed: number;
  exactRangeMatches: number;
  statusMatches: number;
  incorrectConfidentRelocations: number;
  durationMs: number;
  results: EvaluationCommentResult[];
}

export interface LoadedEvaluationCase {
  casePath: string;
  value: EvaluationCase;
}

export async function loadEvaluationCases(
  casesPath: string,
  schemaPath: string,
): Promise<LoadedEvaluationCase[]> {
  const schema = JSON.parse(await readFile(schemaPath, "utf8")) as object;
  const validator = new Ajv2020({
    allErrors: true,
    strict: true,
    strictRequired: false,
  }).compile(schema);
  const files = await findJsonFiles(casesPath);
  const loaded: LoadedEvaluationCase[] = [];
  const caseIds = new Set<string>();

  for (const casePath of files) {
    const value: unknown = JSON.parse(await readFile(casePath, "utf8"));
    assertValidCase(validator, value, casePath);
    if (caseIds.has(value.id)) {
      throw new Error(`Duplicate evaluation case id "${value.id}" in ${casePath}.`);
    }
    caseIds.add(value.id);
    loaded.push({ casePath, value: value as EvaluationCase });
  }

  if (loaded.length === 0) {
    throw new Error(`No evaluation cases found in ${casesPath}.`);
  }

  return loaded;
}

export async function evaluateCases(
  cases: LoadedEvaluationCase[],
): Promise<EvaluationSummary> {
  const startedAt = performance.now();
  const results: EvaluationCommentResult[] = [];

  for (const loadedCase of cases) {
    await readEvaluationDocument(loadedCase.value.source, loadedCase.casePath);
    const targetText = await readEvaluationDocument(
      loadedCase.value.target,
      loadedCase.casePath,
    );
    const documentLines = toReanchorLines(targetText);

    for (const evaluationComment of loadedCase.value.comments) {
      const comment = toComment(evaluationComment);
      const commentStartedAt = performance.now();
      const actual = reanchorComment(comment, documentLines);
      const durationMs = performance.now() - commentStartedAt;
      const statusCorrect = actual.status === evaluationComment.expected.status;
      const rangeCorrect = matchesExpectedRange(
        actual,
        comment,
        evaluationComment.expected.ranges,
      );

      results.push({
        caseId: loadedCase.value.id,
        commentId: evaluationComment.id,
        expected: evaluationComment.expected,
        actual,
        statusCorrect,
        rangeCorrect,
        passed: statusCorrect && rangeCorrect,
        durationMs,
      });
    }
  }

  return {
    algorithm: "baseline",
    cases: cases.length,
    comments: results.length,
    passed: results.filter((result) => result.passed).length,
    failed: results.filter((result) => !result.passed).length,
    exactRangeMatches: results.filter((result) => result.rangeCorrect).length,
    statusMatches: results.filter((result) => result.statusCorrect).length,
    incorrectConfidentRelocations: results.filter(
      (result) =>
        !result.passed
        && (result.actual.status === "anchored" || result.actual.status === "shifted"),
    ).length,
    durationMs: performance.now() - startedAt,
    results,
  };
}

async function findJsonFiles(rootPath: string): Promise<string[]> {
  const entries = await readdir(rootPath, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    const entryPath = path.join(rootPath, entry.name);
    if (entry.isDirectory()) {
      files.push(...await findJsonFiles(entryPath));
    } else if (entry.isFile() && entry.name.endsWith(".json")) {
      files.push(entryPath);
    }
  }

  return files;
}

function assertValidCase(
  validator: ValidateFunction,
  value: unknown,
  casePath: string,
): asserts value is EvaluationCase {
  if (validator(value)) return;

  const details = (validator.errors ?? [])
    .map(formatValidationError)
    .join("\n");
  throw new Error(`Invalid evaluation case ${casePath}:\n${details}`);
}

function formatValidationError(error: ErrorObject): string {
  return `  ${error.instancePath || "/"} ${error.message ?? "is invalid"}`;
}

async function readEvaluationDocument(
  document: EvaluationDocument,
  casePath: string,
): Promise<string> {
  if (document.text != null) return document.text;
  if (document.path != null) {
    return readFile(path.resolve(path.dirname(casePath), document.path), "utf8");
  }
  throw new Error(`Evaluation document in ${casePath} has neither text nor path.`);
}

function toComment(evaluationComment: EvaluationComment): Comment {
  return {
    id: evaluationComment.id,
    author: "MRSF evaluation",
    timestamp: "1970-01-01T00:00:00Z",
    text: "Reanchoring evaluation fixture",
    resolved: false,
    ...evaluationComment.anchor,
  };
}

function matchesExpectedRange(
  actual: ReanchorResult,
  original: Comment,
  expectedRanges: EvaluationRange[] | undefined,
): boolean {
  if (!expectedRanges?.length) return true;

  const actualRange: EvaluationRange = {
    line: actual.newLine ?? original.line ?? 0,
    end_line: actual.newEndLine ?? original.end_line ?? actual.newLine ?? original.line,
    start_column: actual.newStartColumn ?? original.start_column,
    end_column: actual.newEndColumn ?? original.end_column,
  };

  return expectedRanges.some((expected) =>
    actualRange.line === expected.line
    && (
      expected.end_line == null
      || (actualRange.end_line ?? actualRange.line) === expected.end_line
    )
    && (
      expected.start_column == null
      || actualRange.start_column === expected.start_column
    )
    && (
      expected.end_column == null
      || actualRange.end_column === expected.end_column
    )
  );
}
