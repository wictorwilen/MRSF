/**
 * @mrsf/marp-mrsf — Console Demo
 *
 * Renders architecture.md as a two-page Marpit deck with MRSF comments.
 * Run: npx tsx demo-marp.ts
 */

import { readFileSync } from "node:fs";
import { Marpit } from "@marp-team/marpit";
import { mrsfPlugin } from "@mrsf/marp-mrsf";
import { parseSidecarContent } from "@mrsf/cli";

const source = readFileSync(new URL("./architecture.md", import.meta.url), "utf-8");
const sidecarRaw = readFileSync(new URL("./architecture.md.review.yaml", import.meta.url), "utf-8");

const marpit = new Marpit();
marpit.use(mrsfPlugin, {
  comments: parseSidecarContent(sidecarRaw, "architecture.md.review.yaml"),
  interactive: true,
});

const { html } = marpit.render(source);

console.log();
console.log("@mrsf/marp-mrsf — Console Demo");
console.log("──────────────────────────────");
console.log(typeof html === "string" ? html : html.join("\n"));
console.log("──────────────────────────────");