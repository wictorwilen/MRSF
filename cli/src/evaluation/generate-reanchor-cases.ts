import type {
  EvaluationCase,
  EvaluationComment,
  EvaluationMutation,
  EvaluationRange,
} from "./reanchor-eval.js";

export interface GenerateCasesOptions {
  seed: number;
  caseCount?: number;
  blocksPerCase?: number;
  commentsPerCase?: number;
  mutationsPerCase?: number;
}

interface Block {
  id: string;
  text: string;
}

interface TrackedComment {
  id: string;
  sourceLine: number;
  selectedText: string;
  targetBlockId?: string;
}

interface RenderedDocument {
  text: string;
  ranges: Map<string, EvaluationRange>;
}

const MUTATION_TYPES: EvaluationMutation["type"][] = [
  "insert-block",
  "delete-block",
  "move-block",
  "rewrite-block",
  "duplicate-block",
  "swap-blocks",
  "whitespace-block",
  "split-block",
  "merge-blocks",
  "rename-heading",
];

export function generateEvaluationCases(
  options: GenerateCasesOptions,
): EvaluationCase[] {
  const caseCount = positiveInteger(options.caseCount ?? 10, "caseCount");
  const blocksPerCase = positiveInteger(
    options.blocksPerCase ?? 12,
    "blocksPerCase",
  );
  const commentsPerCase = positiveInteger(
    options.commentsPerCase ?? 4,
    "commentsPerCase",
  );
  const mutationsPerCase = positiveInteger(
    options.mutationsPerCase ?? 5,
    "mutationsPerCase",
  );
  const seed = unsignedSeed(options.seed);

  return Array.from({ length: caseCount }, (_, index) =>
    generateCase({
      seed: (seed + index) >>> 0,
      blocksPerCase,
      commentsPerCase,
      mutationsPerCase,
    })
  );
}

function generateCase(options: {
  seed: number;
  blocksPerCase: number;
  commentsPerCase: number;
  mutationsPerCase: number;
}): EvaluationCase {
  const random = new SeededRandom(options.seed);
  const sourceBlocks = createSourceBlocks(options.seed, options.blocksPerCase);
  const source = renderBlocks(sourceBlocks);
  const trackedComments = selectComments(
    sourceBlocks,
    source,
    options.commentsPerCase,
    random,
  );
  const targetBlocks = sourceBlocks.map((block) => ({ ...block }));
  const operations: EvaluationMutation[] = [];
  let nextBlockNumber = sourceBlocks.length + 1;

  for (let index = 0; index < options.mutationsPerCase; index += 1) {
    const preferredType = random.pick(MUTATION_TYPES);
    const operation = applyMutation(
      preferredType,
      targetBlocks,
      trackedComments,
      random,
      () => `generated-${options.seed}-block-${nextBlockNumber++}`,
    );
    operations.push(operation);
  }

  const target = renderBlocks(targetBlocks);
  const comments = trackedComments.map((comment) =>
    createEvaluationComment(comment, targetBlocks, target)
  );
  const categories = [
    "generated",
    ...new Set(operations.map((operation) => operation.type)),
  ];

  return {
    id: `generated-${options.seed}`,
    description:
      `Seeded mutation case ${options.seed} with ${operations.length} operations.`,
    categories,
    source: { text: source.text },
    target: { text: target.text },
    generation: {
      generator_version: 1,
      seed: options.seed,
      blocks_per_case: options.blocksPerCase,
      comments_per_case: Math.min(
        options.commentsPerCase,
        options.blocksPerCase,
      ),
      operations,
    },
    comments,
  };
}

function createSourceBlocks(seed: number, count: number): Block[] {
  return Array.from({ length: count }, (_, index) => {
    const number = index + 1;
    return {
      id: `generated-${seed}-block-${number}`,
      text: number % 4 === 1
        ? `## Section ${number} for seed ${seed}`
        : `Paragraph ${number} describes behavior token-${seed}-${number}.`,
    };
  });
}

