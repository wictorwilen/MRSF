import "@mrsf/marp-mrsf/style.css";

type DemoComment = {
  id: string;
  author: string;
  timestamp: string;
  text: string;
  resolved: boolean;
  line?: number;
  x_page?: number;
  end_line?: number;
  start_column?: number;
  end_column?: number;
  selected_text?: string;
  reply_to?: string;
  severity?: "low" | "medium" | "high";
  type?: string;
};

type DemoSidecar = {
  mrsf_version: string;
  document: string;
  comments: DemoComment[];
};

type SubmitAction = "add" | "edit" | "reply" | "resolve" | "unresolve" | "delete";

type DemoSubmitDetail = {
  action: SubmitAction;
  commentId: string | null;
  text: string;
  type?: string | null;
  severity?: "low" | "medium" | "high" | null;
  x_page?: number | null;
  line?: number | null;
  end_line?: number | null;
  start_column?: number | null;
  end_column?: number | null;
  selection_text?: string | null;
};

type ActivityEntry = {
  id: string;
  message: string;
  detail: string;
  timestamp: string;
};

const markdownSource = `---
theme: default
paginate: true
---

# MRSF Marp Demo

This slide shows how review comments render in a Marp deck.

---

## Inline review

The shared controller can render line comments and selected text comments.

- Toggle inline SVG mode to inspect page metadata.
- Hover the gutter markers to inspect threads.

---

## Workflow note

Hosts should listen for mrsf:* events and persist sidecar changes themselves.
`;

const initialSidecarData: DemoSidecar = {
  mrsf_version: "1.0",
  document: "marp-demo.md",
  comments: [
    {
      id: "marp-1",
      author: "Demo Reviewer",
      timestamp: "2026-03-25T12:00:00Z",
      text: "Opening slide content is a good place for a summary note.",
      resolved: false,
      line: 6,
      severity: "medium",
      type: "note",
    },
    {
      id: "marp-2",
      author: "Design Review",
      timestamp: "2026-03-25T12:04:00Z",
      text: "This selection should show inline tooltip behavior.",
      resolved: false,
      line: 12,
      start_column: 33,
      end_column: 73,
      selected_text: "line comments and selected text comments",
      severity: "low",
      type: "suggestion",
    },
    {
      id: "marp-3",
      author: "Architecture Review",
      timestamp: "2026-03-25T12:08:00Z",
      text: "Persistence still belongs to the host application.",
      resolved: false,
      line: 19,
      severity: "high",
      type: "issue",
    },
    {
      id: "marp-5",
      author: "Presentation Review",
      timestamp: "2026-03-25T12:10:00Z",
      text: "This whole slide could use a shorter title and fewer bullets.",
      resolved: false,
      x_page: 2,
      severity: "medium",
      type: "suggestion",
    },
    {
      id: "marp-4",
      author: "Product Review",
      timestamp: "2026-03-25T12:12:00Z",
      text: "A reply keeps the thread behavior visible in the presentation demo.",
      resolved: false,
      reply_to: "marp-2",
      line: 12,
      start_column: 33,
      end_column: 73,
      selected_text: "line comments and selected text comments",
      type: "reply",
    },
  ],
};

let sidecarState = cloneSidecar(initialSidecarData);
let activityEntries: ActivityEntry[] = [
  {
    id: "initial",
    message: "Interactive review host ready",
    detail: "Select text to add an inline comment, or use the gutter buttons to open thread actions.",
    timestamp: new Date().toISOString(),
  },
];

