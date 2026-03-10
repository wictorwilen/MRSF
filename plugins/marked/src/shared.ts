/**
 * Shared logic for @mrsf/marked-mrsf.
 */

import { Marked, type MarkedExtension, type Token, type Tokens } from "marked";
import { resolveComments } from "@mrsf/plugin-shared";
import type { CommentLoader, CommentThread, LineMap, MrsfPluginOptions } from "./types.js";

type TokenWithMrsf = Token & {
  mrsfStartLine?: number;
  mrsfEndLine?: number;
  mrsfLine?: number;
  mrsfLineHighlight?: boolean;
  mrsfHeaderLine?: number;
  mrsfRowLines?: number[];
};

type ListItemWithMrsf = Tokens.ListItem & {
  mrsfStartLine?: number;
  mrsfEndLine?: number;
  mrsfLine?: number;
  mrsfLineHighlight?: boolean;
};

const markedRuntime = new Marked();
const BaseRenderer = markedRuntime.Renderer;

const blockquoteRenderer = BaseRenderer.prototype.blockquote;
const codeRenderer = BaseRenderer.prototype.code;
const headingRenderer = BaseRenderer.prototype.heading;
const hrRenderer = BaseRenderer.prototype.hr;
const listItemRenderer = BaseRenderer.prototype.listitem;
const paragraphRenderer = BaseRenderer.prototype.paragraph;
const tableRenderer = BaseRenderer.prototype.table;

function countLines(value: string): number {
  if (!value) return 1;
  return value.split("\n").length;
}

function trimTrailingBlankLines(value: string): string {
  return value.replace(/\n+$/g, "");
}

function firstCommentLine(lineMap: LineMap, startLine: number, endLine: number): number {
  for (let line = startLine; line <= endLine; line++) {
    const threads = lineMap.get(line);
    if (threads && threads.length > 0) {
      return line;
    }
  }
  return startLine;
}

function hasCommentInRange(lineMap: LineMap, startLine: number, endLine: number): boolean {
  for (let line = startLine; line <= endLine; line++) {
    const threads = lineMap.get(line);
    if (threads && threads.length > 0) {
      return true;
    }
  }
  return false;
}

function stampBlock(token: TokenWithMrsf, startLine: number, lineMap: LineMap): number {
  const raw = typeof token.raw === "string" ? token.raw : "";
  const semantic = trimTrailingBlankLines(raw);
  const endLine = startLine + countLines(semantic) - 1;

  token.mrsfStartLine = startLine;
  token.mrsfEndLine = endLine;
  token.mrsfLine = firstCommentLine(lineMap, startLine, endLine);
  token.mrsfLineHighlight = hasCommentInRange(lineMap, startLine, endLine);

  if (token.type === "table") {
    const tableToken = token as Tokens.Table & TokenWithMrsf;
    tableToken.mrsfHeaderLine = startLine;
    tableToken.mrsfRowLines = tableToken.rows.map((_, index) => startLine + 2 + index);
  }

  return startLine + countLines(raw) - 1;
}

function stampListItems(token: Tokens.List & TokenWithMrsf, lineMap: LineMap): void {
  let currentLine = token.mrsfStartLine ?? 1;

  for (const item of token.items as ListItemWithMrsf[]) {
    const raw = typeof item.raw === "string" ? item.raw : "";
    const semantic = trimTrailingBlankLines(raw);
    const endLine = currentLine + countLines(semantic) - 1;
    item.mrsfStartLine = currentLine;
    item.mrsfEndLine = endLine;
    item.mrsfLine = firstCommentLine(lineMap, currentLine, endLine);
    item.mrsfLineHighlight = hasCommentInRange(lineMap, currentLine, endLine);

    stampTokens(item.tokens as TokenWithMrsf[], currentLine, lineMap);
    currentLine += countLines(raw) - 1;
  }
}

function stampTokens(tokens: TokenWithMrsf[], startLine: number, lineMap: LineMap): number {
  let currentLine = startLine;

  for (const token of tokens) {
    currentLine = stampBlock(token, currentLine, lineMap);

    if (token.type === "blockquote") {
      stampTokens((token as Tokens.Blockquote).tokens as TokenWithMrsf[], token.mrsfStartLine ?? currentLine, lineMap);
    } else if (token.type === "list") {
      stampListItems(token as Tokens.List & TokenWithMrsf, lineMap);
    }
  }

  return currentLine;
}

