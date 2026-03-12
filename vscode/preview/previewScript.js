/**
 * Sidemark — Markdown Preview Script
 *
 * Injected into VS Code's Markdown preview webview via
 * `contributes.markdown.previewScripts`.
 *
 * Reads the MRSF comment data embedded by the markdown-it plugin and
 * renders inline badges + hover tooltips on annotated lines.
 */

(function () {
  "use strict";

  // ── Constants ──────────────────────────────────────────
  const BADGE_CLASS = "mrsf-badge";
  const ADD_CLASS = "mrsf-add-button";
  const TOOLTIP_CLASS = "mrsf-tooltip";
  const HIGHLIGHT_CLASS = "mrsf-line-highlight";
  const ANCHOR_CLASS = "mrsf-preview-anchor";
  const TOOLTIP_VISIBLE_CLASS = "mrsf-tooltip-visible";
  const EXTENSION_URI_BASE = "vscode://wictor.mrsf-vscode";
  const GUTTER_CLASS = "mrsf-preview-gutter";
  const GUTTER_ITEM_CLASS = "mrsf-preview-gutter-item";
  let renderQueued = false;

  function getPreviewConfig() {
    const el = document.getElementById("mrsf-comment-data");
    const metaEl = document.getElementById("mrsf-preview-meta");
    return {
      documentUri: el?.getAttribute("data-document-uri") || "",
      commentsEnabled: metaEl?.getAttribute("data-comments-enabled") !== "false",
      previewComments: metaEl?.getAttribute("data-preview-comments") !== "false",
      gutterPosition: el?.getAttribute("data-gutter-position") === "left" ? "left" : "right",
      gutterForInline: el?.getAttribute("data-gutter-for-inline") !== "false",
      inlineHighlights: el?.getAttribute("data-inline-highlights") !== "false",
      lineHighlight: el?.getAttribute("data-line-highlight") !== "false",
    };
  }

  function buildCommandUri(command, args) {
    return `command:${command}?${encodeURIComponent(JSON.stringify(args))}`;
  }

  function buildExtensionUri(path, params) {
    const url = new URL(`${EXTENSION_URI_BASE}${path}`);
    for (const [key, value] of Object.entries(params)) {
      if (value != null && value !== "") {
        url.searchParams.set(key, String(value));
      }
    }
    return url.toString();
  }

  function openExtensionUri(path, params) {
    const anchor = document.createElement("a");
    anchor.href = buildExtensionUri(path, params);
    anchor.style.display = "none";
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
  }

  function revealCommentInSidebar(commentId, previewConfig) {
    if (!commentId || !previewConfig.documentUri) return;
    openExtensionUri("/revealComment", {
      commentId,
      documentUri: previewConfig.documentUri,
    });
  }

  // ── Data ───────────────────────────────────────────────

  /**
   * Read comment data embedded by the markdown-it plugin.
   */
  function getCommentData() {
    const el = document.getElementById("mrsf-comment-data");
    const parseThreads = (raw) => {
      if (!raw) return [];
      try {
        const parsed = JSON.parse(raw);
        if (!parsed || !Array.isArray(parsed.threads)) return [];
        return parsed.threads.flatMap((thread) => [
          thread.comment,
          ...(Array.isArray(thread.replies) ? thread.replies : []),
        ]);
      } catch {
        return [];
      }
    };

    const parseFlatComments = (raw) => {
      if (!raw) return [];
      try {
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed : [];
      } catch {
        return [];
      }
    };

    if (el) {
      const flat = parseFlatComments(el.getAttribute("data-comments") || "");
      if (flat.length > 0) return flat;
      return parseThreads(el.getAttribute("data-mrsf-json") || "");
    }

    const script = document.querySelector('script[type="application/mrsf+json"]');
    if (!script) return [];
    return parseThreads(script.textContent || "");
  }

  function getScrollTargetLine() {
    const metaEl = document.getElementById("mrsf-preview-meta");
    if (!metaEl) return null;
    const scrollLine = metaEl.getAttribute("data-scroll-to-line");
    if (!scrollLine) return null;
    const targetLine = parseInt(scrollLine, 10);
    return Number.isNaN(targetLine) ? null : targetLine;
  }

  /**
   * Group comments by their source line number.
   * Replies are nested under their parent.
   */
  function groupByLine(comments) {
    const rootComments = comments.filter((c) => !c.reply_to && c.line != null);
    const replies = comments.filter((c) => c.reply_to);

    // Build a reply map: parentId → [replies]
    const replyMap = new Map();
    for (const r of replies) {
      const list = replyMap.get(r.reply_to) || [];
      list.push(r);
      replyMap.set(r.reply_to, list);
    }

    // Group root comments by line
    const lineMap = new Map();
    for (const c of rootComments) {
      const line = c.line;
      const group = lineMap.get(line) || [];
      group.push({ ...c, replies: replyMap.get(c.id) || [] });
      lineMap.set(line, group);
    }

    return lineMap;
  }

  // ── DOM Helpers ────────────────────────────────────────

  /**
   * Find the DOM element corresponding to a given source line.
   * VS Code's Markdown preview adds `data-line` attributes to block elements.
   */
  function findElementForLine(line) {
    // data-line is 0-based in VS Code's preview
    const line0 = line - 1;

    // Find the element with the exact line, or the nearest one before it
    const all = document.querySelectorAll("[data-line]");
    let best = null;
    let bestLine = -1;

    for (const el of all) {
      const elLine = parseInt(el.getAttribute("data-line"), 10);
      if (isNaN(elLine)) continue;
      if (elLine <= line0 && elLine > bestLine) {
        bestLine = elLine;
        best = el;
      }
    }

    return best;
  }

  function formatTime(isoTimestamp) {
    if (!isoTimestamp) return "";
    try {
      const d = new Date(isoTimestamp);
      return d.toLocaleDateString(undefined, {
        year: "numeric",
        month: "short",
        day: "numeric",
      });
    } catch {
      return "";
    }
  }

  function severityColor(severity) {
    switch (severity) {
      case "high":
        return "#e74c3c";
      case "medium":
        return "#f39c12";
      case "low":
        return "#3498db";
      default:
        return null;
    }
  }

  // ── Rendering ──────────────────────────────────────────

  const INLINE_HIGHLIGHT_CLASS = "mrsf-inline-highlight";

  function clearPreviousAnnotations() {
    document
      .querySelectorAll(`.${GUTTER_CLASS}`)
      .forEach((el) => el.remove());
    // Remove table badge anchors first (they contain badges + tooltips)
    document
      .querySelectorAll(".mrsf-table-badge-anchor")
      .forEach((el) => el.remove());
    document.querySelectorAll(`.${BADGE_CLASS}`).forEach((el) => el.remove());
    document
      .querySelectorAll(`.${TOOLTIP_CLASS}`)
      .forEach((el) => el.remove());
    document
      .querySelectorAll(`.${HIGHLIGHT_CLASS}`)
      .forEach((el) => el.classList.remove(HIGHLIGHT_CLASS));
    document
      .querySelectorAll(`.${ANCHOR_CLASS}`)
      .forEach((el) => el.classList.remove(ANCHOR_CLASS));
    document
      .querySelectorAll(`.${ADD_CLASS}`)
      .forEach((el) => el.remove());
    // Unwrap inline highlights back to plain text
    document.querySelectorAll(`.${INLINE_HIGHLIGHT_CLASS}`).forEach((mark) => {
      const parent = mark.parentNode;
      while (mark.firstChild) {
        parent.insertBefore(mark.firstChild, mark);
      }
      parent.removeChild(mark);
      parent.normalize();
    });
  }

  function createGutter(lineTargets, previewConfig) {
    const body = document.body;
    if (!body) return null;

    const bodyRect = body.getBoundingClientRect();
    let minLeft = Number.POSITIVE_INFINITY;
    let maxRight = 0;

    for (const targetEl of lineTargets.values()) {
      const rect = targetEl.getBoundingClientRect();
      minLeft = Math.min(minLeft, rect.left - bodyRect.left);
      maxRight = Math.max(maxRight, rect.right - bodyRect.left);
    }

    if (!Number.isFinite(minLeft)) {
      minLeft = 56;
    }

    const gutter = document.createElement("div");
    gutter.className = GUTTER_CLASS;
    gutter.dataset.gutterPosition = previewConfig.gutterPosition;

    if (previewConfig.gutterPosition === "left") {
      const width = Math.max(36, Math.floor(minLeft) - 8);
      gutter.style.left = "0px";
      gutter.style.width = `${width}px`;
    } else {
      const left = Math.ceil(maxRight) + 8;
      const width = Math.max(40, Math.ceil(bodyRect.width - left));
      gutter.style.left = `${left}px`;
      gutter.style.width = `${width}px`;
    }

    body.appendChild(gutter);
    return { gutter, bodyRect };
  }

  /**
   * Try to wrap `selectedText` in a <mark> within a single element.
   * Returns the mark element or null.
   */
  function wrapTextInElement(el, selectedText, commentId) {
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) {
      const idx = node.textContent.indexOf(selectedText);
      if (idx === -1) continue;

      try {
        const range = document.createRange();
        range.setStart(node, idx);
        range.setEnd(node, idx + selectedText.length);

        const mark = document.createElement("mark");
        mark.className = INLINE_HIGHLIGHT_CLASS;
        mark.dataset.commentId = commentId;
        range.surroundContents(mark);
        return mark;
      } catch {
        return null;
      }
    }
    return null;
  }

  /**
   * Highlight a specific text snippet in the preview.
   * First tries the target line element, then its siblings,
   * then falls back to children of the next sibling (e.g.,
   * when line points to a heading but the text is in a
   * following list or paragraph).
   */
  function highlightTextInElement(targetEl, selectedText, commentId) {
    if (!selectedText || !targetEl) return null;

    const trimmed = selectedText.trim();
    if (!trimmed) return null;

    // 1. Try exact target element
    let mark = wrapTextInElement(targetEl, trimmed, commentId);
    if (mark) return mark;

    // 2. Try following sibling elements (line number may have drifted)
    let sibling = targetEl.nextElementSibling;
    for (let i = 0; i < 5 && sibling; i++) {
      mark = wrapTextInElement(sibling, trimmed, commentId);
      if (mark) return mark;
      sibling = sibling.nextElementSibling;
    }

    // 3. Also check child elements of the first sibling
    //    (e.g., target is heading, text is in following <ul>/<ol> → <li>)
    sibling = targetEl.nextElementSibling;
    if (sibling && sibling.children.length > 0) {
      for (const child of sibling.children) {
        mark = wrapTextInElement(child, trimmed, commentId);
        if (mark) return mark;
      }
    }

    return null;
  }

  function createBadge(comments, line, previewConfig) {
    const badge = document.createElement("span");
    badge.className = BADGE_CLASS;
    badge.dataset.line = String(line);
    badge.dataset.gutterPosition = previewConfig.gutterPosition;

    const total = comments.reduce(
      (n, c) => n + 1 + (c.replies ? c.replies.length : 0),
      0,
    );
    const allResolved = comments.every((c) => c.resolved);

    badge.textContent = allResolved ? `✓ ${total}` : `💬 ${total}`;
    if (allResolved) {
      badge.classList.add("mrsf-badge-resolved");
    }

    // Severity indicator — show highest severity
    const severities = comments
      .map((c) => c.severity)
      .filter(Boolean);
    if (severities.includes("high")) {
      badge.style.setProperty("--mrsf-badge-accent", severityColor("high"));
    } else if (severities.includes("medium")) {
      badge.style.setProperty("--mrsf-badge-accent", severityColor("medium"));
    }

    return badge;
  }

  function createAddButton(line, previewConfig) {
    const button = document.createElement("a");
    button.className = ADD_CLASS;
    button.href = previewConfig.documentUri
      ? buildExtensionUri("/addLineComment", {
        line,
        documentUri: previewConfig.documentUri,
      })
      : "#";
    button.dataset.line = String(line);
    button.dataset.gutterPosition = previewConfig.gutterPosition;
    button.title = `Add comment on line ${line}`;
    button.textContent = "+";
    if (!previewConfig.documentUri) {
      button.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
      });
    }
    return button;
  }

  function placeGutterElement(targetEl, element, previewConfig, gutterState) {
    if (!gutterState) return;

    const item = document.createElement("div");
    item.className = GUTTER_ITEM_CLASS;
    item.dataset.gutterPosition = previewConfig.gutterPosition;

    const targetRect = targetEl.getBoundingClientRect();
    item.style.top = `${Math.round(targetRect.top - gutterState.bodyRect.top)}px`;

    if (previewConfig.gutterPosition === "left") {
      item.style.right = "8px";
    } else {
      item.style.left = "8px";
    }

    if (element instanceof Element) {
      element.dataset.gutterPosition = previewConfig.gutterPosition;
    }

    item.appendChild(element);
    gutterState.gutter.appendChild(item);
  }

  function createTooltip(comments, line, previewConfig) {
    const tooltip = document.createElement("div");
    tooltip.className = TOOLTIP_CLASS;
    tooltip.dataset.line = String(line);

    for (const c of comments) {
      const thread = document.createElement("div");
      thread.className = "mrsf-thread";

      // Root comment
      thread.appendChild(createCommentEl(c, false, previewConfig));

      // Replies
      if (c.replies && c.replies.length > 0) {
        const repliesContainer = document.createElement("div");
        repliesContainer.className = "mrsf-replies";
        for (const r of c.replies) {
          repliesContainer.appendChild(createCommentEl(r, true, previewConfig));
        }
        thread.appendChild(repliesContainer);
      }

      tooltip.appendChild(thread);
    }

    return tooltip;
  }

  function createCommentEl(comment, isReply, previewConfig) {
    const el = document.createElement("div");
    el.className = "mrsf-comment" + (isReply ? " mrsf-reply" : "");
    el.dataset.commentId = comment.id;
    if (comment.resolved) {
      el.classList.add("mrsf-resolved");
    }

    if (previewConfig.documentUri) {
      el.style.cursor = "pointer";
      el.addEventListener("click", (event) => {
        event.stopPropagation();
        revealCommentInSidebar(comment.id, previewConfig);
      });
    }

    // Header: author + date + severity/type badges
    const header = document.createElement("div");
    header.className = "mrsf-comment-header";

    const author = document.createElement("span");
    author.className = "mrsf-author";
    author.textContent = comment.author;
    header.appendChild(author);

    if (comment.timestamp) {
      const date = document.createElement("span");
      date.className = "mrsf-date";
      date.textContent = formatTime(comment.timestamp);
      header.appendChild(date);
    }

    if (comment.severity) {
      const sev = document.createElement("span");
      sev.className = "mrsf-severity mrsf-severity-" + comment.severity;
      sev.textContent = comment.severity;
      header.appendChild(sev);
    }

    if (comment.type) {
      const type = document.createElement("span");
      type.className = "mrsf-type";
      type.textContent = comment.type;
      header.appendChild(type);
    }

    if (comment.resolved) {
      const resolved = document.createElement("span");
      resolved.className = "mrsf-resolved-badge";
      resolved.textContent = "✓ resolved";
      header.appendChild(resolved);
    }

    el.appendChild(header);

    // Selected text quote (for inline comments)
    if (comment.selected_text) {
      const quote = document.createElement("div");
      quote.className = "mrsf-selected-text";
      quote.textContent = comment.selected_text;
      el.appendChild(quote);
    }

    // Body
    const body = document.createElement("div");
    body.className = "mrsf-comment-body";
    body.textContent = comment.text;
    el.appendChild(body);

    // Sidebar hint — preview tooltips are read-only;
    // actions (resolve, reply, delete) live in the sidebar panel.
    if (!isReply) {
      const hint = document.createElement("div");
      hint.className = "mrsf-sidebar-hint";
      hint.textContent = "Use the Sidebar to reply, resolve, or delete";
      el.appendChild(hint);
    }

    return el;
  }

  function closeAllTooltips() {
    document
      .querySelectorAll(`.${TOOLTIP_VISIBLE_CLASS}`)
      .forEach((el) => el.classList.remove(TOOLTIP_VISIBLE_CLASS));
  }

  function scheduleRender() {
    if (renderQueued) return;
    renderQueued = true;

    requestAnimationFrame(() => {
      renderQueued = false;
      render();
    });
  }

  // ── Main ───────────────────────────────────────────────

  function render() {
    clearPreviousAnnotations();

    const previewConfig = getPreviewConfig();
    if (!previewConfig.commentsEnabled || !previewConfig.previewComments) {
      return;
    }

    const comments = getCommentData();
    const commentedLines = new Set((comments || []).filter((comment) => !comment.reply_to && comment.line != null).map((comment) => comment.line));

    const lineTargets = new Map();
    document.querySelectorAll("[data-line]").forEach((element) => {
      const line0 = parseInt(element.getAttribute("data-line"), 10);
      if (Number.isNaN(line0)) return;
      const line = line0 + 1;
      if (!lineTargets.has(line)) {
        lineTargets.set(line, element);
      }
    });

    const gutterState = createGutter(lineTargets, previewConfig);

    for (const [line, targetEl] of lineTargets.entries()) {
      if (commentedLines.has(line)) continue;
      targetEl.classList.add(ANCHOR_CLASS);
      const addButton = createAddButton(line, previewConfig);
      placeGutterElement(targetEl, addButton, previewConfig, gutterState);
    }

    if (!comments || comments.length === 0) return;

    const lineMap = groupByLine(comments);

    for (const [line, groupedComments] of lineMap) {
      const targetEl = findElementForLine(line);
      if (!targetEl) continue;

      const allInlineComments = groupedComments.length > 0
        && groupedComments.every((comment) => !!comment.selected_text);

      const shouldShowInlineHighlights = previewConfig.inlineHighlights;
      const shouldShowBadge = previewConfig.gutterForInline || !allInlineComments || !shouldShowInlineHighlights;

      if (shouldShowBadge) {
        targetEl.classList.add(ANCHOR_CLASS);
      }

      if (previewConfig.lineHighlight) {
        targetEl.classList.add(HIGHLIGHT_CLASS);
      }

      // Highlight inline (selected_text) comments within the element
      if (shouldShowInlineHighlights) {
        for (const c of groupedComments) {
          if (c.selected_text) {
            highlightTextInElement(targetEl, c.selected_text, c.id);
          }
        }
      }

      if (!shouldShowBadge) {
        continue;
      }

      // Create and position badge
      const badge = createBadge(groupedComments, line, previewConfig);
      const tooltip = createTooltip(groupedComments, line, previewConfig);

      // Attach tooltip toggle
      badge.addEventListener("click", (e) => {
        e.stopPropagation();
        // Close all other tooltips
        document
          .querySelectorAll(`.${TOOLTIP_VISIBLE_CLASS}`)
          .forEach((el) => {
            if (el !== tooltip) el.classList.remove(TOOLTIP_VISIBLE_CLASS);
          });
        tooltip.classList.toggle(TOOLTIP_VISIBLE_CLASS);
        revealCommentInSidebar(groupedComments[0]?.id, previewConfig);
      });

      // ── Place badge + tooltip ──────────────────────────────
      placeGutterElement(targetEl, (() => {
        const wrapper = document.createElement("div");
        wrapper.appendChild(badge);
        wrapper.appendChild(tooltip);
        return wrapper;
      })(), previewConfig, gutterState);
    }

    // Close tooltips when clicking outside
    // ── Click-on-highlight to open tooltip ────────────────────
    // Inline <mark> elements with data-comment-id should also
    // toggle the tooltip for their line when clicked.
    document.querySelectorAll(`.${INLINE_HIGHLIGHT_CLASS}`).forEach((mark) => {
      mark.style.cursor = "pointer";
      mark.addEventListener("click", (e) => {
        e.stopPropagation();
        // Walk up to find the mrsf-line-highlight parent to get the line
        const commentId = mark.dataset.commentId;
        if (!commentId) return;

        // Find the comment's line from our data
        const allComments = getCommentData();
        const comment = allComments.find((c) => c.id === commentId);
        if (!comment || comment.line == null) return;

        // Find corresponding tooltip by data-line
        const tooltip = document.querySelector(
          `.${TOOLTIP_CLASS}[data-line="${comment.line}"]`
        );
        if (!tooltip) return;

        // Close all other tooltips, toggle this one
        document
          .querySelectorAll(`.${TOOLTIP_VISIBLE_CLASS}`)
          .forEach((el) => {
            if (el !== tooltip) el.classList.remove(TOOLTIP_VISIBLE_CLASS);
          });
        tooltip.classList.toggle(TOOLTIP_VISIBLE_CLASS);
        revealCommentInSidebar(commentId, previewConfig);
      });
    });

    // ── Scroll-to-line (sidebar "Go to" in fullscreen preview) ───
    const targetLine = getScrollTargetLine();
    if (targetLine != null) {
      const el = findElementForLine(targetLine);
      if (el) {
        // Use requestAnimationFrame to ensure layout is settled
        requestAnimationFrame(() => {
          el.scrollIntoView({ behavior: "smooth", block: "center" });
          // Brief flash to draw attention
          el.style.transition = "background-color 0.3s ease";
          el.style.backgroundColor = "rgba(255, 200, 0, 0.25)";
          setTimeout(() => {
            el.style.backgroundColor = "";
          }, 1500);
        });
      }
    }
  }

  // ── Lifecycle ──────────────────────────────────────────

  // Run immediately if DOM is ready, otherwise wait
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", render);
  } else {
    render();
  }

  document.addEventListener("click", closeAllTooltips);
  window.addEventListener("resize", scheduleRender);
  if (window.visualViewport) {
    window.visualViewport.addEventListener("resize", scheduleRender);
  }
})();