const deckHost = document.getElementById("deck-host");
const deckStatus = document.getElementById("deck-status");
const renderMode = document.getElementById("render-mode");
const pageCount = document.getElementById("page-count");
const threadCount = document.getElementById("thread-count");
const summary = document.getElementById("summary");
const pageActions = document.getElementById("page-actions");
const threadGroups = document.getElementById("thread-groups");
const activityLog = document.getElementById("activity-log");
const sidecarOutput = document.getElementById("sidecar-output");
const pageCommentForm = document.getElementById("page-comment-form") as HTMLFormElement | null;
const pageCommentPage = document.getElementById("page-comment-page") as HTMLSelectElement | null;
const pageCommentType = document.getElementById("page-comment-type") as HTMLSelectElement | null;
const pageCommentSeverity = document.getElementById("page-comment-severity") as HTMLSelectElement | null;
const pageCommentText = document.getElementById("page-comment-text") as HTMLTextAreaElement | null;
const pageCommentCancel = document.getElementById("page-comment-cancel") as HTMLButtonElement | null;
const toggleSvg = document.getElementById("toggle-svg") as HTMLButtonElement | null;
const rerender = document.getElementById("rerender") as HTMLButtonElement | null;
const resetDemo = document.getElementById("reset-demo") as HTMLButtonElement | null;

if (
  !deckHost
  || !deckStatus
  || !renderMode
  || !pageCount
  || !threadCount
  || !summary
  || !pageActions
  || !threadGroups
  || !activityLog
  || !sidecarOutput
  || !pageCommentForm
  || !pageCommentPage
  || !pageCommentType
  || !pageCommentSeverity
  || !pageCommentText
  || !pageCommentCancel
  || !toggleSvg
  || !rerender
  || !resetDemo
) {
  throw new Error("Marp demo shell is missing required DOM nodes.");
}

let inlineSvg = false;
let controller: { destroy(): void } | null = null;
let renderVersion = 0;
let activePageComposer: number | null = null;

const slideBreakLines = collectSlideBreakLines(markdownSource);

type MarpRuntime = {
  Marpit: typeof import("@marp-team/marpit").Marpit;
  MrsfController: typeof import("@mrsf/marp-mrsf/controller").MrsfController;
  mrsfPlugin: typeof import("@mrsf/marp-mrsf").mrsfPlugin;
};

let runtimePromise: Promise<MarpRuntime> | null = null;

function loadRuntime(): Promise<MarpRuntime> {
  if (!runtimePromise) {
    runtimePromise = Promise.all([
      import("@marp-team/marpit"),
      import("@mrsf/marp-mrsf/controller"),
      import("@mrsf/marp-mrsf"),
    ]).then(([marpModule, controllerModule, pluginModule]) => ({
      Marpit: marpModule.Marpit,
      MrsfController: controllerModule.MrsfController,
      mrsfPlugin: pluginModule.mrsfPlugin,
    }));
  }

  return runtimePromise;
}

