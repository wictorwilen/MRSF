import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Command } from "commander";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { registerAdd } from "../commands/add.js";
import { parseSidecar, readDocumentLines } from "../lib/parser.js";
import { reanchorComment } from "../lib/reanchor.js";

interface SelectionCase {
  name: string;
  text: string;
  line: number;
  end_line?: number;
  start_column?: number;
  end_column?: number;
  selected_text: string;
}

const cases: SelectionCase[] = JSON.parse(await fs.readFile(
  new URL("../../../evaluation/reanchor/column-conformance.json", import.meta.url),
  "utf-8",
));

describe("add selection conformance", () => {
  let directory: string;
  beforeEach(async () => {
    directory = await fs.mkdtemp(path.join(os.tmpdir(), "mrsf-add-integration-"));
  });
  afterEach(async () => {
    await fs.rm(directory, { recursive: true, force: true });
  });

  it.each(cases)("$name captures the actual selection and stays anchored", async (testCase) => {
    const documentPath = path.join(directory, "doc.md");
    await fs.writeFile(documentPath, testCase.text);
    const program = new Command()
      .option("--cwd <dir>")
      .option("--quiet");
    registerAdd(program);
    const args = [
      "--cwd", directory, "--quiet", "add", "doc.md",
      "--author", "tester", "--text", "Review", "--line", String(testCase.line),
    ];
    for (const [field, flag] of [
      ["end_line", "--end-line"],
      ["start_column", "--start-column"],
      ["end_column", "--end-column"],
    ] as const) {
      if (testCase[field] != null) args.push(flag, String(testCase[field]));
    }
    await program.parseAsync(args, { from: "user" });
    const doc = await parseSidecar(`${documentPath}.review.yaml`);
    const comment = doc.comments[0];
    expect(comment.selected_text).toBe(testCase.selected_text);
    const result = reanchorComment(comment, await readDocumentLines(documentPath));
    expect(result.status).toBe("anchored");
    expect(result.newLine).toBe(testCase.line);
    if (testCase.start_column != null) {
      expect(result.newStartColumn).toBe(testCase.start_column);
      expect(result.newEndColumn).toBe(testCase.end_column);
    }
  });

  it("preserves explicitly supplied selected text", async () => {
    await fs.writeFile(path.join(directory, "doc.md"), "actual text\n");
    const program = new Command().option("--cwd <dir>").option("--quiet");
    registerAdd(program);
    await program.parseAsync([
      "--cwd", directory, "--quiet", "add", "doc.md",
      "--author", "tester", "--text", "Review", "--line", "1",
      "--selected-text", "original selection",
    ], { from: "user" });
    const doc = await parseSidecar(path.join(directory, "doc.md.review.yaml"));
    expect(doc.comments[0].selected_text).toBe("original selection");
  });
});
