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
  const TOOLTIP_CLASS = "mrsf-tooltip";
  const HIGHLIGHT_CLASS = "mrsf-line-highlight";
  const TOOLTIP_VISIBLE_CLASS = "mrsf-tooltip-visible";

  // ── Data ───────────────────────────────────────────────

  /**
   * Read comment data embedded by the markdown-it plugin.
   */
  function getCommentData() {
    const el = document.getElementById("mrsf-comment-data");
    if (!el) return [];
    try {
      // JSON is stored in a data attribute (script tags are stripped by CSP)
      const raw = el.getAttribute("data-comments") || "";
      return JSON.parse(raw);
    } catch {
      return [];
    }
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

  function createBadge(comments, line) {
    const badge = document.createElement("span");
    badge.className = BADGE_CLASS;
    badge.dataset.line = String(line);

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
      badge.style.borderLeftColor = severityColor("high");
    } else if (severities.includes("medium")) {
      badge.style.borderLeftColor = severityColor("medium");
    }

    return badge;
  }

  function createTooltip(comments, line) {
    const tooltip = document.createElement("div");
    tooltip.className = TOOLTIP_CLASS;
    tooltip.dataset.line = String(line);

    for (const c of comments) {
      const thread = document.createElement("div");
      thread.className = "mrsf-thread";

      // Root comment
      thread.appendChild(createCommentEl(c));

      // Replies
      if (c.replies && c.replies.length > 0) {
        const repliesContainer = document.createElement("div");
        repliesContainer.className = "mrsf-replies";
        for (const r of c.replies) {
          repliesContainer.appendChild(createCommentEl(r, true));
        }
        thread.appendChild(repliesContainer);
      }

      tooltip.appendChild(thread);
    }

    return tooltip;
  }

  function createCommentEl(comment, isReply) {
    const el = document.createElement("div");
    el.className = "mrsf-comment" + (isReply ? " mrsf-reply" : "");
    if (comment.resolved) {
      el.classList.add("mrsf-resolved");
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

  // ── Main ───────────────────────────────────────────────

  function render() {
    clearPreviousAnnotations();

    const comments = getCommentData();
    if (!comments || comments.length === 0) return;

    const lineMap = groupByLine(comments);

    for (const [line, groupedComments] of lineMap) {
      const targetEl = findElementForLine(line);
      if (!targetEl) continue;

      // Add highlight class
      targetEl.classList.add(HIGHLIGHT_CLASS);

      // Highlight inline (selected_text) comments within the element
      for (const c of groupedComments) {
        if (c.selected_text) {
          highlightTextInElement(targetEl, c.selected_text, c.id);
        }
      }

      // Create and position badge
      const badge = createBadge(groupedComments, line);
      const tooltip = createTooltip(groupedComments, line);

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
      });

      // ── Place badge + tooltip ──────────────────────────────
      // We need to handle table elements specially because
      // <tr>/<td>/<th> do not support position: relative and
      // injecting children into them breaks the table layout.
      const isTableEl = /^(TR|TD|TH|THEAD|TBODY|TABLE)$/.test(targetEl.tagName);

      if (isTableEl) {
        // Find the parent <table> and make it the positioning context
        const table = targetEl.closest("table");
        if (table) {
          if (!table.style.position || table.style.position === "static") {
            table.style.position = "relative";
          }
          // Create an absolutely-positioned anchor relative to the table,
          // placed at the target row's vertical offset.
          const anchor = document.createElement("div");
          anchor.className = "mrsf-table-badge-anchor";
          // Calculate the row's offset relative to the table
          const tableRect = table.getBoundingClientRect();
          const rowRect = targetEl.getBoundingClientRect();
          anchor.style.top = (rowRect.top - tableRect.top) + "px";
          anchor.style.left = "-4px";
          anchor.style.transform = "translateX(-100%)";

          anchor.appendChild(badge);
          anchor.appendChild(tooltip);
          table.appendChild(anchor);
        }
      } else {
        // Normal block element — badge is absolutely positioned via CSS
        // relative to the highlighted element.
        targetEl.appendChild(badge);
        targetEl.appendChild(tooltip);
      }
    }

    // Close tooltips when clicking outside
    document.addEventListener("click", () => {
      document
        .querySelectorAll(`.${TOOLTIP_VISIBLE_CLASS}`)
        .forEach((el) => el.classList.remove(TOOLTIP_VISIBLE_CLASS));
    });

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
      });
    });

    // ── Scroll-to-line (sidebar "Go to" in fullscreen preview) ───
    const dataEl = document.getElementById("mrsf-comment-data");
    if (dataEl) {
      const scrollLine = dataEl.getAttribute("data-scroll-to-line");
      if (scrollLine) {
        const targetLine = parseInt(scrollLine, 10);
        if (!isNaN(targetLine)) {
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
    }
  }

  // ── Lifecycle ──────────────────────────────────────────

  // Run immediately if DOM is ready, otherwise wait
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", render);
  } else {
    render();
  }

  // VS Code re-renders the preview HTML when content/settings change.
  // We use a MutationObserver to detect when the body content is replaced.
  const observer = new MutationObserver(() => {
    // Debounce slightly to let VS Code finish updating
    clearTimeout(observer._timer);
    observer._timer = setTimeout(render, 100);
  });

  observer.observe(document.body, { childList: true, subtree: false });
})();
