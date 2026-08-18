import Ajv2020Module, {
  type ErrorObject,
  type ValidateFunction,
} from "ajv/dist/2020.js";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { reanchorComment, toReanchorLines } from "../lib/reanchor-core.js";
import { createRevisionProjection } from "../lib/revision-projection.js";
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
  generation?: EvaluationGeneration;
  comments: EvaluationComment[];
}

export interface EvaluationGeneration {
  generator_version: 1;
  seed: number;
  blocks_per_case: number;
  comments_per_case: number;
  operations: EvaluationMutation[];
}

export interface EvaluationMutation {
  type:
    | "insert-block"
    | "delete-block"
    | "move-block"
    | "rewrite-block"
    | "duplicate-block"
    | "swap-blocks"
    | "whitespace-block"
    | "split-block"
    | "merge-blocks"
    | "rename-heading";
  block_ids: string[];
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
  timingMs: {
    median: number;
    p95: number;
    max: number;
    perComment: number;
  };
  results: EvaluationCommentResult[];
}

export interface EvaluationBaseline {
  version: 1;
  algorithm: string;
  cases: number;
  comments: number;
  metrics: {
    passed: number;
    failed: number;
    exactRangeMatches: number;
    statusMatches: number;
    incorrectConfidentRelocations: number;
  };
  results: EvaluationBaselineResult[];
}

export interface EvaluationBaselineResult {
  caseId: string;
  commentId: string;
  expectedStatus: ReanchorStatus;
  actual: ReanchorResult;
  statusCorrect: boolean;
  rangeCorrect: boolean;
  passed: boolean;
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
    const parsed: unknown = JSON.parse(await readFile(casePath, "utf8"));
    const values = Array.isArray(parsed) ? parsed : [parsed];

    for (const [index, value] of values.entries()) {
      const location = values.length === 1 ? casePath : `${casePath}[${index}]`;
      assertValidCase(validator, value, location);
      if (caseIds.has(value.id)) {
        throw new Error(`Duplicate evaluation case id "${value.id}" in ${location}.`);
      }
      caseIds.add(value.id);
      loaded.push({ casePath, value });
    }
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
    const sourceText = await readEvaluationDocument(
      loadedCase.value.source,
      loadedCase.casePath,
    );
    validateSourceSelections(loadedCase.value, sourceText);
    const targetText = await readEvaluationDocument(
      loadedCase.value.target,
      loadedCase.casePath,
    );
    const sourceLines = toReanchorLines(sourceText);
    const documentLines = toReanchorLines(targetText);
    const revisionProjection = createRevisionProjection(
      sourceLines,
      documentLines,
    );

    for (const evaluationComment of loadedCase.value.comments) {
      const comment = toComment(evaluationComment);
      const commentStartedAt = performance.now();
      const actual = reanchorComment(comment, documentLines, {
        revisionProjection,
      });
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

  const durationMs = performance.now() - startedAt;
  const timings = results
    .map((result) => result.durationMs)
    .sort((left, right) => left - right);

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
        (result.actual.status === "anchored" || result.actual.status === "shifted")
        && (
          result.expected.ranges?.length
            ? !result.rangeCorrect
            : result.expected.status === "ambiguous"
              || result.expected.status === "orphaned"
        ),
    ).length,
    durationMs,
    timingMs: {
      median: percentile(timings, 0.5),
      p95: percentile(timings, 0.95),
      max: timings.at(-1) ?? 0,
      perComment: results.length > 0 ? durationMs / results.length : 0,
    },
    results,
  };
}

function percentile(sortedValues: number[], quantile: number): number {
  if (sortedValues.length === 0) return 0;
  const index = Math.max(
    0,
    Math.ceil(sortedValues.length * quantile) - 1,
  );
  return sortedValues[index];
}

export function createEvaluationBaseline(
  summary: EvaluationSummary,
): EvaluationBaseline {
  return {
    version: 1,
    algorithm: summary.algorithm,
    cases: summary.cases,
    comments: summary.comments,
    metrics: {
      passed: summary.passed,
      failed: summary.failed,
      exactRangeMatches: summary.exactRangeMatches,
      statusMatches: summary.statusMatches,
      incorrectConfidentRelocations: summary.incorrectConfidentRelocations,
    },
    results: summary.results.map((result) => ({
      caseId: result.caseId,
      commentId: result.commentId,
      expectedStatus: result.expected.status,
      actual: result.actual,
      statusCorrect: result.statusCorrect,
      rangeCorrect: result.rangeCorrect,
      passed: result.passed,
    })),
  };
}

export function findBaselineDifferences(
  expected: EvaluationBaseline,
  actual: EvaluationBaseline,
): string[] {
  const differences: string[] = [];

  if (expected.version !== actual.version) {
    differences.push(
      `Baseline version changed from ${expected.version} to ${actual.version}.`,
    );
  }
  if (expected.algorithm !== actual.algorithm) {
    differences.push(
      `Algorithm changed from ${expected.algorithm} to ${actual.algorithm}.`,
    );
  }

  const expectedHeader = {
    cases: expected.cases,
    comments: expected.comments,
    metrics: expected.metrics,
  };
  const actualHeader = {
    cases: actual.cases,
    comments: actual.comments,
    metrics: actual.metrics,
  };
  if (JSON.stringify(expectedHeader) !== JSON.stringify(actualHeader)) {
    differences.push(
      `Summary changed: expected ${JSON.stringify(expectedHeader)}, `
      + `received ${JSON.stringify(actualHeader)}.`,
    );
  }

  const expectedResults = new Map(
    expected.results.map((result) => [baselineResultKey(result), result]),
  );
  const actualResults = new Map(
    actual.results.map((result) => [baselineResultKey(result), result]),
  );

  for (const [key, expectedResult] of expectedResults) {
    const actualResult = actualResults.get(key);
    if (!actualResult) {
      differences.push(`Result ${key} is missing.`);
    } else if (JSON.stringify(expectedResult) !== JSON.stringify(actualResult)) {
      differences.push(`Result ${key} changed.`);
    }
  }
  for (const key of actualResults.keys()) {
    if (!expectedResults.has(key)) {
      differences.push(`Result ${key} is new.`);
    }
  }

  return differences;
}

function baselineResultKey(
  result: Pick<EvaluationBaselineResult, "caseId" | "commentId">,
): string {
  return `${result.caseId}/${result.commentId}`;
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

function validateSourceSelections(
  evaluationCase: EvaluationCase,
  sourceText: string,
): void {
  const normalizedSource = sourceText.replace(/\r\n/g, "\n");

  for (const comment of evaluationCase.comments) {
    const selectedText = comment.anchor.selected_text?.replace(/\r\n/g, "\n");
    if (selectedText != null && !normalizedSource.includes(selectedText)) {
      throw new Error(
        `Evaluation case ${evaluationCase.id}/${comment.id} has selected_text `
        + "that does not occur in its source document.",
      );
    }
  }
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
