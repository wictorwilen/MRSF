import type { Comment, MrsfDocument } from "@mrsf/cli/browser";

interface BrowserAddCommentOptions {
  text: string;
  author: string;
  line?: number;
  end_line?: number;
  start_column?: number;
  end_column?: number;
  type?: Comment["type"];
  severity?: Comment["severity"];
  reply_to?: string;
}

function createCommentId(): string {
  const randomUuid = globalThis.crypto?.randomUUID?.bind(globalThis.crypto);
  if (randomUuid) {
    return randomUuid();
  }

  return `mrsf-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

async function computeHash(text: string): Promise<string | undefined> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle || typeof TextEncoder === "undefined") {
    return undefined;
  }

  const bytes = new TextEncoder().encode(text);
  const digest = await subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

async function syncSelectedTextHash(comment: Comment): Promise<void> {
  if (!comment.selected_text) {
    delete comment.selected_text_hash;
    return;
  }

  const hash = await computeHash(comment.selected_text);
  if (hash) {
    comment.selected_text_hash = hash;
  }
}

export async function addComment(
  doc: MrsfDocument,
  opts: BrowserAddCommentOptions,
): Promise<Comment> {
  const comment: Comment = {
    id: createCommentId(),
    author: opts.author,
    timestamp: new Date().toISOString(),
    text: opts.text,
    resolved: false,
  };

  if (opts.line != null) comment.line = opts.line;
  if (opts.end_line != null) comment.end_line = opts.end_line;
  if (opts.start_column != null) comment.start_column = opts.start_column;
  if (opts.end_column != null) comment.end_column = opts.end_column;
  if (opts.type) comment.type = opts.type;
  if (opts.severity) comment.severity = opts.severity;
  if (opts.reply_to) comment.reply_to = opts.reply_to;

  doc.comments.push(comment);
  return comment;
}

export async function setSelectedText(comment: Comment, selectedText: string): Promise<void> {
  comment.selected_text = selectedText;
  await syncSelectedTextHash(comment);
}

export async function populateSelectedText(
  comment: Comment,
  documentLines: string[],
): Promise<void> {
  if (comment.selected_text || comment.line == null) {
    return;
  }

  const startIdx = comment.line - 1;
  const endIdx = (comment.end_line ?? comment.line) - 1;

  if (startIdx < 0 || endIdx >= documentLines.length) {
    return;
  }

  if (startIdx === endIdx) {
    let line = documentLines[startIdx];
    if (comment.start_column != null && comment.end_column != null) {
      line = line.slice(comment.start_column, comment.end_column);
    }
    comment.selected_text = line;
  } else {
    const lines: string[] = [];
    for (let index = startIdx; index <= endIdx; index += 1) {
      let line = documentLines[index];
      if (index === startIdx && comment.start_column != null) {
        line = line.slice(comment.start_column);
      }
      if (index === endIdx && comment.end_column != null) {
        line = line.slice(0, comment.end_column);
      }
      lines.push(line);
    }
    comment.selected_text = lines.join("\n");
  }

  await syncSelectedTextHash(comment);
}

export function resolveComment(doc: MrsfDocument, commentId: string): boolean {
  const comment = doc.comments.find((entry) => entry.id === commentId);
  if (!comment) {
    return false;
  }

  comment.resolved = true;
  return true;
}

export function unresolveComment(doc: MrsfDocument, commentId: string): boolean {
  const comment = doc.comments.find((entry) => entry.id === commentId);
  if (!comment) {
    return false;
  }

  comment.resolved = false;
  return true;
}

const ANCHOR_FIELDS = [
  "line",
  "end_line",
  "start_column",
  "end_column",
  "selected_text",
  "selected_text_hash",
  "anchored_text",
  "commit",
] as const;

export function removeComment(doc: MrsfDocument, commentId: string): boolean {
  const comment = doc.comments.find((entry) => entry.id === commentId);
  if (!comment) {
    return false;
  }

  for (const entry of doc.comments) {
    if (entry.reply_to !== commentId) continue;

    for (const field of ANCHOR_FIELDS) {
      if (entry[field] == null && comment[field] != null) {
        (entry as Record<string, unknown>)[field] = comment[field];
      }
    }

    if (comment.reply_to) {
      entry.reply_to = comment.reply_to;
    } else {
      delete entry.reply_to;
    }
  }

  const commentIndex = doc.comments.findIndex((entry) => entry.id === commentId);
  if (commentIndex !== -1) {
    doc.comments.splice(commentIndex, 1);
  }

  return true;
}