function selectComments(
  blocks: Block[],
  rendered: RenderedDocument,
  requestedCount: number,
  random: SeededRandom,
): TrackedComment[] {
  const available = blocks.map((_, index) => index);
  random.shuffle(available);

  return available
    .slice(0, Math.min(requestedCount, blocks.length))
    .sort((left, right) => left - right)
    .map((blockIndex, commentIndex) => {
      const block = blocks[blockIndex];
      const range = rendered.ranges.get(block.id);
      if (!range) throw new Error(`Missing source range for ${block.id}.`);
      return {
        id: `generated-comment-${commentIndex + 1}`,
        sourceLine: range.line,
        selectedText: block.text,
        targetBlockId: block.id,
      };
    });
}

function applyMutation(
  preferredType: EvaluationMutation["type"],
  blocks: Block[],
  comments: TrackedComment[],
  random: SeededRandom,
  nextBlockId: () => string,
): EvaluationMutation {
  if (preferredType === "insert-block") {
    const id = nextBlockId();
    const position = random.nextInt(blocks.length + 1);
    blocks.splice(position, 0, {
      id,
      text: `Inserted paragraph ${id} describes new material.`,
    });
    return { type: "insert-block", block_ids: [id] };
  }

  if (preferredType === "delete-block" && blocks.length > 1) {
    const index = random.nextInt(blocks.length);
    const [removed] = blocks.splice(index, 1);
    for (const comment of comments) {
      if (comment.targetBlockId === removed.id) {
        delete comment.targetBlockId;
      }
    }
    return { type: "delete-block", block_ids: [removed.id] };
  }

  if (preferredType === "move-block" && blocks.length > 1) {
    const from = random.nextInt(blocks.length);
    let to = random.nextInt(blocks.length);
    if (to === from) to = (to + 1) % blocks.length;
    const [moved] = blocks.splice(from, 1);
    blocks.splice(to, 0, moved);
    return { type: "move-block", block_ids: [moved.id] };
  }

  if (preferredType === "rewrite-block") {
    const block = random.pick(blocks);
    block.text = rewriteFirstWord(block.text);
    return { type: "rewrite-block", block_ids: [block.id] };
  }

  if (preferredType === "duplicate-block") {
    const source = random.pick(blocks);
    const duplicateId = nextBlockId();
    const sourceIndex = blocks.indexOf(source);
    blocks.splice(sourceIndex + 1, 0, {
      id: duplicateId,
      text: source.text,
    });
    return {
      type: "duplicate-block",
      block_ids: [source.id, duplicateId],
    };
  }

  if (preferredType === "swap-blocks" && blocks.length > 1) {
    const first = random.nextInt(blocks.length);
    let second = random.nextInt(blocks.length);
    if (first === second) second = (second + 1) % blocks.length;
    [blocks[first], blocks[second]] = [blocks[second], blocks[first]];
    return {
      type: "swap-blocks",
      block_ids: [blocks[second].id, blocks[first].id],
    };
  }

  if (preferredType === "whitespace-block") {
    const block = random.pick(blocks);
    block.text = block.text.replace(/ /g, "  ");
    return { type: "whitespace-block", block_ids: [block.id] };
  }

  if (preferredType === "split-block") {
    const candidates = blocks.filter((block) => block.text.includes(" "));
    const block = random.pick(candidates.length > 0 ? candidates : blocks);
    const splitAt = splitPosition(block.text);
    block.text = `${block.text.slice(0, splitAt)}\n\n${block.text.slice(splitAt + 1)}`;
    return { type: "split-block", block_ids: [block.id] };
  }

  if (preferredType === "merge-blocks" && blocks.length > 1) {
    const firstIndex = random.nextInt(blocks.length - 1);
    const first = blocks[firstIndex];
    const [second] = blocks.splice(firstIndex + 1, 1);
    first.text = `${first.text} ${second.text}`;
    for (const comment of comments) {
      if (comment.targetBlockId === second.id) {
        comment.targetBlockId = first.id;
      }
    }
    return { type: "merge-blocks", block_ids: [first.id, second.id] };
  }

  if (preferredType === "rename-heading") {
    const headings = blocks.filter((block) => block.text.startsWith("#"));
    if (headings.length > 0) {
      const heading = random.pick(headings);
      heading.text = heading.text.replace("Section", "Topic");
      return { type: "rename-heading", block_ids: [heading.id] };
    }
  }

  return applyMutation(
    "insert-block",
    blocks,
    comments,
    random,
    nextBlockId,
  );
}