function escapeAttribute(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function buildAttrs(token: { mrsfStartLine?: number; mrsfEndLine?: number; mrsfLine?: number; mrsfLineHighlight?: boolean }, lineHighlight: boolean): string {
  if (token.mrsfStartLine == null || token.mrsfEndLine == null || token.mrsfLine == null) {
    return "";
  }

  const attrs = [
    `data-mrsf-line="${token.mrsfLine}"`,
    `data-mrsf-start-line="${token.mrsfStartLine}"`,
    `data-mrsf-end-line="${token.mrsfEndLine}"`,
  ];

  if (lineHighlight && token.mrsfLineHighlight) {
    attrs.push('class="mrsf-line-highlight"');
  }

  return attrs.length > 0 ? " " + attrs.join(" ") : "";
}

function addAttrs(html: string, attrs: string, tagName?: string): string {
  if (!attrs) return html;
  const pattern = tagName
    ? new RegExp(`^<${tagName}(?=[\\s>])`, "i")
    : /^<([a-z0-9-]+)(?=[\s>])/i;
  return html.replace(pattern, (match) => match + attrs);
}

function flattenThreads(lineMap: LineMap): CommentThread[] {
  const threads: CommentThread[] = [];
  for (const lineThreads of lineMap.values()) {
    threads.push(...lineThreads);
  }
  return threads;
}

function createDataContainer(options: MrsfPluginOptions, threads: CommentThread[]): string {
  const payload = JSON.stringify({ threads });
  if (options.dataContainer === "element") {
    const elementId = options.dataElementId || "mrsf-comment-data";
    return `<div id="${escapeAttribute(elementId)}" data-mrsf-json="${escapeAttribute(payload)}" aria-hidden="true"></div>`;
  }

  return `<script type="application/mrsf+json">${payload.replace(/</g, "\\u003c")}</script>`;
}

function renderAnnotatedTable(
  this: { parser: { parseInline: (tokens: Token[]) => string } },
  token: Tokens.Table & TokenWithMrsf,
  lineMap: LineMap,
  lineHighlight: boolean,
): string {
  const baseHtml = tableRenderer.call(this, token);
  const rowLines = [token.mrsfHeaderLine, ...(token.mrsfRowLines ?? [])];
  let rowIndex = 0;

  return baseHtml.replace(/<tr>/g, () => {
    const line = rowLines[rowIndex++];
    if (line == null) return "<tr>";

    const hasComment = hasCommentInRange(lineMap, line, line);

    const attrs = [
      `data-mrsf-line="${line}"`,
      `data-mrsf-start-line="${line}"`,
      `data-mrsf-end-line="${line}"`,
    ];
    if (lineHighlight && hasComment) {
      attrs.push('class="mrsf-line-highlight"');
    }
    return `<tr ${attrs.join(" ")}>`;
  });
}

export function createMarkedMrsf(loader: CommentLoader) {
  return function markedMrsf(options: MrsfPluginOptions = {}): MarkedExtension {
    let currentLineMap: LineMap | null = null;
    let currentThreads: CommentThread[] = [];

    return {
      hooks: {
        processAllTokens(tokens) {
          const result = resolveComments(loader, options);
          if (!result) {
            currentLineMap = null;
            currentThreads = [];
            return tokens;
          }

          currentLineMap = result.lineMap;
          currentThreads = flattenThreads(result.lineMap);
          stampTokens(tokens as TokenWithMrsf[], 1, result.lineMap);
          return tokens;
        },
        postprocess(html) {
          if (!currentLineMap || currentThreads.length === 0) {
            return html;
          }
          return html + createDataContainer(options, currentThreads);
        },
      },
      renderer: {
        heading(token) {
          return addAttrs(headingRenderer.call(this, token), buildAttrs(token as TokenWithMrsf, options.lineHighlight ?? false), `h${token.depth}`);
        },
        paragraph(token) {
          return addAttrs(paragraphRenderer.call(this, token), buildAttrs(token as TokenWithMrsf, options.lineHighlight ?? false), "p");
        },
        code(token) {
          return addAttrs(codeRenderer.call(this, token), buildAttrs(token as TokenWithMrsf, options.lineHighlight ?? false), "pre");
        },
        blockquote(token) {
          return addAttrs(blockquoteRenderer.call(this, token), buildAttrs(token as TokenWithMrsf, options.lineHighlight ?? false), "blockquote");
        },
        listitem(token) {
          return addAttrs(listItemRenderer.call(this, token), buildAttrs(token as ListItemWithMrsf, options.lineHighlight ?? false), "li");
        },
        hr(token) {
          return addAttrs(hrRenderer.call(this, token), buildAttrs(token as TokenWithMrsf, options.lineHighlight ?? false), "hr");
        },
        table(token) {
          return renderAnnotatedTable.call(
            this,
            token as Tokens.Table & TokenWithMrsf,
            currentLineMap ?? new Map(),
            options.lineHighlight ?? false,
          );
        },
      },
    };
  };
}