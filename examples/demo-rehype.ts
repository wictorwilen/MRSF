/**
 * @mrsf/rehype-mrsf — Console Demo
 *
 * Renders architecture.md with its review sidecar using the rehype plugin.
 * Run: npx tsx demo-rehype.ts
 */

import { readFileSync } from "node:fs";
import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkRehype from "remark-rehype";
import rehypeStringify from "rehype-stringify";
import { rehypeMrsf } from "@mrsf/rehype-mrsf";

const file = "architecture.md";
const source = readFileSync(new URL(file, import.meta.url), "utf-8");

const result = await unified()
  .use(remarkParse)
  .use(remarkRehype)
  .use(rehypeMrsf, {
    documentPath: file,
    cwd: new URL(".", import.meta.url).pathname,
  })
  .use(rehypeStringify, { allowDangerousHtml: true })
  .process(source);

const html = String(result);

// ── Print results ──────────────────────────────────────────

const badges = (html.match(/mrsf-badge/g) || []).length;
const highlights = (html.match(/mrsf-highlight/g) || []).length;
const tooltips = (html.match(/mrsf-tooltip"/g) || []).length;

console.log();
console.log("@mrsf/rehype-mrsf — Console Demo");
console.log("──────────────────────────────────────");
console.log(`Source:  ${file}`);
console.log();
console.log("Rendered HTML:");
console.log("──────────────────────────────────────");
console.log(html);
console.log("──────────────────────────────────────");
console.log(`Summary: ${badges} badges · ${highlights} inline highlights · ${tooltips} tooltips`);
console.log();