function createEvaluationComment(
  tracked: TrackedComment,
  targetBlocks: Block[],
  target: RenderedDocument,
): EvaluationComment {
  if (!tracked.targetBlockId) {
    return {
      id: tracked.id,
      anchor: {
        line: tracked.sourceLine,
        selected_text: tracked.selectedText,
      },
      expected: {
        status: "orphaned",
        rationale: "The semantic source block was deleted.",
      },
    };
  }

  const targetBlock = targetBlocks.find(
    (block) => block.id === tracked.targetBlockId,
  );
  const blockRange = target.ranges.get(tracked.targetBlockId);
  if (!targetBlock || !blockRange) {
    throw new Error(`Missing target block ${tracked.targetBlockId}.`);
  }

  const exactIndex = targetBlock.text.indexOf(tracked.selectedText);
  const exact = exactIndex >= 0;
  const range = exact
    ? exactRangeWithinBlock(blockRange.line, targetBlock.text, tracked.selectedText, exactIndex)
    : blockRange;

  return {
    id: tracked.id,
    anchor: {
      line: tracked.sourceLine,
      selected_text: tracked.selectedText,
    },
    expected: {
      status: exact ? "anchored" : "fuzzy",
      ranges: [range],
      rationale: exact
        ? "The original selection remains inside its semantic block."
        : "The semantic block remains but its selected text changed.",
    },
  };
}

function exactRangeWithinBlock(
  blockLine: number,
  blockText: string,
  selectedText: string,
  index: number,
): EvaluationRange {
  const linesBefore = blockText.slice(0, index).split("\n").length - 1;
  const selectedLines = selectedText.split("\n").length;
  const line = blockLine + linesBefore;
  return {
    line,
    end_line: line + selectedLines - 1,
  };
}

function renderBlocks(blocks: Block[]): RenderedDocument {
  const ranges = new Map<string, EvaluationRange>();
  let line = 1;

  for (const block of blocks) {
    const lineCount = block.text.split("\n").length;
    ranges.set(block.id, {
      line,
      end_line: line + lineCount - 1,
    });
    line += lineCount + 1;
  }

  return {
    text: `${blocks.map((block) => block.text).join("\n\n")}\n`,
    ranges,
  };
}

function rewriteFirstWord(text: string): string {
  return text.replace(/^(\W*)([\p{L}\p{N}]+)/u, "$1$2-revised");
}

function splitPosition(text: string): number {
  const midpoint = Math.floor(text.length / 2);
  const after = text.indexOf(" ", midpoint);
  if (after >= 0) return after;
  const before = text.lastIndexOf(" ", midpoint);
  return before >= 0 ? before : midpoint;
}

function positiveInteger(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error(`${name} must be a positive integer.`);
  }
  return value;
}

function unsignedSeed(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0 || value > 0xffffffff) {
    throw new Error("seed must be an integer between 0 and 4294967295.");
  }
  return value >>> 0;
}

class SeededRandom {
  private state: number;

  constructor(seed: number) {
    this.state = seed === 0 ? 0x9e3779b9 : seed >>> 0;
  }

  nextInt(maxExclusive: number): number {
    if (!Number.isSafeInteger(maxExclusive) || maxExclusive < 1) {
      throw new Error("Random upper bound must be a positive integer.");
    }
    return Math.floor(this.next() * maxExclusive);
  }

  pick<T>(values: T[]): T {
    if (values.length === 0) throw new Error("Cannot pick from an empty array.");
    return values[this.nextInt(values.length)];
  }

  shuffle<T>(values: T[]): void {
    for (let index = values.length - 1; index > 0; index -= 1) {
      const other = this.nextInt(index + 1);
      [values[index], values[other]] = [values[other], values[index]];
    }
  }

  private next(): number {
    let value = this.state;
    value ^= value << 13;
    value ^= value >>> 17;
    value ^= value << 5;
    this.state = value >>> 0;
    return this.state / 0x100000000;
  }
}