async function renderDeck(): Promise<void> {
  const version = ++renderVersion;
  deckStatus.textContent = "Loading runtime";

  const { Marpit, MrsfController, mrsfPlugin } = await loadRuntime();
  if (version !== renderVersion) {
    return;
  }

  const marp = new Marpit({ inlineSVG: inlineSvg });
  marp.use(mrsfPlugin, {
    comments: sidecarState,
    interactive: true,
    inlineHighlights: true,
    lineHighlight: true,
  });

  const { html, css } = marp.render(markdownSource);
  deckHost.innerHTML = `<style>${css}</style>${html}`;

  controller?.destroy();
  controller = new MrsfController(deckHost, {
    interactive: true,
    inlineHighlights: true,
  });

  const pageSelector = inlineSvg ? "svg[data-mrsf-page]" : "section[data-mrsf-page]";
  const pages = deckHost.querySelectorAll(pageSelector).length;
  const payloadMatches = typeof html === "string" ? html.match(/application\/mrsf\+json/g) ?? [] : [];
  const rootComments = sidecarState.comments.filter((comment) => !comment.reply_to);
  const lineThreads = rootComments.filter((comment) => comment.line != null);
  const pageThreads = rootComments.filter((comment) => comment.x_page != null && comment.line == null);
  const openComments = sidecarState.comments.filter((comment) => !comment.resolved).length;
  const inlineComments = rootComments.filter((comment) => Boolean(comment.selected_text)).length;

  renderMode.textContent = inlineSvg ? "Inline SVG mode" : "HTML mode";
  pageCount.textContent = `${pages} pages`;
  threadCount.textContent = `${rootComments.length} threads`;
  deckStatus.textContent = inlineSvg ? "Rendered as SVG" : "Rendered as HTML";
  summary.innerHTML = [
    '<div class="summary-section">',
    '<h3 class="summary-heading">Render</h3>',
    `<div class="summary-row"><span class="summary-label">Container selector</span><strong>${pageSelector}</strong></div>`,
    `<div class="summary-row"><span class="summary-label">Serialized payloads</span><strong>${payloadMatches.length}</strong></div>`,
    `<div class="summary-row"><span class="summary-label">Interaction model</span><strong>local host state</strong></div>`,
    '</div>',
    '<div class="summary-section">',
    '<h3 class="summary-heading">Threads</h3>',
    `<div class="summary-row"><span class="summary-label">All threads</span><strong>${rootComments.length}</strong></div>`,
    `<div class="summary-row"><span class="summary-label">Line-anchored</span><strong>${lineThreads.length}</strong></div>`,
    `<div class="summary-row"><span class="summary-label">Page-scoped</span><strong>${pageThreads.length}</strong></div>`,
    `<div class="summary-row"><span class="summary-label">Open comments</span><strong>${openComments}</strong></div>`,
    `<div class="summary-row"><span class="summary-label">Inline highlights</span><strong>${inlineComments}</strong></div>`,
    '</div>',
  ].join("");
  renderPageActions(pages, pageThreads);
  renderThreadGroups(lineThreads, pageThreads);
  sidecarOutput.textContent = JSON.stringify(sidecarState, null, 2);
  activityLog.innerHTML = activityEntries.map((entry) => {
    const time = new Date(entry.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
    return [
      '<div class="activity-entry">',
      `<div class="activity-meta">${time}</div>`,
      `<div class="activity-message"><strong>${escapeHtml(entry.message)}</strong></div>`,
      `<div class="activity-meta">${escapeHtml(entry.detail)}</div>`,
      "</div>",
    ].join("");
  }).join("");
}

function cloneSidecar(source: DemoSidecar): DemoSidecar {
  return {
    ...source,
    comments: source.comments.map((comment) => ({ ...comment })),
  };
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function nextCommentId(): string {
  return typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `demo-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function pushActivity(message: string, detail: string): void {
  activityEntries = [
    {
      id: nextCommentId(),
      message,
      detail,
      timestamp: new Date().toISOString(),
    },
    ...activityEntries,
  ].slice(0, 10);
}

function collectSlideBreakLines(markdown: string): number[] {
  const lines = markdown.split(/\r?\n/);
  const breaks: number[] = [];
  let index = 0;

  if (lines[0]?.trim() === "---") {
    index = 1;
    while (index < lines.length && lines[index].trim() !== "---") {
      index += 1;
    }
    index += 1;
  }

  for (; index < lines.length; index += 1) {
    if (lines[index].trim() === "---") {
      breaks.push(index + 1);
    }
  }

  return breaks;
}

function inferPageForLine(line: number | null | undefined): number | null {
  if (line == null) {
    return null;
  }

  let page = 1;
  for (const breakLine of slideBreakLines) {
    if (breakLine < line) {
      page += 1;
    }
  }

  return page;
}

function findComment(commentId: string | null): DemoComment | undefined {
  if (!commentId) {
    return undefined;
  }

  return sidecarState.comments.find((comment) => comment.id === commentId);
}

function formatAnchor(
  detail: Pick<DemoSubmitDetail, "line" | "end_line" | "start_column" | "end_column"> & { x_page?: number | null },
): string {
  if (!detail.line) {
    if (detail.x_page != null) {
      return `page ${detail.x_page}`;
    }

    return "document-level";
  }

  const lineSuffix = detail.end_line && detail.end_line !== detail.line
    ? `${detail.line}-${detail.end_line}`
    : `${detail.line}`;
  const columnSuffix = detail.start_column != null && detail.end_column != null
    ? ` cols ${detail.start_column}-${detail.end_column}`
    : "";
  return `line ${lineSuffix}${columnSuffix}`;
}

function createComment(detail: DemoSubmitDetail, overrides: Partial<DemoComment> = {}): DemoComment {
  const base: DemoComment = {
    id: nextCommentId(),
    author: "Demo User",
    timestamp: new Date().toISOString(),
    text: detail.text,
    resolved: false,
  };

  if (detail.line != null) {
    base.line = detail.line;
    base.x_page = inferPageForLine(detail.line) ?? undefined;
  } else if (detail.x_page != null) {
    base.x_page = detail.x_page;
  }
  if (detail.end_line != null && detail.end_line !== detail.line) {
    base.end_line = detail.end_line;
  }
  if (detail.start_column != null) {
    base.start_column = detail.start_column;
  }
  if (detail.end_column != null) {
    base.end_column = detail.end_column;
  }
  if (detail.selection_text) {
    base.selected_text = detail.selection_text;
  }
  if (detail.type) {
    base.type = detail.type;
  }
  if (detail.severity) {
    base.severity = detail.severity;
  }

  return {
    ...base,
    ...overrides,
  };
}

function addComment(detail: DemoSubmitDetail): void {
  const comment = createComment(detail);

  sidecarState.comments.push(comment);
  pushActivity(
    detail.selection_text ? "Added inline comment" : comment.line != null ? "Added line comment" : "Added page comment",
    `${formatCommentAnchor(comment)}${detail.selection_text ? ` on \"${detail.selection_text}\"` : ""}`,
  );
}

function renderPageActions(pages: number, pageThreads: DemoComment[]): void {
  syncPageComposerOptions(pages);
  pageActions.innerHTML = [
    '<div class="page-action-grid">',
    ...Array.from({ length: pages }, (_value, index) => {
      const pageNumber = index + 1;
      const existing = pageThreads.filter((comment) => comment.x_page === pageNumber).length;

      return [
        '<div class="page-action-card">',
        `<div class="page-action-title">Page ${pageNumber}</div>`,
        `<div class="page-action-meta">${existing} page thread${existing === 1 ? "" : "s"}</div>`,
        `<button type="button" data-page-add="${pageNumber}">Add page comment</button>`,
        '</div>',
      ].join("");
    }),
    '</div>',
  ].join("");

  pageCommentForm.hidden = activePageComposer == null;
  if (activePageComposer != null) {
    pageCommentPage.value = String(activePageComposer);
  }
}

function syncPageComposerOptions(pages: number): void {
  const previous = pageCommentPage.value;
  pageCommentPage.innerHTML = Array.from({ length: pages }, (_value, index) => {
    const pageNumber = index + 1;
    return `<option value="${pageNumber}">Page ${pageNumber}</option>`;
  }).join("");

  if (activePageComposer != null && activePageComposer <= pages) {
    pageCommentPage.value = String(activePageComposer);
  } else if (previous && Number(previous) <= pages) {
    pageCommentPage.value = previous;
  }
}

function renderThreadGroups(lineThreads: DemoComment[], pageThreads: DemoComment[]): void {
  threadGroups.innerHTML = [
    renderThreadGroupSection("Page-scoped threads", pageThreads, "page"),
    renderThreadGroupSection("Line-anchored threads", lineThreads, "line"),
  ].join("");
}

function renderThreadGroupSection(
  title: string,
  comments: DemoComment[],
  variant: "page" | "line",
): string {
  return [
    '<section class="thread-group">',
    '<div class="thread-group-header">',
    `<h3 class="thread-group-title">${title}</h3>`,
    `<span class="thread-group-count">${comments.length} thread${comments.length === 1 ? "" : "s"}</span>`,
    '</div>',
    comments.length > 0
      ? `<div class="thread-list">${comments.map((comment) => renderThreadCard(comment, variant)).join("")}</div>`
      : `<div class="thread-empty">No ${variant === "page" ? "page-scoped" : "line-anchored"} threads in the current review state.</div>`,
    '</section>',
  ].join("");
}

function renderThreadCard(comment: DemoComment, variant: "page" | "line"): string {
  const replies = sidecarState.comments.filter((candidate) => candidate.reply_to === comment.id).length;
  const anchor = escapeHtml(formatCommentAnchor(comment));
  const meta = [
    escapeHtml(comment.author),
    comment.resolved ? "resolved" : "open",
    replies > 0 ? `${replies} repl${replies === 1 ? "y" : "ies"}` : "no replies",
  ].join(" · ");
  const classes = [
    'thread-card',
    variant === "page" ? 'thread-card-page' : 'thread-card-line',
    comment.resolved ? 'thread-card-resolved' : '',
  ].filter(Boolean).join(' ');

  return [
    `<article class="${classes}">`,
    '<div class="thread-card-header">',
    `<span class="thread-card-anchor">${anchor}</span>`,
    `<span class="thread-card-meta">${meta}</span>`,
    '</div>',
    `<p class="thread-card-text">${escapeHtml(comment.text)}</p>`,
    '</article>',
  ].join("");
}

function openPageCommentComposer(pageNumber: number): void {
  activePageComposer = pageNumber;
  pageCommentPage.value = String(pageNumber);
  pageCommentForm.hidden = false;
  pageCommentText.focus();
}

function closePageCommentComposer(): void {
  activePageComposer = null;
  pageCommentForm.reset();
  pageCommentForm.hidden = true;
}

function replyToComment(detail: DemoSubmitDetail): void {
  const parent = findComment(detail.commentId);
  if (!parent) {
    pushActivity("Reply skipped", "Parent comment could not be found.");
    return;
  }

  sidecarState.comments.push(createComment(detail, {
    reply_to: parent.id,
    line: parent.line,
    x_page: parent.x_page ?? inferPageForLine(parent.line),
    end_line: parent.end_line,
    start_column: parent.start_column,
    end_column: parent.end_column,
    selected_text: detail.selection_text ?? parent.selected_text,
  }));
  pushActivity("Added reply", `Replied to ${parent.author} on ${formatCommentAnchor(parent)}`);
}

function editComment(detail: DemoSubmitDetail): void {
  const comment = findComment(detail.commentId);
  if (!comment) {
    pushActivity("Edit skipped", "The selected comment no longer exists.");
    return;
  }

  comment.text = detail.text;
  comment.timestamp = new Date().toISOString();
  if (detail.type !== undefined) {
    if (detail.type) {
      comment.type = detail.type;
    } else {
      delete comment.type;
    }
  }
  if (detail.severity !== undefined) {
    if (detail.severity) {
      comment.severity = detail.severity;
    } else {
      delete comment.severity;
    }
  }
  pushActivity("Edited comment", `${comment.author} comment updated at ${formatCommentAnchor(comment)}`);
}

function updateResolvedState(commentId: string | null, resolved: boolean): void {
  const comment = findComment(commentId);
  if (!comment) {
    pushActivity("Status change skipped", "The selected comment no longer exists.");
    return;
  }

  comment.resolved = resolved;
  pushActivity(
    resolved ? "Resolved comment" : "Reopened comment",
    `${comment.author} comment is now ${resolved ? "resolved" : "open"}`,
  );
}

function deleteComment(commentId: string | null): void {
  const target = findComment(commentId);
  if (!target) {
    pushActivity("Delete skipped", "The selected comment no longer exists.");
    return;
  }

  const idsToDelete = new Set<string>([target.id]);
  if (!target.reply_to) {
    for (const comment of sidecarState.comments) {
      if (comment.reply_to === target.id) {
        idsToDelete.add(comment.id);
      }
    }
  }

  sidecarState.comments = sidecarState.comments.filter((comment) => !idsToDelete.has(comment.id));
  pushActivity(
    target.reply_to ? "Deleted reply" : "Deleted thread",
    `${idsToDelete.size} comment${idsToDelete.size === 1 ? "" : "s"} removed from the review state.`,
  );
}

async function applySubmit(detail: DemoSubmitDetail): Promise<void> {
  switch (detail.action) {
    case "add":
      addComment(detail);
      break;
    case "reply":
      replyToComment(detail);
      break;
    case "edit":
      editComment(detail);
      break;
    case "resolve":
      updateResolvedState(detail.commentId, true);
      break;
    case "unresolve":
      updateResolvedState(detail.commentId, false);
      break;
    case "delete":
      deleteComment(detail.commentId);
      break;
  }

  await renderDeck();
}

function formatCommentAnchor(comment: Pick<DemoComment, "line" | "x_page" | "end_line" | "start_column" | "end_column">): string {
  return formatAnchor({
    line: comment.line ?? null,
    x_page: comment.x_page ?? null,
    end_line: comment.end_line ?? null,
    start_column: comment.start_column ?? null,
    end_column: comment.end_column ?? null,
  });
}

document.addEventListener("mrsf:submit", (event) => {
  const customEvent = event as CustomEvent<DemoSubmitDetail>;
  void applySubmit(customEvent.detail);
});

pageActions.addEventListener("click", (event) => {
  const target = event.target as HTMLElement;
  const button = target.closest<HTMLElement>("[data-page-add]");
  if (!button) {
    return;
  }

  const pageNumber = Number(button.dataset.pageAdd);
  if (!Number.isFinite(pageNumber) || pageNumber < 1) {
    return;
  }

  openPageCommentComposer(pageNumber);
});

pageCommentCancel.addEventListener("click", () => {
  closePageCommentComposer();
});

pageCommentForm.addEventListener("submit", (event) => {
  event.preventDefault();

  const text = pageCommentText.value.trim();
  const page = Number(pageCommentPage.value);
  if (!text || !Number.isFinite(page) || page < 1) {
    return;
  }

  const submitDetail: DemoSubmitDetail = {
    action: "add",
    commentId: null,
    text,
    x_page: page,
    type: pageCommentType.value || null,
    severity: (pageCommentSeverity.value as DemoSubmitDetail["severity"]) || null,
    line: null,
    end_line: null,
    start_column: null,
    end_column: null,
    selection_text: null,
  };

  closePageCommentComposer();
  void applySubmit(submitDetail);
});

document.addEventListener("mrsf:navigate", (event) => {
  const customEvent = event as CustomEvent<{ commentId?: string | null; line?: number | null }>;
  const line = customEvent.detail.line;
  if (line) {
    const target = deckHost.querySelector<HTMLElement>(`[data-mrsf-line="${line}"]`);
    target?.scrollIntoView({ block: "center", behavior: "smooth" });
    return;
  }

  const comment = findComment(customEvent.detail.commentId ?? null);
  if (comment?.x_page != null) {
    const target = deckHost.querySelector<HTMLElement>(`[data-mrsf-page="${comment.x_page}"]`);
    target?.scrollIntoView({ block: "center", behavior: "smooth" });
  }
});

toggleSvg.addEventListener("click", () => {
  inlineSvg = !inlineSvg;
  pushActivity(
    "Toggled render mode",
    inlineSvg ? "Deck now renders as inline SVG pages." : "Deck now renders as HTML sections.",
  );
  void renderDeck();
});

rerender.addEventListener("click", () => {
  pushActivity("Re-rendered deck", "The current review state was rendered again without resetting comments.");
  void renderDeck();
});

resetDemo.addEventListener("click", () => {
  sidecarState = cloneSidecar(initialSidecarData);
  activityEntries = [
    {
      id: nextCommentId(),
      message: "Reset review state",
      detail: "The demo comments were restored to the initial threaded sample data.",
      timestamp: new Date().toISOString(),
    },
  ];
  void renderDeck();
});

void renderDeck();