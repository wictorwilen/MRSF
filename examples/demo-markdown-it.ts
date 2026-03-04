/**
 * @mrsf/markdown-it-mrsf — Console Demo
 *
 * Renders architecture.md with its review sidecar using the markdown-it plugin.
 * Run: npx tsx demo-markdown-it.ts
 */

import { readFileSync } from "node:fs";
import MarkdownIt from "markdown-it";
import { mrsfPlugin } from "@mrsf/markdown-it-mrsf";

const file = "architecture.md";
const source = readFileSync(new URL(file, import.meta.url), "utf-8");

const md = new MarkdownIt();
md.use(mrsfPlugin, {
  documentPath: file,
  cwd: new URL(".", import.meta.url).pathname,
});

const html = md.render(source);

// ── Print results ──────────────────────────────────────────

const badges = (html.match(/mrsf-badge/g) || []).length;
const highlights = (html.match(/mrsf-highlight/g) || []).length;
const tooltips = (html.match(/mrsf-tooltip"/g) || []).length;

console.log();
console.log("@mrsf/markdown-it-mrsf — Console Demo");
console.log("──────────────────────────────────────");
console.log(`Source:  ${file}`);
console.log();
console.log("Rendered HTML:");
console.log("──────────────────────────────────────");
console.log(html);
console.log("──────────────────────────────────────");
console.log(`Summary: ${badges} badges · ${highlights} inline highlights · ${tooltips} tooltips`);
console.log();
