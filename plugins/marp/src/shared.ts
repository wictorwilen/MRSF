import type MarkdownIt from "markdown-it";
import { resolveComments } from "./comments.js";
import type { CommentLoader, MrsfPluginOptions } from "./types.js";
import { installCoreRule } from "./rules/core.js";
import { installRendererRules } from "./rules/renderer.js";

export interface MarpitRenderResult {
  html: string | string[];
  css: string;
  comments?: string[][];
}

export interface MarpitLike {
  render(markdown: string, env?: Record<string, unknown>): MarpitRenderResult;
  use(plugin: (context: unknown, ...params: unknown[]) => unknown, ...params: unknown[]): unknown;
  markdown?: MarkdownIt;
}

export interface MarpitPluginContext {
  marpit?: MarpitLike;
  markdown?: MarkdownIt;
}

export type MrsfMarpPlugin = (
  context: MarpitPluginContext,
  options?: MrsfPluginOptions,
) => void;

const patchedRenderers = new WeakSet<MarpitLike>();

export function installMarkdownMrsfPlugin(
  md: MarkdownIt,
  options: MrsfPluginOptions,
  loader: CommentLoader,
): void {
  installCoreRule(
    md,
    (state) => resolveComments(loader, options, state.env),
    { lineHighlight: options.lineHighlight ?? false },
  );
  installRendererRules(md, {
    dataContainer: options.dataContainer,
    dataElementId: options.dataElementId,
  });
}

export function createMarpPlugin(loader: CommentLoader): MrsfMarpPlugin {
  return function mrsfPlugin(
    context: MarpitPluginContext,
    options: MrsfPluginOptions = {},
  ): void {
    const markdown = context.markdown ?? context.marpit?.markdown;
    if (markdown) {
      installMarkdownMrsfPlugin(markdown, options, loader);
    }

    if (!context.marpit) {
      return;
    }

    patchRender(context.marpit, options);
  };
}

function patchRender(marpit: MarpitLike, options: MrsfPluginOptions): void {
  if (patchedRenderers.has(marpit)) {
    return;
  }

  const originalRender = marpit.render.bind(marpit);
  marpit.render = (markdown: string, env?: Record<string, unknown>): MarpitRenderResult => {
    const result = originalRender(markdown, env);
    const fallbackHtml = Array.isArray(result.html)
      ? originalRender(markdown, { ...(env ?? {}), htmlAsArray: false }).html
      : null;

    return {
      ...result,
      html: normalizeRenderedHtml(result.html, options, typeof fallbackHtml === "string" ? fallbackHtml : null),
    };
  };

  patchedRenderers.add(marpit);
}

const SCRIPT_RE = /<script type="application\/mrsf\+json">[\s\S]*?<\/script>/g;

function normalizeRenderedHtml(
  html: string | string[],
  options: MrsfPluginOptions,
  fallbackHtml: string | null = null,
): string | string[] {
  if (Array.isArray(html)) {
    let payload: string | null = null;

    const pages = html.map((pageHtml, index) => {
      const extracted = extractPayloads(pageHtml);
      if (extracted.payloads.length > 0) {
        payload = extracted.payloads[extracted.payloads.length - 1];
      }

      return annotatePageFragment(extracted.html, index + 1, options);
    });

    if (!payload && fallbackHtml) {
      const fallback = extractPayloads(fallbackHtml);
      payload = fallback.payloads[fallback.payloads.length - 1] ?? null;
    }

    if (payload && pages.length > 0) {
      pages[pages.length - 1] += payload;
    }

    return pages;
  }

  const extracted = extractPayloads(html);
  const annotated = annotateSectionTags(extracted.html, options);

  if (extracted.payloads.length === 0) {
    return annotated;
  }

  const payload = extracted.payloads[extracted.payloads.length - 1];
  return insertPayloadIntoContainer(annotated, payload);
}

function extractPayloads(html: string): { html: string; payloads: string[] } {
  const payloads = html.match(SCRIPT_RE) ?? [];
  return {
    html: html.replace(SCRIPT_RE, ""),
    payloads,
  };
}

function annotatePageFragment(
  html: string,
  pageNumber: number,
  options: MrsfPluginOptions,
): string {
  const attrName = resolvePageAttributeName(options);
  return html.replace(/<([a-zA-Z][\w:-]*)(\s|>)/, `<$1 ${attrName}="${pageNumber}"$2`);
}

function annotateSectionTags(html: string, options: MrsfPluginOptions): string {
  if (html.includes("<svg") && html.includes("data-marpit-svg")) {
    return annotateSvgPageTags(html, options);
  }

  const attrName = resolvePageAttributeName(options);
  let pageNumber = 0;

  return html.replace(/<section(\s|>)/g, (_match, suffix: string) => {
    pageNumber += 1;
    return `<section ${attrName}="${pageNumber}"${suffix}`;
  });
}

function annotateSvgPageTags(html: string, options: MrsfPluginOptions): string {
  const attrName = resolvePageAttributeName(options);
  let pageNumber = 0;

  return html.replace(/<svg\b([^>]*)>/g, (_match, attrs: string) => {
    if (!attrs.includes("data-marpit-svg")) {
      return `<svg${attrs}>`;
    }

    pageNumber += 1;
    return `<svg${attrs} ${attrName}="${pageNumber}">`;
  });
}

function resolvePageAttributeName(_options: MrsfPluginOptions): string {
  return "data-mrsf-page";
}

function insertPayloadIntoContainer(html: string, payload: string): string {
  const closingTagIndex = html.lastIndexOf("</");
  if (closingTagIndex === -1) {
    return html + payload;
  }

  return html.slice(0, closingTagIndex) + payload + html.slice(closingTagIndex);
}
