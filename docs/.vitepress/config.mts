import { defineConfig } from "vitepress";
import { withMermaid } from "vitepress-plugin-mermaid";

// Known HTML element names (subset that might appear in docs)
const HTML_TAGS = new Set([
  "a", "abbr", "address", "area", "article", "aside", "audio",
  "b", "base", "bdi", "bdo", "blockquote", "body", "br", "button",
  "canvas", "caption", "cite", "code", "col", "colgroup",
  "data", "datalist", "dd", "del", "details", "dfn", "dialog", "div", "dl", "dt",
  "em", "embed", "fieldset", "figcaption", "figure", "footer", "form",
  "h1", "h2", "h3", "h4", "h5", "h6", "head", "header", "hgroup", "hr", "html",
  "i", "iframe", "img", "input", "ins", "kbd",
  "label", "legend", "li", "link", "main", "map", "mark", "menu", "meta", "meter",
  "nav", "noscript", "object", "ol", "optgroup", "option", "output",
  "p", "param", "picture", "pre", "progress", "q",
  "rp", "rt", "ruby", "s", "samp", "script", "search", "section", "select", "slot",
  "small", "source", "span", "strong", "style", "sub", "summary", "sup",
  "table", "tbody", "td", "template", "textarea", "tfoot", "th", "thead",
  "time", "title", "tr", "track", "u", "ul", "var", "video", "wbr",
]);

// Known Vue component names used in docs (not escaped by escapeNonHtmlTags)
const VUE_COMPONENTS = new Set(["MrsfDemo"]);

/**
 * markdown-it plugin: escape `<word>` patterns that are NOT real HTML tags.
 * This prevents Vue from choking on things like `<document>`, `<name>`, etc.
 */
function escapeNonHtmlTags(md: any) {
  const defaultInline =
    md.renderer.rules.html_inline ||
    ((tokens: any, idx: number) => tokens[idx].content);

  md.renderer.rules.html_inline = (
    tokens: any,
    idx: number,
    options: any,
    env: any,
    self: any,
  ) => {
    const content: string = tokens[idx].content;
    const m = content.match(/^<\/?([a-z][a-z0-9_-]*)\s*\/?>$/i);
    if (m && !HTML_TAGS.has(m[1].toLowerCase()) && !VUE_COMPONENTS.has(m[1])) {
      return content.replace(/</g, "&lt;").replace(/>/g, "&gt;");
    }
    return defaultInline(tokens, idx, options, env, self);
  };
}

export default withMermaid(defineConfig({
  title: "Sidemark (MRSF)",
  description:
    "Sidemark — Markdown Review Sidecar Format. Portable, version-controlled review comments for Markdown.",

  vite: {
    ssr: {
      noExternal: ["@mrsf/markdown-it-mrsf"],
    },
  },

  ignoreDeadLinks: [
    // Links valid on GitHub but not in the docs site
    /MRSF-v1\.0/,
    /LICENSE/,
    /mrsf-review/,
    /\.\.\/examples\//,
  ],

  markdown: {
    config: (md) => {
      md.use(escapeNonHtmlTags);
    },
  },

  head: [
    ["link", { rel: "icon", type: "image/png", sizes: "32x32", href: "/favicon-32x32.png" }],
    ["link", { rel: "icon", type: "image/png", sizes: "16x16", href: "/favicon-16x16.png" }],
    ["link", { rel: "icon", href: "/favicon.ico" }],
    ["link", { rel: "apple-touch-icon", sizes: "180x180", href: "/apple-touch-icon.png" }],
    ["link", { rel: "manifest", href: "/site.webmanifest" }],
  ],

  themeConfig: {
    logo: "/android-chrome-192x192.png",
    siteTitle: "Sidemark",

    nav: [
      { text: "Guide", link: "/guide/", activeMatch: "/guide/" },
      {
        text: "Specification",
        link: "/specification",
        activeMatch: "/specification",
      },
      { text: "CLI", link: "/cli/", activeMatch: "/cli/" },
      { text: "VS Code", link: "/vscode/", activeMatch: "/vscode/" },
      { text: "MCP Server", link: "/mcp/", activeMatch: "/mcp/" },
      {
        text: "Schema",
        link: "https://github.com/wictorwilen/MRSF/blob/main/mrsf.schema.json",
      },
    ],

    sidebar: {
      "/guide/": [
        {
          text: "Getting Started",
          items: [
            { text: "What is MRSF?", link: "/guide/" },
            { text: "Quick Start", link: "/guide/quick-start" },
            { text: "Examples", link: "/guide/examples" },
            { text: "Agent Skill", link: "/guide/agent-skill" },
            { text: "markdown-it Plugin", link: "/guide/markdown-it" },
            { text: "rehype Plugin", link: "/guide/rehype" },
            { text: "FAQ", link: "/guide/faq" },
          ],
        },
      ],
      "/cli/": [
        {
          text: "CLI Reference",
          items: [{ text: "Overview", link: "/cli/" }],
        },
      ],
      "/mcp/": [
        {
          text: "MCP Server",
          items: [{ text: "Overview", link: "/mcp/" }],
        },
      ],
      "/vscode/": [
        {
          text: "VS Code Extension",
          items: [{ text: "Overview", link: "/vscode/" }],
        },
      ],
    },

    socialLinks: [
      { icon: "github", link: "https://github.com/wictorwilen/MRSF" },
    ],

    footer: {
      message: "Released under the MIT License.",
      copyright: "Copyright © 2026 Wictor Wilén",
    },

    search: {
      provider: "local",
    },

    editLink: {
      pattern: "https://github.com/wictorwilen/MRSF/edit/main/docs/:path",
      text: "Edit this page on GitHub",
    },
  },
}));
